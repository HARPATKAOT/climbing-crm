/**
 * שיחות לדוגמה — כל בדיקה כאן היא מקרה שקרה, או שיקרה, מול לקוח אמיתי.
 *
 * `botToolTurn.test.js` בודק את מנוע התור: פרומפט, הגנות ניסוח, קישורים.
 * כאן נבדק מה שהבוט *עושה למסד* — הכלים שכותבים, על נתונים מלאים, מקצה לקצה:
 * הודעה → קריאת כלי → שינוי בכרטיס. זה המקום שבו הגנה שנשברה נתפסת, כי
 * ההבדל בין „ענה יפה” ל„שינה נתון נכון” לא נראה בטקסט התשובה.
 *
 * כל בדיקה זורעת מסד משלה ומחזירה אותו לקדמותו — ראו `withSeed`.
 */
// Writes here must not need Supabase: the local db.json is durable enough for
// the length of a test run, and this is exactly the case that flag describes.
process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import { buildCustomerTools, isRegisteredTrainee } from './botTools.js';
import { advanceCustomerNameCapture, customerNameWords, getIntake } from './whatsappBot.js';
import { runCustomerToolTurn } from './botToolTurn.js';
import { capabilitySettingKey } from './botCapabilities.js';
import { FOLLOWUP_COLLECTION } from './botFollowUps.js';
import { INTEREST_COLLECTION } from './activityInterest.js';

/** Collections a scenario may touch. Everything is restored afterwards. */
const SCENARIO_COLLECTIONS = [
  'parents',
  'groups',
  'students',
  'health_declarations',
  'participation_waivers',
  'activities',
  'activity_registrations',
  INTEREST_COLLECTION,
  FOLLOWUP_COLLECTION,
  'bot_actions',
  'student_equipment',
  'equipment_checkouts',
  'student_guardians',
];

/**
 * Seed exactly the world one scenario needs, then put the real one back.
 * `db.set` replaces a whole collection, so a scenario that forgot to restore
 * would wipe live local data — hence the try/finally in every test.
 */
async function withSeed(data, run) {
  const backup = {};
  for (const key of SCENARIO_COLLECTIONS) backup[key] = db.get(key) || [];
  for (const key of SCENARIO_COLLECTIONS) {
    db.set(key, structuredClone(data[key] || []));
  }
  try {
    await run();
  } finally {
    for (const key of SCENARIO_COLLECTIONS) db.set(key, backup[key]);
  }
}

const NOW = new Date();
const SIGNED_TODAY = NOW.toISOString();

const PARENT = {
  id: 'p-scenario',
  name: 'דנה כהן',
  lastName: 'כהן',
  phone: '0599111000',
  last_inbound_whatsapp: SIGNED_TODAY,
};

/** ג׳-ד׳, יום א׳ 16:00 — קבוצה רגילה עם קישור הרשמה. */
const GROUP_GD = {
  id: 'g-gd',
  name: 'ג׳-ד׳ יום א׳ 16:00',
  ageCategory: 'ג׳-ד׳',
  day: 0,
  time: '16:00',
  maxSlots: 12,
  priceWeek: 290,
  signupLinkWeek: 'https://forms.example.com/gd-week',
};

/** ה׳-ו׳, יום ג׳ 17:00 — קבוצה שנייה, כדי שאפשר יהיה להעביר בין קבוצות. */
const GROUP_HV = {
  id: 'g-hv',
  name: 'ה׳-ו׳ יום ג׳ 17:00',
  ageCategory: 'ה׳-ו׳',
  day: 2,
  time: '17:00',
  maxSlots: 12,
  priceWeek: 290,
  signupLinkWeek: 'https://forms.example.com/hv-week',
};

/** ילד בכיתה ג׳ עם טופס השתתפות בתוקף. */
function childYotam(patch = {}) {
  return {
    id: 's-yotam',
    name: 'יותם כהן',
    parentId: PARENT.id,
    status: 'health_signed',
    birthDate: '2017-05-01',
    groupId: null,
    ...patch,
  };
}

/**
 * A signed health declaration. It only counts once it carries a signature —
 * the same rule the CRM screens read it by.
 */
