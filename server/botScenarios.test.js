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
import { currentSeason } from './placementEligibility.js';
import { FOLLOWUP_COLLECTION } from './botFollowUps.js';
import { INTEREST_COLLECTION } from './activityInterest.js';
import {
  HOLD_COLLECTION,
  INTRO_COLLECTION,
  LIFECYCLE_EVENT_COLLECTION,
  WAITLIST_COLLECTION,
} from './registrationLifecycle.js';

/** Collections a scenario may touch. Everything is restored afterwards. */
const SCENARIO_COLLECTIONS = [
  'parents',
  'groups',
  'students',
  'enrollments',
  'health_declarations',
  'participation_waivers',
  'activities',
  'activity_registrations',
  INTEREST_COLLECTION,
  FOLLOWUP_COLLECTION,
  'bot_actions',
  // Every journalled action opens a review task; without this a scenario run
  // would leave them behind in the real local store.
  'crm_tasks',
  'student_equipment',
  'equipment_checkouts',
  'centre_registration_checks',
  'student_guardians',
  'program_eligibility',
  'placement_requests',
  'level_tests',
  HOLD_COLLECTION,
  WAITLIST_COLLECTION,
  INTRO_COLLECTION,
  LIFECYCLE_EVENT_COLLECTION,
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

/** The seeded trainee as the database holds it right now. */
function cardStudent(id) {
  return (db.get('students') || []).find((s) => s.id === id) || {};
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

test('אישור צוות ממשיך לפי מזהי המתאמן והקבוצה המדויקים ושולח קישור נבחרת כפול', async () => {
  const squad = {
    id: 'g-adult-squad',
    name: 'נבחרת בוגרת — ב׳+ה׳ 19:10',
    ageCategory: 'תיכון',
    skillLevel: 'נבחרת',
    day: 4,
    time: '19:10',
    maxSlots: 16,
    priceWeek: 0,
    priceTwice: 560,
    signupLinkTwice: 'https://centre.example/adult-squad',
  };
  const ido = childYotam({
    id: 's-ido',
    name: 'עידו גרינברג',
    status: 'past_registered',
    birthDate: '2010-05-01',
  });
  await withSeed({
    groups: [GROUP_GD, squad],
    students: [ido],
    health_declarations: [declarationFor(ido.id)],
    participation_waivers: [waiverFor(ido.id)],
    program_eligibility: [{
      id: 'pe-ido',
      student_id: ido.id,
      program: 'adult_squad',
      season: '2026-27',
      status: 'approved',
    }],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({
      childName: ido.name,
      studentId: ido.id,
      groupId: squad.id,
      frequency: 'פעמיים בשבוע',
    });
    assert.equal(result.error, undefined);
    assert.equal(student(ido.id).status, 'awaiting_parent_confirmation');
    assert.equal(student(ido.id).groupId, squad.id);
    assert.match(result.חבילת_הרשמה.שלב_2_הרשמה_לקבוצה.קישור, /\/api\/s\/g-adult-squad\/2$/);
  });
});

test('ממשיך מהעונה הקודמת נכנס לנבחרת בלי לפתוח בקשת אישור חדשה', async () => {
  const squad = {
    id: 'g-returning-squad',
    name: 'נבחרת בוגרת — ב׳+ה׳ 19:10',
    ageCategory: 'תיכון',
    skillLevel: 'נבחרת',
    day: 4,
    time: '19:10',
    maxSlots: 16,
    priceWeek: 0,
    priceTwice: 560,
    signupLinkTwice: 'https://centre.example/returning-squad',
  };
  const returning = childYotam({
    id: 's-returning', name: 'עידו גרינברג', gender: 'male', status: 'past_registered', birthDate: '2010-05-01',
  });
  const returningGirl = childYotam({
    id: 's-returning-girl', name: 'עלמה גרינברג', gender: 'female', status: 'past_registered', birthDate: '2010-06-01',
  });
  await withSeed({
    groups: [squad],
    students: [returning, returningGirl],
    health_declarations: [declarationFor(returning.id), declarationFor(returningGirl.id)],
    participation_waivers: [waiverFor(returning.id), waiverFor(returningGirl.id)],
    program_eligibility: [
      { id: 'pe-returning', student_id: returning.id, program: 'adult_squad', season: '2026-27', status: 'returning' },
      { id: 'pe-returning-girl', student_id: returningGirl.id, program: 'adult_squad', season: '2026-27', status: 'returning' },
    ],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const approval = await tools.requestPlacementApproval({
      childName: returning.name, band: 'תיכון', frequency: 'פעמיים בשבוע',
    });
    assert.equal(approval.נדרש_אישור, false, JSON.stringify(approval));
    assert.equal(approval.זכאי_לשיבוץ_ישיר, true);
    assert.equal(approval.להמשיך_לשיבוץ, true);
    assert.equal(approval.אישור_ללקוח, 'עידו מאושר להרשמה לנבחרת');
    assert.doesNotMatch(JSON.stringify(approval), /startSignup|כבר קיימת זכאות/);
    assert.equal((db.get('placement_requests') || []).length, 0);
    const girlApproval = await tools.requestPlacementApproval({
      childName: returningGirl.name, band: 'תיכון', frequency: 'פעמיים בשבוע',
    });
    assert.equal(girlApproval.אישור_ללקוח, 'עלמה מאושרת להרשמה לנבחרת');

    const signup = await tools.startSignup({
      childName: returning.name,
      studentId: returning.id,
      groupId: squad.id,
      frequency: 'פעמיים בשבוע',
    });
    assert.equal(signup.error, undefined);
    assert.equal(student(returning.id).status, 'awaiting_parent_confirmation');
    assert.equal(student(returning.id).groupId, squad.id);
  });
});

test('קבוצה שהמתאמן כבר מאושר אליה אינה נעלמת בגלל סינון הכיתה', async () => {
  // גיל בן עשר וחצי, מאושר לנבחרת הצעירה שהוגדרה לחטיבה. הכלי סינן את
  // הקבוצה לפי הכיתה שלו, החזיר שאין התאמה, והבוט אמר לאמא שהמערכת חוסמת
  // את השיבוץ בגלל הגיל — בזמן שהאישור כבר היה בכרטיס.
  const squad = {
    id: 'g-young-squad',
    name: 'נבחרת צעירה — ב׳+ה׳ 17:00',
    ageCategory: 'חטיבה',
    skillLevel: 'נבחרת',
    day: 1,
    time: '17:00',
    maxSlots: 16,
    priceTwice: 560,
    signupLinkTwice: 'https://centre.example/young-squad',
  };
  const gil = childYotam({
    id: 's-gil', name: 'גיל זלטוקרילוב', gender: 'male', status: 'past_registered', birthDate: '2015-10-01',
  });
  await withSeed({
    groups: [GROUP_HV, squad],
    students: [gil],
    health_declarations: [declarationFor(gil.id)],
    participation_waivers: [waiverFor(gil.id)],
    program_eligibility: [{
      id: 'pe-gil',
      student_id: gil.id,
      group_id: squad.id,
      group_ids: [squad.id],
      program: 'young_squad',
      season: currentSeason(),
      status: 'returning',
    }],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.getPlacementEligibility({ childName: 'גיל', grade: 'ה' });
    const option = (result.אפשרויות || []).find((row) => row.מזהה_קבוצה === squad.id);
    assert.ok(option, JSON.stringify(result));
    assert.equal(option.זכאי_לשיבוץ_ישיר, true);
    assert.equal(option.מועמד, false);
    assert.match(result.הערה, /אין לבקש אישור צוות נוסף/);

    // והשיבוץ עצמו עובר: הזכאות היא ההחלטה, לא טווח הגילים של הקבוצה.
    const signup = await tools.startSignup({
      childName: gil.name,
      studentId: gil.id,
      groupId: squad.id,
      frequency: 'פעמיים בשבוע',
    });
    assert.equal(signup.error, undefined, JSON.stringify(signup));
    assert.equal(student(gil.id).groupId, squad.id);
  });
});

/** Both documents in force, which is what "signed the form" means. */
function signedFormFor(studentIds = []) {
  return {
    health_declarations: studentIds.map((id) => declarationFor(id)),
    participation_waivers: studentIds.map((id) => waiverFor(id)),
  };
}

const student = (id) => db.getOne('students', id);
/** Every group the trainee actually sits in — enrollments, not the one pointer. */
const studentGroupIdsOf = (id) => (db.get('enrollments') || [])
  .filter((row) => String(row.student_id) === String(id) && !row.end_date)
  .map((row) => String(row.group_id));
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

test('לקוח חדש נשאל לשמו פעם אחת, וזהו', async () => {
  // שתי שאלות היו המקום שבו מתעניינים עזבו: שלושה ביום אחד שאלו משהו, נשאלו
  // לשם המשפחה במקום לקבל תשובה, ושניים מהם הגיעו להעברה לצוות. שם המשפחה
  // מגיע ממילא חתום בטופס ההשתתפות.
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;

    const first = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי, כמה עולה החוג?');
    assert.equal(first.done, false);
    assert.match(first.reply, /איך קוראים לך/);
    assert.doesNotMatch(first.reply, /שם המשפחה/);

    const second = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'דנה');
    assert.equal(second.done, true);
    assert.equal(second.parent.name, 'דנה');
    // השאלה המקורית לא הלכה לאיבוד — היא נענית מיד אחרי השם.
    assert.equal(second.pendingMessage, 'היי, כמה עולה החוג?');
  });
});