function declarationFor(studentId, patch = {}) {
  return {
    id: `hd-${studentId}`,
    studentId,
    signedDate: SIGNED_TODAY,
    signature_url: 'https://example.com/sig.png',
    ...patch,
  };
}

/**
 * The other half of the form. Health expires every year and the approval does
 * not, so "has a form" means both of these — see the two-document tests below.
 */
function waiverFor(studentId, patch = {}) {
  return {
    id: `pw-${studentId}`,
    studentId,
    scope: 'wall',
    signedDate: SIGNED_TODAY,
    signature_url: 'https://example.com/sig.png',
    ...patch,
  };
}

/** Both documents in force, which is what "signed the form" means. */
function signedFormFor(studentIds = []) {
  return {
    health_declarations: studentIds.map((id) => declarationFor(id)),
    participation_waivers: studentIds.map((id) => waiverFor(id)),
  };
}

const student = (id) => db.getOne('students', id);
const followUps = () => db.get(FOLLOWUP_COLLECTION) || [];
const journal = () => db.get('bot_actions') || [];

const toolCall = (name, args = {}) => ({ role: 'model', parts: [{ functionCall: { name, args } }] });
const textReply = (text) => ({ role: 'model', parts: [{ text }] });

/** A model stand-in that plays the given steps in order. */
function scriptedModel(steps) {
  let i = 0;
  return async () => ({ content: steps[Math.min(i++, steps.length - 1)], error: '' });
}

// ─── איסוף השם ───────────────────────────────────────────────────────────────

/** כרטיס חדש בלי שם — בדיוק מה שנוצר מהודעה ראשונה בוואטסאפ. */
const NEW_CARD = {
  id: 'p-fresh',
  name: 'לקוח וואטסאפ',
  phone: '0508862878',
  channel: 'whatsapp',
};

const cardById = (id) => db.getOne('parents', id);

test('לקוח חדש: שואלים שם פרטי, ורק אחר כך שם משפחה — שאלה לשדה', async () => {
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;

    const first = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי, כמה עולה החוג?');
    assert.equal(first.done, false);
    assert.match(first.reply, /השם הפרטי/);
    // שתי השאלות בנשימה אחת הן מה שגרם לשם ולשם המשפחה להתחלף בכרטיס.
    assert.doesNotMatch(first.reply, /שם המשפחה/);

    const second = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'דנה');
    assert.equal(second.done, false);
    assert.match(second.reply, /דנה/);
    assert.match(second.reply, /שם המשפחה/);
    assert.equal(getIntake(cardById('p-fresh')).parentFirstName, 'דנה');

    const third = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'כהן');
    assert.equal(third.done, true);
    assert.equal(third.parent.name, 'דנה כהן');
    assert.equal(third.parent.lastName, 'כהן');
    // השאלה המקורית לא הלכה לאיבוד — היא נענית מיד אחרי השם.
    assert.equal(third.pendingMessage, 'היי, כמה עולה החוג?');
  });
});

test('מי שכתב שם מלא בתשובה אחת אינו מתבקש לחזור על עצמו', async () => {
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'שלום');
    const answer = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'דנה כהן');

    assert.equal(answer.done, true);
    assert.equal(answer.parent.name, 'דנה כהן');
    assert.equal(answer.parent.lastName, 'כהן');
  });
});

test('שם משפחה של שתי מילים נשמר שלם, ולא נדחף לשם הפרטי', async () => {
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'דנה');
    const done = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'בן דוד');

    assert.equal(done.done, true);
    assert.equal(done.parent.name, 'דנה בן דוד');
    assert.equal(done.parent.lastName, 'בן דוד');
  });
});

test('כרטיס עם שם פרטי בלבד נשאל רק על שם המשפחה', async () => {
  await withSeed({ parents: [{ ...NEW_CARD, name: 'דנה' }] }, async () => {
    const phone = NEW_CARD.phone;
    const ask = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');
    assert.equal(ask.done, false);
    assert.match(ask.reply, /שם המשפחה/);
    assert.doesNotMatch(ask.reply, /השם הפרטי/);

    const done = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'כהן');
    assert.equal(done.done, true);
    assert.equal(done.parent.name, 'דנה כהן');
  });
});

test('שאלה של הלקוח אינה שם — «מזה ai?» לא נשמר כשם משפחה', async () => {
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'יהודה');

    // כך נוצר בכרטיס אמיתי השם «יהודה מזה ai» — 6.8.2026.
    const asked = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'מזה ai?');
    assert.equal(asked.done, false);
    assert.equal(cardById('p-fresh').name, 'לקוח וואטסאפ');
    assert.equal(cardById('p-fresh').lastName || '', '');

    // ובפעם השנייה שהוא לא עונה על השאלה — מעבירים לאדם, לא שואלים שוב.
    const again = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'אתה בוט?');
    assert.equal(again.handoff, true);
    assert.match(again.reply, /לצוות/);
    assert.equal(cardById('p-fresh').lastName || '', '');
  });
});

test('מילים שאינן שם נדחות, ושם אמיתי עובר', () => {
  for (const notAName of ['מזה ai?', 'אתה בוט?', 'מה זה', 'AI', 'כמה עולה', 'מזה ai']) {
    assert.deepEqual(customerNameWords(notAName), [], notAName);
  }
  assert.deepEqual(customerNameWords('גלאס'), ['גלאס']);
  assert.deepEqual(customerNameWords('בן דוד'), ['בן', 'דוד']);
});

test('שיחה שנתפסה באמצע השאלה הישנה ממשיכה משם, ולא מתחילה מחדש', async () => {
  await withSeed({
    parents: [{
      ...NEW_CARD,
      bot_intake: { step: 'tools_parent_full_name', asked: true, pendingMessage: 'מתי אתם פתוחים?' },
    }],
  }, async () => {
    const done = await advanceCustomerNameCapture(NEW_CARD.phone, cardById('p-fresh'), 'דנה כהן');
    assert.equal(done.done, true);
    assert.equal(done.parent.name, 'דנה כהן');
    assert.equal(done.pendingMessage, 'מתי אתם פתוחים?');
  });
});

// ─── טופס השתתפות ────────────────────────────────────────────────────────────

test('«תרשמו את יותם לקבוצה» בלי טופס בתוקף — הבוט שולח את הטופס ולא משבץ', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam({ status: 'lead_new' })],
    health_declarations: [],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({ childName: 'יותם', grade: 'ג' });

    assert.equal(result.צריך_הצהרה, true);
    assert.match(result.error, /אין|קודם חותמים/);
    // הכרטיס לא זז: לא סטטוס ולא קבוצה.
    assert.equal(student('s-yotam').status, 'lead_new');
    assert.equal(student('s-yotam').groupId, null);
    assert.equal(journal().length, 0);
  });
});

test('טופס שנחתם ב-2023 אינו טופס בתוקף — אותה תשובה כמו למי שלא חתם', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    health_declarations: [declarationFor('s-yotam', { signedDate: '2023-09-01T10:00:00.000Z' })],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({ childName: 'יותם', grade: 'ג' });

    assert.equal(result.צריך_הצהרה, true);
    assert.equal(student('s-yotam').groupId, null);

    // ואותה עובדה נמסרת גם כשהמודל שואל ישירות מי חתום.
    const declarations = await tools.getHealthDeclarations();
    assert.equal(declarations.מתאמנים[0].הצהרת_בריאות_בתוקף, false);
    assert.match(declarations.הערה, /חסר/);
  });
});

// ─── גיל וסתירות ─────────────────────────────────────────────────────────────

test('ההורה אומר כיתה ה׳ והכרטיס אומר בן 5 — לא משבצים ולא מבקשים תאריך לידה', async () => {
  await withSeed({
    groups: [GROUP_HV],
    students: [childYotam({ birthDate: '2021-03-01' })],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({ childName: 'יותם', grade: 'ה' });

    assert.match(result.error, /לפי הכרטיס/);
    assert.match(result.מה_לעשות, /טופס ההרשמה/);
    assert.equal(student('s-yotam').status, 'health_signed');
    assert.equal(student('s-yotam').groupId, null);
  });
});

// ─── מתאמן רשום ──────────────────────────────────────────────────────────────