// מתאמן שכותב מהטלפון האישי שלו, שעדיין לא מוזן במערכת: השם שנאסף תואם
// לרשומת מתאמן קיימת — הבוט מאמת מול שם ההורה, מחבר את הטלפון לרשומה,
// ולא פותח תיק לקוח כפול (הליד של יונתן ברזילי, 2026-08-16).
test('מתאמן קיים שמזדהה בשם מחובר לתיק המשפחה במקום ליד חדש', async () => {
  await withSeed({
    parents: [
      { ...NEW_CARD },
      { id: 'p-mom', name: 'קרן ברזילי', phone: '0501112223' },
    ],
    students: [
      { id: 's-yon', parentId: 'p-mom', name: 'יונתן ברזילי', status: 'registered', birthDate: '2011-03-03' },
    ],
  }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');
    const offered = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'יונתן ברזילי');
    assert.equal(offered.done, false);
    assert.match(offered.reply, /קרן/);
    // השם עדיין לא נשמר על הליד — ההכרעה קודמת.
    assert.equal(cardById('p-fresh').name, 'לקוח וואטסאפ');

    const linked = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'כן');
    assert.equal(linked.done, false);
    assert.match(linked.reply, /חיברתי/);
    const student = db.get('students').find((s) => s.id === 's-yon');
    assert.equal(student.phone, '972508862878');
    // הליד הריק נמחק — אין תיק כפול.
    assert.equal(db.get('parents').some((p) => p.id === 'p-fresh'), false);
  });
});

test('«לא» על שאלת האימות משאיר ליד חדש עם השם שנאסף', async () => {
  await withSeed({
    parents: [
      { ...NEW_CARD },
      { id: 'p-mom', name: 'קרן ברזילי', phone: '0501112223' },
    ],
    students: [
      { id: 's-yon', parentId: 'p-mom', name: 'יונתן ברזילי', status: 'registered', birthDate: '2011-03-03' },
    ],
  }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'שלום');
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'יונתן ברזילי');
    const declined = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'לא');
    assert.equal(declined.done, true);
    assert.equal(declined.parent.name, 'יונתן ברזילי');
    // הטלפון לא נכתב על המתאמן של המשפחה האחרת.
    assert.equal(db.get('students').find((s) => s.id === 's-yon').phone, undefined);
    assert.equal(db.get('parents').some((p) => p.id === 'p-fresh'), true);
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