test('מתאמן רשום — לא מעבירים קבוצה ולא מבטלים שיבוץ, גם אם ההורה מבקש', async () => {
  await withSeed({
    groups: [GROUP_GD, GROUP_HV],
    students: [childYotam({ status: 'registered', groupId: GROUP_GD.id })],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    assert.equal(isRegisteredTrainee(student('s-yotam')), true);
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });

    const moved = await tools.startSignup({ childName: 'יותם', grade: 'ה' });
    assert.match(moved.error, /כבר רשום/);

    const cancelled = await tools.cancelSignup({ childName: 'יותם' });
    assert.match(cancelled.error, /רשום/);

    assert.equal(student('s-yotam').status, 'registered');
    assert.equal(student('s-yotam').groupId, GROUP_GD.id);
    assert.equal(journal().length, 0);
  });
});

// ─── שיבוץ רך והחזרתו ────────────────────────────────────────────────────────

test('שיבוץ רך: הכרטיס עובר לממתין להרשמה, נקבעת בדיקה למחר, ונרשמת שורת יומן', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const notices = [];
    const tools = buildCustomerTools({
      parent: PARENT,
      phone: PARENT.phone,
      onPlacement: (notice) => notices.push(notice),
    });
    const result = await tools.startSignup({ childName: 'יותם', grade: 'ג' });

    assert.equal(result.שובץ, 'יותם כהן');
    assert.equal(result.סטטוס, 'ממתין להרשמה');
    assert.equal(student('s-yotam').status, 'pending_signup');
    assert.equal(student('s-yotam').groupId, GROUP_GD.id);

    // הצוות שומע על זה מיד — שיבוץ שאיש לא יודע עליו הוא שיבוץ שאי אפשר להחזיר.
    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, 'pending_signup');

    // הבדיקה של מחר נקבעת בקוד השיבוץ, לא בזיכרון של המודל.
    const pending = followUps().filter((f) => f.reason === 'pending_signup');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].status, 'open');
    assert.equal(pending[0].created_by, 'bot');

    assert.equal(journal().length, 1);
    assert.equal(journal()[0].type, 'placement');
  });
});

test('שיבוץ פעמיים באותה שיחה אינו יוצר שתי תזכורות לאותו לקוח', async () => {
  await withSeed({
    groups: [GROUP_GD, GROUP_HV],
    students: [childYotam(), {
      id: 's-alma',
      name: 'עלמה כהן',
      parentId: PARENT.id,
      status: 'health_signed',
      birthDate: '2015-04-01',
      groupId: null,
    }],
    ...signedFormFor(['s-yotam', 's-alma']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    await tools.startSignup({ childName: 'יותם', grade: 'ג' });
    await tools.startSignup({ childName: 'עלמה', grade: 'ה' });

    assert.equal(student('s-yotam').groupId, GROUP_GD.id);
    assert.equal(student('s-alma').groupId, GROUP_HV.id);
    assert.equal(followUps().filter((f) => f.reason === 'pending_signup').length, 1);
  });
});

test('«תוציאו אותו מהקבוצה» — השיבוץ מוסר, והטופס שנחתם נשאר חתום', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam({ status: 'pending_signup', groupId: GROUP_GD.id })],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.cancelSignup({ childName: 'יותם' });

    assert.equal(result.בוטל, 'יותם כהן');
    // חתם הצהרה — לא ליד חדש. זה המצב שהיה לפני השיבוץ.
    assert.equal(student('s-yotam').status, 'health_signed');
    assert.equal(student('s-yotam').groupId, null);
    assert.equal(journal()[0].type, 'placement_cancelled');
  });
});