test('שם משפחה שנמסר מעצמו נשמר שלם, ולא נדחף לשם הפרטי', async () => {
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');
    const done = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'דנה בן דוד');

    assert.equal(done.done, true);
    assert.equal(done.parent.name, 'דנה בן דוד');
    assert.equal(done.parent.lastName, 'בן דוד');
  });
});

test('כרטיס שכבר יש בו שם פרטי אינו נשאל דבר', async () => {
  await withSeed({ parents: [{ ...NEW_CARD, name: 'דנה' }] }, async () => {
    const phone = NEW_CARD.phone;
    const ask = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');
    assert.equal(ask.done, true);
    assert.equal(cardById('p-fresh').name, 'דנה');
  });
});

test('שאלה של הלקוח אינה שם — «מזה ai?» לא נשמר בכרטיס', async () => {
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי');

    // כך נוצר בכרטיס אמיתי השם «יהודה מזה ai» — 6.8.2026.
    const asked = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'מזה ai?');
    assert.equal(asked.nameDeferred, true);
    assert.equal(cardById('p-fresh').name, 'לקוח וואטסאפ');
    assert.equal(cardById('p-fresh').lastName || '', '');

    // ולא עונים לו „סליחה, לא הבנתי” פעמיים ואז מעבירים לצוות: מי ששואל
    // שאלה מקבל תשובה. שם הוא נחמד שיהיה, לא שער שצריך לעבור.
    const again = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'אתה בוט?');
    assert.equal(again.handoff, undefined);
    assert.equal(again.nameDeferred, true);
    assert.equal(again.pendingMessage, 'אתה בוט?');
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

test('מתאמן מהעונה הקודמת שלא ממשיך עובר לארכיון והמעקב נסגר', async () => {
  const returning = childYotam({ status: 'past_registered' });
  await withSeed({
    parents: [{ ...PARENT, status: 'past_registered' }],
    students: [returning],
    bot_followups: [{
      id: 'bf-returning', parent_id: PARENT.id, student_id: returning.id,
      status: 'open', reason: 'form_not_filled',
    }],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.archiveNonReturningStudent({ childName: 'יותם' });
    assert.equal(result.הועבר_לארכיון, 'יותם כהן');
    assert.equal(student(returning.id).status, 'archived');
    assert.equal(db.getOne('parents', PARENT.id).status, 'archived');
    assert.equal(followUps()[0].status, 'cancelled');
  });
});

test('הודעת אי-המשך אינה יכולה לארכב מתאמן שרשום בעונה הנוכחית', async () => {
  await withSeed({
    parents: [{ ...PARENT, status: 'registered' }],
    students: [childYotam({ status: 'registered', groupId: GROUP_GD.id })],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.archiveNonReturningStudent({ childName: 'יותם' });
    assert.match(result.error, /ביטול הרשמה נעשה מול הצוות/);
    assert.equal(student('s-yotam').status, 'registered');
  });
});

// ─── שמירת מקום קשיחה והחזרתה ────────────────────────────────────────────────

test('שיבוץ קשיח: הכרטיס ממתין לאישור הורה, תופס מקום ונרשמת שורת יומן', async () => {
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
    assert.equal(result.סטטוס_פנימי, 'awaiting_parent_confirmation');
    assert.equal(result.מקום_שמור, true);
    assert.equal(student('s-yotam').status, 'awaiting_parent_confirmation');
    assert.equal(student('s-yotam').groupId, GROUP_GD.id);

    // הצוות שומע על זה מיד — שיבוץ שאיש לא יודע עליו הוא שיבוץ שאי אפשר להחזיר.
    assert.equal(notices.length, 1);
    assert.equal(notices[0].kind, 'awaiting_parent_confirmation');

    // התזכורת שייכת להחזקה העמידה, לא לרשומת follow-up כללית.
    assert.equal(followUps().filter((f) => f.reason === 'pending_signup').length, 0);
    const holds = db.get(HOLD_COLLECTION) || [];
    assert.equal(holds.length, 1);
    assert.ok(holds[0].reminder_at);

    assert.equal(journal().length, 1);
    assert.equal(journal()[0].type, 'placement');
  });
});

test('אותו שיבוץ פעמיים נשמר פעם אחת בלבד ולא יוצר תשובה תפעולית כפולה', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
    student_equipment: [
      { id: 'se-soft', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' },
    ],
  }, async () => {
    const notices = [];
    const tools = buildCustomerTools({
      parent: PARENT,
      phone: PARENT.phone,
      onPlacement: (notice) => notices.push(notice),
    });

    const first = await tools.startSignup({ childName: 'יותם', grade: 'ג' });
    const repeated = await tools.startSignup({ childName: 'יותם', grade: 'ג' });

    assert.equal(first.כבר_נשמר, undefined);
    assert.equal(repeated.כבר_נשמר, true);
    assert.match(first.חבילת_הרשמה.שלב_2_הרשמה_לקבוצה.קישור, /\/s\/g-gd\/1$/);
    assert.ok(first.חבילת_הרשמה.שלב_3_תשלום_ציוד.קישור);
    assert.equal(
      repeated.חבילת_הרשמה.שלב_3_תשלום_ציוד.קישור,
      first.חבילת_הרשמה.שלב_3_תשלום_ציוד.קישור
    );
    assert.equal(notices.length, 1);
    assert.equal(journal().filter((row) => row.type === 'placement').length, 1);
    assert.equal(followUps().filter((row) => row.reason === 'pending_signup').length, 0);
    assert.equal((db.get(HOLD_COLLECTION) || []).length, 1);
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
    assert.equal(followUps().filter((f) => f.reason === 'pending_signup').length, 0);
    assert.equal((db.get(HOLD_COLLECTION) || []).length, 2);
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
    assert.equal(student('s-yotam').status, 'details_completed');
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

test('«תוריד אותי משם» — הבוט מסיר מרשימת המתעניינים בעצמו', async () => {
  await withSeed({
    activities: [TRIP],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    await tools.addActivityInterest({ eventId: 'black-canyon', participantName: 'יותם' });

    // «וואי, בטוח? תוריד אותי משם, אנחנו לא יכולים ביום הזה» — עבר לצוות
    // כי לבוט הייתה דרך לרשום ולא הייתה דרך למחוק.
    const removed = await tools.removeActivityInterest({ eventId: 'black-canyon' });
    assert.equal(removed.הוסר, 'יותם כהן');
    assert.match(removed.הערה, /הוסר/);

    const rows = db.get(INTEREST_COLLECTION) || [];
    assert.equal(rows.length, 1, 'השורה נשמרת ומסומנת, לא נמחקת');
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(journal().at(-1).type, 'interest_removed');

    // בקשה חוזרת אינה שגיאה — פשוט אין מה להסיר.
    const again = await tools.removeActivityInterest({ eventId: 'black-canyon' });
    assert.equal(again.הוסר, false);
    assert.match(again.הערה, /אינו רשום/);
  });
});

test('שאלה על אירועים אינה בקשה להירשם — הכללים מחייבים לשאול קודם', async () => {
  const { CUSTOMER_TOOL_RULES } = await import('./botToolTurn.js');
  assert.match(CUSTOMER_TOOL_RULES, /שאלה היא שאלה/);
  assert.match(CUSTOMER_TOOL_RULES, /רק אחרי שהלקוח אמר שכן/);
  assert.match(CUSTOMER_TOOL_RULES, /removeActivityInterest/);
  // הכלל הישן אמר במפורש לרשום בלי לשאול — וזה מה שקרה בשיחה.
  assert.doesNotMatch(CUSTOMER_TOOL_RULES, /בלי לשאול קודם אם לרשום/);
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
    assert.match(first.קישור, /\/api\/e\//);
    // דף התשלום הוא המקום היחיד שיודע את המחיר — הודעה עם סכום היא מספר להתווכח עליו.
    assert.equal(first.סכום, undefined);
    assert.match(first.הערה, /אין לנקוב בסכום/);

    const second = await tools.getEquipmentPaymentLink({ childName: 'יותם' });
    assert.equal(second.קישור, first.קישור);
    assert.equal((db.get('equipment_checkouts') || []).length, 1);

    // קישור שאיש לא חוזר אליו הוא קישור שפג. תזכורת אחת בלבד, גם על שתי קריאות.
    const checks = followUps().filter((f) => f.reason === 'equipment_unpaid');
    assert.equal(checks.length, 1);
    assert.equal(checks[0].subject, 'יותם כהן');
  });
});

test('אישור הרשמה במתנ״ס ממשיך לציוד שעדיין לא נסגר', async () => {
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'pending_signup', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
    student_equipment: [
      { id: 'se-open', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' },
    ],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.reportCentreRegistration({ childName: 'יותם' });

    assert.equal(result.משובץ_אצלנו, true);
    assert.match(result.אישור_ללקוח, /יותם כהן משובץ אצלנו/);
    assert.match(result.אישור_ללקוח, /מבחינת ההרשמה הכול מסודר/);
    assert.doesNotMatch(result.אישור_ללקוח, /הצוות יאמת/);
    assert.equal(result.ציוד.מצב, 'טרם נסגר');
    assert.match(result.ציוד.קישור, /\/api\/e\//);
    assert.match(result.ציוד.הסבר, /ציוד מהבית/);
    assert.match(result.הערה, /אין צורך בפעולה נוספת/);
  });
});

test('«ראשון ורביעי» הוא זוג של פעמיים בשבוע, לא שתי אפשרויות לבחור ביניהן', async () => {
  // תמר ביקשה „קבוצת תיכון ראשון ורביעי”. שתי הקבוצות התאימו, הכלי החזיר
  // „יותר מקבוצה אחת מתאימה”, והבוט אמר לה שיש כפילות בכרטיס של נעמי — דבר
  // שלא היה ולא נברא, ובוודאי לא משהו שהכלי אמר.
  const sunday = {
    id: 'g-teen-sun', name: 'חטיבה + תיכון — יום א׳ 18:40', ageCategory: 'חטיבה + תיכון',
    day: 0, time: '18:40', maxSlots: 12, priceWeek: 315, priceTwice: 430,
    signupLinkWeek: 'https://centre.example/teen-1', signupLinkTwice: 'https://centre.example/teen-2',
  };
  const wednesday = { ...sunday, id: 'g-teen-wed', name: 'חטיבה + תיכון — יום ד׳ 18:40', day: 3 };
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ id: 's-teen', name: 'נעמי כהן', birthDate: '2008-08-04' })],
    groups: [sunday, wednesday],
    health_declarations: [declarationFor('s-teen')],
    participation_waivers: [waiverFor('s-teen')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({
      childName: 'נעמי', studentId: 's-teen', band: 'תיכון', frequency: 'פעמיים בשבוע',
    });

    assert.equal(result.error, undefined, JSON.stringify(result));
    // שני הימים, לא אחד: המדריך של יום רביעי צריך לדעת עליה גם.
    assert.deepEqual(
      studentGroupIdsOf('s-teen').sort(),
      ['g-teen-sun', 'g-teen-wed']
    );

    // פעם בשבוע — עדיין שאלה לגיטימית, אבל בלי לרמוז על תקלה בכרטיס.
    const once = await tools.startSignup({
      childName: 'נעמי', studentId: 's-teen', band: 'תיכון', frequency: 'פעם בשבוע',
    });
    assert.match(once.error || '', /יש לשאול את הלקוח לאיזו מהן/);
    assert.match(once.error || '', /אינה בעיה בכרטיס/);
  });
});