test('«תוציאו את הילד» כששני ילדים משובצים — הבוט שואל על מי, ולא מנחש', async () => {
  await withSeed({
    groups: [GROUP_GD, GROUP_HV],
    students: [
      childYotam({ status: 'pending_signup', groupId: GROUP_GD.id }),
      {
        id: 's-alma',
        name: 'עלמה כהן',
        parentId: PARENT.id,
        status: 'pending_signup',
        groupId: GROUP_HV.id,
        birthDate: '2015-04-01',
      },
    ],
    ...signedFormFor(['s-yotam', 's-alma']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.cancelSignup({});

    assert.match(result.error, /על מי/);
    assert.deepEqual(result.ילדים, ['יותם כהן', 'עלמה כהן']);
    assert.equal(student('s-yotam').groupId, GROUP_GD.id);
    assert.equal(student('s-alma').groupId, GROUP_HV.id);
  });
});

// ─── מתעניינים באירוע ────────────────────────────────────────────────────────

const TRIP = {
  id: 'a-trip',
  name: 'טיול לנקיק השחור',
  type: 'trip',
  date: '2027-01-15',
  end_date: '2027-01-15',
  location: 'נקיק השחור',
  description: 'יום טיפוס בשטח',
  price: 180,
  show_on_site: true,
  registration_enabled: true,
  registration_slug: 'black-canyon',
};

test('«תרשמו אותנו לטיול» פעמיים — מתעניין אחד, בלי כפילות', async () => {
  await withSeed({
    activities: [TRIP],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });

    const first = await tools.addActivityInterest({ eventId: 'black-canyon', participantName: 'יותם' });
    assert.equal(first.נרשם_כמתעניין, 'יותם כהן');
    assert.match(first.הערה, /אינו הרשמה/);

    const second = await tools.addActivityInterest({ eventId: 'black-canyon', participantName: 'יותם' });
    assert.match(second.הערה, /כבר היה רשום/);

    assert.equal((db.get(INTEREST_COLLECTION) || []).length, 1);
    assert.equal(journal().filter((a) => a.type === 'interest_added').length, 1);
  });
});

test('אירוע שאינו מפורסם אינו קיים בשביל הבוט — גם אם המודל נקב במזהה', async () => {
  await withSeed({
    activities: [{ ...TRIP, show_on_site: false }],
    students: [childYotam()],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });

    const events = await tools.getEvents();
    assert.deepEqual(events.אירועים, []);

    const result = await tools.addActivityInterest({ eventId: 'black-canyon', participantName: 'יותם' });
    assert.match(result.error, /אין אירוע פתוח/);
    assert.equal((db.get(INTEREST_COLLECTION) || []).length, 0);
  });
});

// ─── מעקבים ──────────────────────────────────────────────────────────────────

test('«תחזרו אליי מחר» ואז «בעצם בשבוע הבא» — תזכורת אחת שמתעדכנת', async () => {
  await withSeed({ students: [] }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });

    const first = await tools.scheduleFollowUp({ days: 1, note: 'לבדוק אם נרשמו במתנ״ס' });
    assert.ok(first.נקבע);

    const second = await tools.scheduleFollowUp({ days: 7, note: 'ההורה ביקש לחזור בשבוע הבא' });
    assert.match(second.הערה, /עודכנה/);

    const asked = followUps().filter((f) => f.reason === 'customer_asked');
    assert.equal(asked.length, 1);
    assert.equal(asked[0].note, 'ההורה ביקש לחזור בשבוע הבא');
    assert.notEqual(asked[0].due_date, first.נקבע);
  });
});

test('מעקב בלי לומר על מה — לא נקבע', async () => {
  await withSeed({}, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.scheduleFollowUp({ days: 1, note: '  ' });
    assert.match(result.error, /על מה/);
    assert.equal(followUps().length, 0);
  });
});

// ─── ציוד ────────────────────────────────────────────────────────────────────

test('קישור תשלום ציוד: אילו פריטים חסרים, בלי סכום, ובלי לייצר קישור חדש כל פעם', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
    student_equipment: [
      { id: 'se-1', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' },
      { id: 'se-2', student_id: 's-yotam', item_type: 'shirt', payment_status: 'unpaid', shirt_size: 'S' },
      { id: 'se-3', student_id: 's-yotam', item_type: 'chalk_bag', payment_status: 'paid' },
    ],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const first = await tools.getEquipmentPaymentLink({ childName: 'יותם' });

    assert.match(first.פריטים, /נעלי טיפוס/);
    assert.match(first.פריטים, /מידה S/);
    assert.doesNotMatch(first.פריטים, /מגנזיום/);
    assert.ok(first.קישור);
    // דף התשלום הוא המקום היחיד שיודע את המחיר — הודעה עם סכום היא מספר להתווכח עליו.
    assert.equal(first.סכום, undefined);
    assert.match(first.הערה, /בלי לנקוב בסכום/);

    const second = await tools.getEquipmentPaymentLink({ childName: 'יותם' });
    assert.equal(second.קישור, first.קישור);
    assert.equal((db.get('equipment_checkouts') || []).length, 1);
  });
});

test('חבילת ההרשמה: שלושה שלבים בסדר, ושלב הציוד בלי סכום', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
    student_equipment: [
      { id: 'se-1', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' },
    ],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const pack = await tools.getRegistrationPack({ childName: 'יותם', grade: 'ג' });

    assert.deepEqual(Object.keys(pack), [
      'שלב_1_הצהרת_בריאות',
      'שלב_2_הרשמה_לקבוצה',
      'שלב_3_תשלום_ציוד',
    ]);
    assert.equal(pack.שלב_1_הצהרת_בריאות.מצב, 'נחתמה');
    assert.match(pack.שלב_2_הרשמה_לקבוצה.קישור, /\/s\/g-gd\/1$/);
    assert.ok(pack.שלב_3_תשלום_ציוד.קישור);
    assert.equal('סכום' in pack.שלב_3_תשלום_ציוד, false);
  });
});

// ─── המתגים, מקצה לקצה ───────────────────────────────────────────────────────

test('מתג השיבוץ כבוי — הכלי לא נמסר למודל, וגם קריאה ישירה אליו לא משנה כלום', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const settings = { [capabilitySettingKey('placement')]: false };
    const seenDeclarations = [];
    const turn = await runCustomerToolTurn({
      incomingText: 'תרשמו את יותם לקבוצה של כיתה ג׳',
      apiKey: 'test-key',
      settings,
      parent: PARENT,
      phone: PARENT.phone,
      callModel: async ({ declarations }) => {
        seenDeclarations.push(declarations.map((d) => d.name));
        return {
          content: seenDeclarations.length === 1
            ? toolCall('startSignup', { childName: 'יותם', grade: 'ג' })
            : textReply('אעביר את זה לצוות ונחזור אליכם 🙏'),
          error: '',
        };
      },
    });

    assert.equal(seenDeclarations[0].includes('startSignup'), false);
    assert.equal(seenDeclarations[0].includes('listClasses'), true);
    assert.equal(turn.reason, 'ok');
    // הכרטיס לא זז, גם כשהמודל בכל זאת ניסה לקרוא לכלי.
    assert.equal(student('s-yotam').status, 'health_signed');
    assert.equal(student('s-yotam').groupId, null);
    assert.equal(followUps().length, 0);
  });
});

test('שיבוץ אמיתי דרך תור מלא: הכלי כותב, והתשובה עוברת את בדיקת ההצהרות', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const turn = await runCustomerToolTurn({
      incomingText: 'אפשר לשבץ את יותם לקבוצה של יום א׳?',
      apiKey: 'test-key',
      parent: PARENT,
      phone: PARENT.phone,
      callModel: scriptedModel([
        toolCall('startSignup', { childName: 'יותם', grade: 'ג', day: 0 }),
        textReply('שיבצתי את יותם לקבוצת ג׳-ד׳ ביום א׳ 16:00. המקום נשמר כ*ממתין להרשמה*.'),
      ]),
    });

    assert.equal(turn.reason, 'ok');
    assert.match(turn.text, /ממתין להרשמה/);
    assert.deepEqual(turn.toolsUsed, ['startSignup']);
    assert.equal(student('s-yotam').status, 'pending_signup');
  });
});

test('המודל אומר «שיבצתי» בלי לקרוא לכלי — הלקוח לא מקבל אישור על שינוי שלא קרה', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const turn = await runCustomerToolTurn({
      incomingText: 'תשבצו את יותם',
      apiKey: 'test-key',
      parent: PARENT,
      phone: PARENT.phone,
      callModel: scriptedModel([textReply('שיבצתי את יותם לקבוצת ג׳-ד׳ 🙂')]),
    });

    assert.equal(turn.reason, 'unverified_action');
    assert.doesNotMatch(turn.text, /שיבצתי/);
    assert.equal(student('s-yotam').status, 'health_signed');
  });
});

// ─── שני המסמכים ─────────────────────────────────────────────────────────────