test('רשום במתנ״ס בלי קבוצה — הבוט משבץ, ולא מעביר לצוות', async () => {
  // אריי כבר נרשם ושילם במתנ״ס, ואז אמו בחרה יום. הבוט ענה ש„כבר רשום
  // לחוג ולכן שיבוץ נעשה מול הצוות” — ולילד לא נשמר מקום באף קבוצה.
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'registered', groupId: null })],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({
      childName: 'יותם', studentId: 's-yotam', groupId: GROUP_GD.id, frequency: 'פעם בשבוע',
    });

    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.מקום_שמור, true);
    assert.equal(result.רשום_כבר_במתנס, true);
    // ההרשמה במתנ״ס היא עובדה — היא לא יורדת בחזרה ל„ממתין לאישור הורה”.
    assert.equal(student('s-yotam').status, 'registered');
    // ואין לשלוח אותו להירשם שוב, ולא לתת לו מועד אחרון.
    assert.match(result.הערה, /אין לבקש להירשם שוב/);
    assert.doesNotMatch(result.הערה, /בתוך 3 ימים/);
  });
});

test('רשום במתנ״ס ומשובץ בקבוצה — העברה בין קבוצות נשארת של הצוות', async () => {
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'registered', groupId: GROUP_GD.id })],
    groups: [GROUP_GD, GROUP_HV],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({
      childName: 'יותם', studentId: 's-yotam', groupId: GROUP_HV.id, frequency: 'פעם בשבוע',
    });
    assert.match(result.error || '', /כבר רשום לחוג ומשובץ בקבוצה/);
    assert.equal(student('s-yotam').groupId, GROUP_GD.id);
  });
});

test('כרטיס כפול שאוחד לארכיון אינו חוסם את השיבוץ', async () => {
  // שתי רשומות של נעמי באותו תיק — אחת שאוחדה לארכיון — והבוט ענה שלושה ימים
  // „יש כמה ילדים מתאימים”. מי שמסמן כפילות כארכיון לא אמור להידרש גם למחוק
  // אותה כדי שהשיבוץ יחזור לעבוד.
  await withSeed({
    parents: [PARENT],
    students: [
      childYotam({ id: 's-live', name: 'נעמי כהן', status: 'details_completed' }),
      childYotam({ id: 's-merged', name: 'נעמי כהן', status: 'archived' }),
    ],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-live')],
    participation_waivers: [waiverFor('s-live')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.startSignup({
      childName: 'נעמי', grade: 'ג', frequency: 'פעם בשבוע',
    });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.שובץ, 'נעמי כהן');
    assert.equal(student('s-live').groupId, GROUP_GD.id);
    assert.equal(student('s-merged').groupId, null);
  });
});

test('הכרטיס אומר איזה צעד בהרשמה עדיין פתוח, עד שכולם נסגרו', async () => {
  // הבוט נהג לסגור שיחה בכל שלב שסיים — „הפרטים התקבלו”, „הילד משובץ” —
  // והפער התגלה שבועות אחר כך כילד בלי קבוצה או ציוד שאיש לא שילם עליו.
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'health_signed', groupId: null })],
    groups: [GROUP_GD],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const noForm = await tools.getFamilyCard();
    assert.match(noForm.ילדים[0].הצעד_הבא, /להשלים את/);
    assert.equal(noForm.ילדים[0].הרשמה_שלמה, false);
    assert.match(noForm.הערת_הרשמה, /אין לומר «אין צורך בפעולה נוספת»/);
  });

  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'health_signed', groupId: null })],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const card = await tools.getFamilyCard();
    assert.match(card.ילדים[0].הצעד_הבא, /לבחור קבוצה/);
  });

  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'awaiting_parent_confirmation', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const card = await tools.getFamilyCard();
    assert.match(card.ילדים[0].הצעד_הבא, /להירשם במתנ״ס/);
  });

  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'registered', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
    student_equipment: [{ id: 'se-1', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' }],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const card = await tools.getFamilyCard();
    assert.match(card.ילדים[0].הצעד_הבא, /להסדיר את הציוד/);
  });

  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'registered', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
    student_equipment: [{ id: 'se-1', student_id: 's-yotam', item_type: 'shoes', payment_status: 'own' }],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const card = await tools.getFamilyCard();
    assert.equal(card.ילדים[0].הרשמה_שלמה, true);
    assert.equal(card.ילדים[0].הצעד_הבא, undefined);
    assert.match(card.הערת_הרשמה, /ההרשמה שלמה/);
  });
});

test('תאריך לידה אינו נתון שהבוט אוסף או כותב', async () => {
  // אמא כתבה „4.12.82” על ילדה בכיתה ג׳, זה נקרא 1982, והכרטיס עבר מגיל שבע
  // לגיל 44 — ומשם שום התאמת קבוצה לא יכלה לעבוד. התאריך מגיע מטופס
  // ההשתתפות, בכתב וחתום, ולכן הכלי הזה כבר לא קיים.
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ birthDate: '2017-05-01' })],
    groups: [GROUP_GD],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    assert.equal(tools.updateTraineeBirthDate, undefined);
    assert.equal(student('s-yotam').birthDate, '2017-05-01');
  });
});