/** אישור השתתפות חתום — הצהרת הבריאות היא זו שנמחקה. */
function signedWaiver(studentId) {
  return {
    id: `pw-${studentId}`,
    studentId,
    scope: 'wall',
    signedDate: SIGNED_TODAY,
    signature_url: 'https://example.com/sig.png',
  };
}

test('חסרה רק הצהרת בריאות — לא אומרים «לא התקבל טופס השתתפות»', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    health_declarations: [],
    participation_waivers: [signedWaiver('s-yotam')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const docs = await tools.getHealthDeclarations();
    const [row] = docs.מתאמנים;

    assert.equal(row.אישור_השתתפות_חתום, true);
    assert.equal(row.הצהרת_בריאות_בתוקף, false);
    assert.match(docs.הערה, /חסרה הצהרת בריאות בלבד/);
    // חידוש בריאות הוא טופס קצר, לא כל תהליך הקליטה מחדש.
    assert.match(row.קישור_למילוי, /health-renewal$/);

    // וגם השיבוץ אומר בדיוק מה חסר.
    const blocked = await tools.startSignup({ childName: 'יותם', grade: 'ג' });
    assert.equal(blocked.חסר, 'הצהרת בריאות');
    assert.match(blocked.error, /אישור ההשתתפות כבר חתום/);
    assert.equal(student('s-yotam').groupId, null);
  });
});

test('אין אף מסמך — זה טופס ההשתתפות המלא, עם הקישור המלא', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam({ status: 'lead_new' })],
    health_declarations: [],
    participation_waivers: [],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const docs = await tools.getHealthDeclarations();
    const [row] = docs.מתאמנים;

    assert.equal(row.אישור_השתתפות_חתום, false);
    assert.equal(row.הצהרת_בריאות_בתוקף, false);
    assert.doesNotMatch(row.קישור_למילוי, /health-renewal/);
    assert.match(docs.הערה, /חסר טופס/);
  });
});

// ─── ציוד ותשלומים חוזרים ────────────────────────────────────────────────────

test('הנעליים הן השכרה לחצי עונה, ודמי ההעשרה הם תשלום שנתי', async () => {
  await withSeed({ groups: [GROUP_GD], students: [] }, async () => {
    const tools = buildCustomerTools({
      parent: PARENT,
      phone: PARENT.phone,
      settings: { aiBusinessFacts: 'דמי העשרה: 110 ₪' },
    });
    const prices = await tools.getPrices({ equipment: true, entry: false });

    // «נעלי טיפוס: 150 ₪» לבד נקרא כמו קנייה, וההורה שומע על התקופה
    // ועל החלק היחסי רק בדף התשלום.
    if (prices.ציוד?.נעליים) {
      assert.match(prices.ציוד.נעליים.תנאים, /השכרה/);
      assert.match(prices.ציוד.נעליים.תקופת_ההשכרה, /חצי/);
      assert.ok(prices.ציוד.נעליים.מתאריך);
      assert.ok(prices.ציוד.נעליים.עד_תאריך);
      assert.match(prices.ציוד.נעליים.הערה, /חלק יחסי/);
    }
    // תשלום שנתי לצד מחיר חודשי של חוג נקרא כמו עוד תשלום חודשי.
    assert.equal(prices.דמי_העשרה.סכום, 110);
    assert.match(prices.דמי_העשרה.תדירות, /שנתי/);
  });
});

test('מגבלת הקצב מעבירה לצוות במקום להשתיק את השיחה', async () => {
  const { decideBotGate, mergeBotSettings } = await import('./whatsappBot.js');
  const settings = mergeBotSettings({ aiResponderEnabled: true, aiRateLimitPerHour: 0 });
  // 0 = בלי מגבלה, וזה עדיין חייב לענות.
  assert.equal(decideBotGate(settings, {}, [], 'שלום').action, 'reply');

  // לקוח שכתב הרבה בשעה אחת קיבל שקט מוחלט — נראה בדיוק כמו בוט שבור.
  const capped = mergeBotSettings({ aiResponderEnabled: true, aiRateLimitPerHour: 1 });
  const gate = decideBotGate(capped, { phone: '0599111000' }, [], 'בטוח? תבדוק שוב');
  assert.notEqual(gate.action, 'silence');
});

// ─── קישורים ─────────────────────────────────────────────────────────────────