test('אח מהעבר בארכיון אינו הופך «נרשמנו» לשאלה על מי מדובר', async () => {
  // אפרת כתבה „נרשמתי גם במתנס וגם מילאתי כבר הכל”. בכרטיס שני ילדים — אחד
  // בארכיון משנה שעברה — והדיווח נפל על „יש כמה ילדים מתאימים”, כך שהיא קיבלה
  // העברה לצוות במקום אישור.
  await withSeed({
    parents: [PARENT],
    students: [
      childYotam({ id: 's-open', name: 'איתמר כהן', status: 'awaiting_centre_confirmation', groupId: GROUP_GD.id }),
      childYotam({ id: 's-gone', name: 'יערה כהן', status: 'archived', groupId: null }),
    ],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-open')],
    participation_waivers: [waiverFor('s-open')],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.reportCentreRegistration({});
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.נרשם_לבדיקה, 'איתמר כהן');
  });
});

test('הלקוחה מדווחת שנרשמה, והמודל מדבר סביב זה — הדיווח נרשם בכל זאת', async () => {
  // אביבית כתבה פעמיים שהיא השלימה הרשמה, ופעמיים קיבלה „אני לא רואה
  // שהפעולה נקלטה במערכת”. היא לא שאלה על פעולה — היא דיווחה על אחת.
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'pending_signup', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
    health_declarations: [declarationFor('s-yotam')],
    participation_waivers: [waiverFor('s-yotam')],
  }, async () => {
    const turn = await runCustomerToolTurn({
      parent: PARENT,
      phone: PARENT.phone,
      incomingText: 'היי השלמנו הרשמה אשמח לאשר',
      apiKey: 'test-key',
      // The one-word intent question is answered separately: whether a
      // message reports a completed registration is the model's call now,
      // not a word list's — see customerIntent.
      callModel: async (args = {}) => ({
        content: /ענה במילה אחת/u.test(String(args.systemInstruction || ''))
          ? { role: 'model', parts: [{ text: 'כן' }] }
          : { role: 'model', parts: [{ text: 'מעולה, עדכנתי שההרשמה במתנ״ס הושלמה' }] },
        error: '',
      }),
    });

    assert.equal(turn.reason, 'registration_report_recorded');
    assert.equal(turn.handoff, false);
    assert.match(turn.text, /יותם כהן משובץ אצלנו/);
    assert.doesNotMatch(turn.text, /נקלטה במערכת/);
    assert.ok(turn.toolsUsed.includes('reportCentreRegistration'));
    // והדיווח עצמו נשמר, לא רק נאמר.
    assert.equal((db.get('centre_registration_checks') || []).length > 0, true);
  });
});

// מי שנרשם ישירות במתנ״ס לא עבר דרכנו מעולם, ולכן איש לא שלח לו את הטופס.
// דיווח ההרשמה הוא ההזדמנות האחת לומר לו שבלי זה אין שיבוץ.
test('נרשם ישירות במתנ״ס — הדיווח מחזיר שחסר טופס ההשתתפות ושאי אפשר לשבץ בלעדיו', async () => {
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'pending_signup', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.reportCentreRegistration({ childName: 'יותם' });

    assert.match(result.מסמכים.מצב, /חסר/);
    assert.ok(result.מסמכים.קישור);
    assert.match(result.מסמכים.הסבר, /אי אפשר לשבץ את יותם/);
    assert.match(result.הערה, /אי אפשר לשבץ/);
  });
});

test('הרשמה במתנ״ס כשהמסמכים חתומים — אין מה לבקש', async () => {
  await withSeed({
    parents: [PARENT],
    students: [childYotam({ status: 'pending_signup', groupId: GROUP_GD.id })],
    groups: [GROUP_GD],
    ...signedFormFor(['s-yotam']),
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const result = await tools.reportCentreRegistration({ childName: 'יותם' });

    assert.equal(result.מסמכים.מצב, 'חתומים ובתוקף');
    assert.equal(result.מסמכים.קישור, undefined);
  });
});

test('a returning participant is found only by one safe full-name match', async () => {
  const owner = { id: 'p-old', name: 'Dana Rubin', lastName: 'Rubin', phone: '0500000000' };
  const current = { ...PARENT, name: 'Noa Rubin', lastName: 'Rubin' };
  await withSeed({
    parents: [current, owner],
    students: [{ id: 's-dor', parentId: owner.id, name: 'Dor Rubin', gender: 'male' }],
    level_tests: [{ id: 'lt-dor', student_id: 's-dor', level: '6B', tested_at: SIGNED_TODAY }],
    program_eligibility: [{ id: 'pe-dor', student_id: 's-dor', season: '2026-27', program: 'young_squad', status: 'returning', source: 'notion_previous_season' }],
  }, async () => {
    const tools = buildCustomerTools({ parent: current, phone: current.phone });
    const found = await tools.findExistingParticipant({ childName: 'Dor Rubin' });
    assert.equal(found.נמצא, true);
    assert.equal(found.שם, 'Dor Rubin');
    assert.equal(found.מבחן_רמה_אחרון, '6B');
    assert.match(JSON.stringify(found.זכאות_למסלולים), /returning/);

    const unsafe = await tools.findExistingParticipant({ childName: 'Dor' });
    assert.equal(unsafe.נמצא, false);
  });
});

test('גם למי שיש ציוד — צריך להיכנס לקישור ולסמן', async () => {
  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam()],
    ...signedFormFor(['s-yotam']),
    student_equipment: [
      { id: 'se-1', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' },
    ],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const link = await tools.getEquipmentPaymentLink({ childName: 'יותם' });

    // «אנחנו לא צריכים ציוד, יש לנו משנה שעברה» — וההורה לא ידע שצריך
    // בכל זאת להיכנס ולסמן, ולכן הפריט נשאר חסר במערכת.
    assert.match(link.הערה, /בכל מקרה/);
    assert.match(link.הערה, /נשאר חסר/);
    // וזה נאמר כבר בהודעה הראשונה, לא רק כשההורה מספר שיש לו.
    assert.match(link.מה_לומר, /בהודעה הראשונה/);
    assert.match(link.מה_לומר, /לסמן פריט שכבר יש/);
  });

  const { CUSTOMER_TOOL_RULES } = await import('./botToolTurn.js');
  assert.match(CUSTOMER_TOOL_RULES, /אל תאמר «מצוין, אין צורך»/);
  assert.match(CUSTOMER_TOOL_RULES, /כבר בהודעה הראשונה/);
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
    assert.match(pack.שלב_2_הרשמה_לקבוצה.הסבר, /אינם אישור סופי/);
    assert.match(pack.שלב_2_הרשמה_לקבוצה.הסבר, /אימות מהמתנ״ס או מהצוות/);
    assert.doesNotMatch(pack.שלב_2_הרשמה_לקבוצה.הסבר, /אחרי כמה ימים/);
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
        textReply('יותם משובץ לקבוצת ג׳-ד׳ ביום א׳ 16:00. המקום שמור לשלושה ימים עד לאישור ההרשמה במתנ״ס.'),
      ]),
    });

    assert.equal(turn.reason, 'ok');
    assert.match(turn.text, /המקום שמור/);
    assert.deepEqual(turn.toolsUsed, ['startSignup']);
    assert.equal(student('s-yotam').status, 'awaiting_parent_confirmation');
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

// ─── נבחרת ───────────────────────────────────────────────────────────────────

test('נבחרת חוזרת עם תנאי הכניסה שלה, לא רק עם הרמה', async () => {
  const SQUAD = {
    id: 'g-squad',
    name: 'נבחרת חטיבה — ב׳+ה׳ 17:00',
    ageCategory: 'חטיבה',
    skillLevel: 'נבחרת',
    day: 1,
    time: '17:00',
    maxSlots: 12,
    priceWeek: 0,
    priceTwice: 520,
    signupLinkTwice: 'https://forms.example.com/squad',
  };
  await withSeed({ groups: [SQUAD], students: [] }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    // אמא של ילד שרק מתחיל לטפס שאלה מה ההבדל, וקיבלה «מיועדת למתאמנים
    // בעלי מוטיבציה גבוהה» — כאילו זו בחירה שלה.
    const asked = await tools.listClasses({ band: 'חטיבה', level: 'נבחרת' });
    const [squad] = asked.קבוצות;
    assert.match(squad.תנאי_כניסה, /באישור צוות הקיר/);
    assert.match(squad.תנאי_כניסה, /ניסיון של כמה שנים/);
    assert.match(squad.תנאי_כניסה, /מתחיל לטפס/);
    assert.match(squad.תחילת_עונת_החוגים, /1 בספטמבר \d{4}/);

    // וקבוצה רגילה אינה נושאת תנאי כניסה בכלל.
    const regular = await tools.listClasses({ grade: 'ג' });
    assert.equal(regular.קבוצות.some((g) => g.תנאי_כניסה), false);
  });

  const { CUSTOMER_TOOL_RULES } = await import('./botToolTurn.js');
  assert.match(CUSTOMER_TOOL_RULES, /קבלה של מועמד חדש דורשת אישור צוות/);
  assert.match(CUSTOMER_TOOL_RULES, /returning או approved/);
  assert.match(CUSTOMER_TOOL_RULES, /אינה מתאימה לו בשלב הזה/);
});

// ─── שעות פתיחה ──────────────────────────────────────────────────────────────

const openingHoursOn = (date) => ({
  id: `oh-${date}`,
  type: 'opening_hours',
  name: 'שעות פתיחה',
  date,
  start_time: '16:30',
  end_time: '21:00',
});

/** מחר ומחרתיים, כדי שהיום עצמו לעולם לא יהיה אחד מהם. */
function dayAfter(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('היום סגור — הכלי אומר את זה במפורש, ולא רק מונה ימים פתוחים', async () => {
  await withSeed({ activities: [openingHoursOn(dayAfter(2)), openingHoursOn(dayAfter(5))] }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const hours = await tools.getOpeningHours();

    // «אפשר להגיע היום בין 16:30–21:00» נאמר ללקוחה ביום שהקיר סגור, והיא
    // כמעט הגיעה להחזיר ציוד. השעות היו אמיתיות — היום לא.
    assert.equal(hours.היום.פתוח, false);
    assert.equal(hours.היום.שעות, undefined);
    assert.match(hours.הערה, /היום סגור/);
    assert.equal(hours.ימים_פתוחים.length, 2);
    assert.ok(hours.ימים_פתוחים[0].תאריך);
    assert.match(hours.ימים_פתוחים[0].שעות, /16:30/);
  });
});

test('היום פתוח — מותר לומר «היום», עם השעות של היום עצמו', async () => {
  await withSeed({ activities: [openingHoursOn(dayAfter(0)), openingHoursOn(dayAfter(3))] }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const hours = await tools.getOpeningHours();

    assert.equal(hours.היום.פתוח, true);
    assert.match(hours.היום.שעות, /16:30–21:00/);
    assert.match(hours.הערה, /מותר לומר/);
  });
});

test('אין שעות ביומן — אין מה לומר, ואין להמציא', async () => {
  await withSeed({ activities: [] }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const hours = await tools.getOpeningHours();
    assert.deepEqual(hours.ימים_פתוחים, []);
    assert.match(hours.הערה, /לא עודכנו/);
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

test('מודל שנופל אינו הופך לניחוש — הבוט שותק ומפעיל את מנגנון התקלה', async () => {
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
        isSimulator: true,
      });
      assert.equal(result.handoff, false);
      assert.equal(result.reason, 'no_model');
      assert.equal(result.silent, true);
      assert.equal(result.text, '');
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

    assert.equal(alma.סטטוס, 'details_completed');
    assert.match(alma.הערת_סטטוס, /אין להציג/);
    assert.match(card.הערה, /אין לחשב גיל/);
  });
});