test('קישור שהולך ללקוח יושב על הדומיין שהוא מכיר', async () => {
  const { buildRedirectUrl, buildApiRedirectUrl } = await import('./publicLinks.js');
  const front = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = 'https://app.example';
  try {
    // «climbing-crm-api.onrender.com» ליד בקשה למלא טופס בריאות נראה חשוד.
    assert.equal(buildRedirectUrl('fp', '972500000000'), 'https://app.example/api/fp/972500000000');
    assert.equal(buildRedirectUrl('s', 'g-1', 2), 'https://app.example/api/s/g-1/2');
    // כפתור בתבנית מאושרת של מטא קפוא — הוא נשאר על הדומיין של ה-API.
    assert.match(buildApiRedirectUrl('fp', '972500000000'), /^https:\/\/climbing-crm-api\./);
  } finally {
    if (front === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = front;
  }
});

test('טופס בתוקף אינו נאמר ביוזמת הבוט; חסר או פג — כן, עם הצעה למלא מראש', async () => {
  const { CUSTOMER_TOOL_RULES } = await import('./botToolTurn.js');
  // «טופס ההשתתפות שלכם בתוקף, אז אפשר פשוט להגיע!» בסוף תשובה על שעות פתיחה.
  assert.match(CUSTOMER_TOOL_RULES, /טופס בתוקף אינו חדשה/);
  assert.match(CUSTOMER_TOOL_RULES, /רק כששאלו עליו, או כשהוא חסר או פג/);
  assert.match(CUSTOMER_TOOL_RULES, /למלא אותו מראש/);
});

test('הכללים אוסרים לחזור על אותו קישור ועל אותו הסבר', async () => {
  const { CUSTOMER_TOOL_RULES } = await import('./botToolTurn.js');
  // שלוש הודעות ברצף שפתחו ב«📋 טופס השתתפות» עם אותו קישור — 6.8.2026.
  assert.match(CUSTOMER_TOOL_RULES, /אל תשלח שוב ואל תחזור על ההסבר/);
  assert.match(CUSTOMER_TOOL_RULES, /ענה על מה שנשאלת/);
});

// ─── כשהמודל לא זמין ─────────────────────────────────────────────────────────

test('מודל שנופל אינו הופך לניחוש — הבוט אומר שהוא מעביר, ומעביר', async () => {
  await withSeed({ groups: [GROUP_GD], students: [childYotam()] }, async () => {
    const { whatsappService } = await import('./whatsapp.js');
    const key = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      // Before, a keyword layer answered here: «כמה עולה» matched the price
      // branch and the customer got a number nobody had checked this turn.
      const result = await whatsappService.generateAIResponse('כמה עולה החוג לכיתה ג?', {
        phone: PARENT.phone,
        parent: PARENT,
        students: [],
      });
      assert.equal(result.handoff, true);
      assert.equal(result.reason, 'no_model');
      assert.match(result.text, /לצוות/);
      // No price, no group, no schedule — nothing that would need a source.
      assert.doesNotMatch(result.text, /\d{2,}/);
    } finally {
      if (key === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = key;
    }
  });
});

// ─── כרטיס המשפחה ────────────────────────────────────────────────────────────

test('כרטיס המשפחה מוסר גיל מחושב, ולא מציג ממתין להרשמה בלי קבוצה', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [
      childYotam({ groupId: GROUP_GD.id, status: 'pending_signup' }),
      {
        id: 's-alma',
        name: 'עלמה כהן',
        parentId: PARENT.id,
        // סטטוס שנשאר מכרטיס ישן, בלי קבוצה מאחוריו.
        status: 'pending_signup',
        groupId: null,
        birthDate: '2015-04-01',
      },
    ],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const card = await tools.getFamilyCard();

    const [yotam, alma] = card.ילדים;
    assert.equal(yotam.סטטוס, 'pending_signup');
    assert.match(yotam.קבוצה, /ג׳-ד׳/);
    assert.ok(yotam.גיל && yotam.גיל !== 'לא ידוע');

    assert.equal(alma.סטטוס, 'health_signed');
    assert.match(alma.הערת_סטטוס, /אין להציג/);
    assert.match(card.הערה, /אין לחשב גיל/);
  });
});