test('תשלום על אימון היכרות נראה בכרטיס — הוא לא „דיווח לבדיקה”', async () => {
  // האמא שילמה וכתבה „בוצע, תודה”. הבוט ענה שהדיווח התקבל לבדיקה ושהמקום
  // יישמר „ברגע שהתשלום יאומת” — חמישים שניות אחרי ש-paid_at כבר נכתב על
  // ההזמנה. כסף שאנחנו רואים אינו טענה של לקוח.
  const booking = (patch) => ({
    id: 'ib-test', student_id: 's-yotam', student_name: 'יותם כהן', group_id: GROUP_GD.id,
    session_date: '2026-09-06', status: 'scheduled', ...patch,
  });

  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam({ status: 'intro_scheduled', groupId: GROUP_GD.id })],
    ...signedFormFor(['s-yotam']),
    [INTRO_COLLECTION]: [booking({ paid_at: null })],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const kid = (await tools.getFamilyCard()).ילדים[0];
    assert.equal(kid.אימון_היכרות.שולם, false);
    assert.match(kid.אימון_היכרות.הערה, /טרם נקלט/);
  });

  await withSeed({
    groups: [GROUP_GD],
    students: [childYotam({ status: 'intro_scheduled', groupId: GROUP_GD.id })],
    ...signedFormFor(['s-yotam']),
    [INTRO_COLLECTION]: [booking({ paid_at: '2026-08-20T09:10:12.909Z' })],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });
    const kid = (await tools.getFamilyCard()).ילדים[0];
    assert.equal(kid.אימון_היכרות.שולם, true);
    assert.ok(kid.אימון_היכרות.תאריך, 'ציפינו לתאריך האימון בכרטיס');
    assert.doesNotMatch(kid.אימון_היכרות.הערה, /טרם נקלט/);
  });
});
test('שאלה של הלקוח אינה שם', async () => {
  // ליבי שאלה „באיזה עיר”, ולא היה בזה סימן שאלה ולא מילה מרשימת המילים —
  // אז הכרטיס שלה נשמר בשם „ליבי באיזה עיר”. אחרי זה היא עזבה.
  const says = (word) => async () => ({ content: { role: 'model', parts: [{ text: word }] }, error: '' });
  await withSeed({ parents: [NEW_CARD] }, async () => {
    const phone = NEW_CARD.phone;
    await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'היי', { callModel: says('כן') });

    const asked = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'באיזה עיר', {
      callModel: says('לא'),
    });
    // השאלה עוברת למודל שיענה עליה, והשם עדיין לא נשמר.
    assert.equal(asked.nameDeferred, true);
    assert.equal(asked.pendingMessage, 'באיזה עיר');
    assert.equal(cardById('p-fresh').name, NEW_CARD.name);
    assert.ok(!String(cardById('p-fresh').name || '').includes('באיזה'));

    // וגם שאלה שברור שאינה שם — סימן שאלה ומילות שאלה — נענית, ולא נענית
    // ב„סליחה, לא הבנתי”. כך אבדה מתעניינת ששאלה על אחיינית בת 5.
    const plainQuestion = await advanceCustomerNameCapture(
      phone, cardById('p-fresh'), 'יש לכם טרובלו לילדה בת 5?', { callModel: says('לא') }
    );
    assert.equal(plainQuestion.nameDeferred, true);
    assert.equal(plainQuestion.done, true);
    assert.equal(cardById('p-fresh').name, NEW_CARD.name);

    // ושם אמיתי אחר כך נשמר כרגיל.
    const named = await advanceCustomerNameCapture(phone, cardById('p-fresh'), 'ליבי', {
      callModel: says('כן'),
    });
    assert.equal(named.done, true);
    assert.equal(named.parent.name, 'ליבי');
  });
});

test('כרטיס כפול שהועבר לארכיון אינו חוסם את קישור הציוד', async () => {
  // תמר נשאלה „תרצו שאשלח את הקישור להסדרת הציוד?”, ענתה „כן”, וקיבלה העברה
  // לצוות. בכרטיס של נעמי היו שני רישומים באותו שם — אחד מהם קליפה שנשארה
  // אחרי איחוד — והכלי דיווח על ריבוי מתאמנים. אותה כפילות כבר חסמה לה את
  // השיבוץ שלושה ימים קודם, ותוקנה שם בלבד.
  await withSeed({
    groups: [GROUP_GD],
    students: [
      childYotam({ status: 'awaiting_centre_confirmation', groupId: 'g-gd' }),
      { id: 's-yotam-shell', name: 'יותם כהן', parentId: PARENT.id, status: 'archived', groupId: null },
    ],
    ...signedFormFor(['s-yotam']),
    student_equipment: [
      { id: 'se-shoes', student_id: 's-yotam', item_type: 'shoes', payment_status: 'unpaid' },
    ],
  }, async () => {
    const tools = buildCustomerTools({ parent: PARENT, phone: PARENT.phone });

    const link = await tools.getEquipmentPaymentLink({ childName: 'יותם' });
    assert.ok(link.קישור, link.הערה || 'ציפינו לקישור ציוד');
    assert.equal(link.מתאמן, 'יותם כהן');

    // אותה כפילות לא תחסום גם את הכלים האחרים שבוחרים ילד לפי שם.
    const eligibility = await tools.getPlacementEligibility({ childName: 'יותם' });
    assert.equal(eligibility.error, undefined);
  });
});
