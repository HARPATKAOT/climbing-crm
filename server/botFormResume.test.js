/**
 * ההמשך אחרי חתימת הטופס — מתי הבוט חוזר לשיחה, ומתי הוא שותק.
 *
 * המקרה שנולד ממנו: הורה ביקש לרשום את ראם, נאמר לו שקודם ממלאים טופס, הוא מילא
 * — והשיחה נגמרה ב„נחזור אליכם”. כל מה שצריך כדי לסיים כבר נאמר בשיחה עצמה.
 */
process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import {
  botSpokeRecently,
  hasRecentClassSignupIntent,
  placementQuestionAfterForm,
  resumeConversationAfterForm,
} from './botFormResume.js';

const PHONE = '972599111000';
const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();

const PARENT = {
  id: 'p-resume',
  name: 'דנה כהן',
  lastName: 'כהן',
  phone: PHONE,
  last_inbound_whatsapp: minutesAgo(10),
};

const BOT_THREAD = [
  { phone: PHONE, direction: 'inbound', message: 'רוצה לרשום את ראם', created_at: minutesAgo(20) },
  { phone: PHONE, direction: 'outbound', is_ai: true, message: 'קודם ממלאים טופס השתתפות', created_at: minutesAgo(15) },
];

async function withWorld(data, run) {
  const keys = ['parents', 'messages', 'students'];
  const backup = {};
  for (const key of keys) backup[key] = db.get(key) || [];
  for (const key of keys) db.set(key, structuredClone(data[key] || []));
  try {
    await run();
  } finally {
    for (const key of keys) db.set(key, backup[key]);
  }
}

/** Records what the bot was asked and what it was told to send. */
function fakeService(reply = 'הטופס של ראם התקבל 🙂 לשבץ אותו ליום ג׳ 17:10?') {
  const calls = { generated: [], sent: [] };
  return {
    calls,
    generateAIResponse: async (text, context) => {
      calls.generated.push({ text, context });
      return { text: reply, handoff: false, confidence: 'medium' };
    },
    sendBotReply: async (phone, text) => {
      calls.sent.push({ phone, text });
      return { success: true };
    },
  };
}

test('אחרי חתימה, הבוט חוזר לשיחה עם מה שכבר סוכם בה', async () => {
  await withWorld({ parents: [PARENT], messages: BOT_THREAD }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE,
      studentNames: ['ראם כהן'],
      whatsappService: service,
      now: NOW,
      isSimulator: true,
    });

    assert.equal(result.sent, true);
    assert.equal(service.calls.sent.length, 1);
    assert.equal(service.calls.generated.length, 0);
    assert.equal(service.calls.sent[0].text, 'הפרטים התקבלו. לאיזו קבוצה תרצו להשתבץ?');
  });
});

test('טופס שמולא בלי שיחה עם הבוט אינו פותח שיחה יזומה', async () => {
  await withWorld({
    parents: [PARENT],
    // Only staff wrote here — the bot was never part of this thread.
    messages: [{ phone: PHONE, direction: 'outbound', is_ai: false, message: 'שלחתי לך טופס', created_at: minutesAgo(30) }],
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE,
      studentNames: ['ראם כהן'],
      whatsappService: service,
      now: NOW,
      isSimulator: true,
    });

    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no_recent_conversation');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('טופס לכניסה לקיר אינו פותח שאלת שיבוץ לחוג', async () => {
  const arrivalThread = [
    { phone: PHONE, direction: 'inbound', message: 'שקד בדרך לטפס', created_at: minutesAgo(20) },
    { phone: PHONE, direction: 'outbound', is_ai: true, message: 'חסר טופס השתתפות, הנה הקישור', created_at: minutesAgo(15) },
  ];
  await withWorld({ parents: [PARENT], messages: arrivalThread }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE,
      studentNames: ['שקד לוין'],
      whatsappService: service,
      now: NOW,
      isSimulator: true,
    });
    assert.equal(hasRecentClassSignupIntent(arrivalThread, NOW), false);
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'no_class_signup_intent');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('לקוח שביקש להפסיק, או שהבוט מושתק אצלו, לא מקבל כלום', async () => {
  await withWorld({
    parents: [{ ...PARENT, bot_opted_out: true }],
    messages: BOT_THREAD,
  }, async () => {
    const service = fakeService();
    const optedOut = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['ראם כהן'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(optedOut.reason, 'opted_out');
    assert.equal(service.calls.sent.length, 0);
  });

  await withWorld({
    parents: [{ ...PARENT, bot_paused_until: new Date(NOW + 60 * 60_000).toISOString() }],
    messages: BOT_THREAD,
  }, async () => {
    const service = fakeService();
    const paused = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['ראם כהן'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(paused.reason, 'paused');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('חלון 24 השעות סגור — אין הודעה יזומה בטקסט חופשי', async () => {
  await withWorld({
    parents: [{ ...PARENT, last_inbound_whatsapp: new Date(NOW - 30 * 60 * 60_000).toISOString() }],
    messages: BOT_THREAD,
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['ראם כהן'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(result.reason, 'window_closed');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('completion of a form stays silent while a staff handoff is still open', async () => {
  await withWorld({
    // Fresh enough that a person is still expected to pick it up. An hour
    // later the bot answers again — see the handoff hold.
    parents: [{ ...PARENT, bot_handoff_at: new Date(Date.now() - 60_000).toISOString() }],
    messages: BOT_THREAD,
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE,
      studentNames: ['Ram Cohen'],
      whatsappService: service,
      now: NOW,
      isSimulator: true,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'handoff_pending');
    assert.equal(service.calls.generated.length, 0);
    assert.equal(service.calls.sent.length, 0);
  });
});

test('הבוט בדיוק ענה — אין הודעה שנייה ברצף על אותו שיבוץ', async () => {
  await withWorld({
    parents: [PARENT],
    messages: [
      ...BOT_THREAD,
      // עדי ורמז קיבלה שתי הודעות בזו אחר זו: התשובה הרגילה עם הקישורים,
      // ומיד אחריה «שיבצתי את נועם…» — שתיהן על אותו שיבוץ.
      {
        phone: PHONE,
        direction: 'outbound',
        is_ai: true,
        message: 'השיבוץ של נועם נשמר. הרשמה: … ציוד: …',
        created_at: minutesAgo(1),
      },
    ],
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['נועם ורמז'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'just_answered');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('אישור הקליטה האוטומטי נחשב הודעה — אין שנייה אחריו', async () => {
  await withWorld({
    parents: [PARENT],
    messages: [
      ...BOT_THREAD,
      // עדי פלג קיבלה ב-13:53 «קיבלנו את הפרטים… נחזור אליכם», ודקה אחריה
      // הודעה נוספת על אותו טופס עצמו. אירוע אחד, שתי הודעות.
      {
        phone: PHONE,
        direction: 'outbound',
        is_ai: false,
        source: 'automation',
        message: 'שלום עדי, קיבלנו את הפרטים ואת הצהרת הבריאות של נדב.',
        created_at: minutesAgo(1),
      },
    ],
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['נדב פלג'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'just_answered');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('קוד אימות אינו נחשב הודעה ששווה להיסוג מפניה', async () => {
  await withWorld({
    parents: [PARENT],
    messages: [
      ...BOT_THREAD,
      {
        phone: PHONE,
        direction: 'outbound',
        is_ai: false,
        source: 'otp',
        message: '123456 הוא קוד האימות שלך',
        created_at: minutesAgo(1),
      },
    ],
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['נדב פלג'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(result.sent, true);
    assert.equal(service.calls.sent.length, 1);
  });
});

test('מי שכבר שובץ אינו נשאל שוב לאיזו קבוצה', async () => {
  await withWorld({
    parents: [PARENT],
    messages: BOT_THREAD,
    students: [{ id: 'st-noam', name: 'נועם ורמז', parentId: PARENT.id, groupId: 'g-1' }],
  }, async () => {
    const service = fakeService();
    const result = await resumeConversationAfterForm({
      phone: PHONE, studentNames: ['נועם ורמז'], whatsappService: service, now: NOW, isSimulator: true,
    });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'already_placed');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('botSpokeRecently מבדיל בין שיחה של הבוט לשיחה של אדם', () => {
  assert.equal(botSpokeRecently(BOT_THREAD, PHONE, NOW), true);
  assert.equal(
    botSpokeRecently([{ direction: 'outbound', is_ai: false, created_at: minutesAgo(5) }], PHONE, NOW),
    false
  );
  assert.equal(
    botSpokeRecently([{ direction: 'outbound', is_ai: true, created_at: new Date(NOW - 40 * 60 * 60_000).toISOString() }], PHONE, NOW),
    false
  );
});

test('אחרי טופס מאשרים פעם אחת ושואלים רק על הקבוצה', async () => {
  const gradeThread = [
    { phone: PHONE, direction: 'inbound', message: 'בשביל תום ואביב', created_at: minutesAgo(20) },
    {
      phone: PHONE,
      direction: 'outbound',
      is_ai: true,
      message: 'מלאו טופס השתתפות. באיזו כיתה תום ואביב לומדים כיום?',
      created_at: minutesAgo(15),
    },
  ];
  await withWorld({ parents: [PARENT], messages: gradeThread }, async () => {
    const service = fakeService('קיבלנו 🙏\nמעביר לצוות שלנו — מישהו יחזור אליכם בהקדם.');
    service.generateAIResponse = async (text, context) => {
      service.calls.generated.push({ text, context });
      return { text: 'קיבלנו 🙏\nמעביר לצוות שלנו — מישהו יחזור אליכם בהקדם.', handoff: true };
    };
    const result = await resumeConversationAfterForm({
      phone: PHONE,
      studentNames: ['תום פרידמן', 'אביב פרידמן'],
      whatsappService: service,
      now: NOW,
      isSimulator: true,
    });

    assert.equal(result.sent, true);
    assert.equal(result.deterministic, true);
    assert.equal(service.calls.generated.length, 0);
    assert.equal(service.calls.sent.length, 1);
    assert.equal(
      service.calls.sent[0].text,
      'הפרטים התקבלו. לאילו קבוצות תרצו לשבץ את תום ואביב?'
    );
    assert.doesNotMatch(service.calls.sent[0].text, /כיתה|בריאות|צוות/);
  });
});

test('המשך אחרי הטופס אינו תלוי במודל', async () => {
  await withWorld({ parents: [PARENT], messages: BOT_THREAD }, async () => {
    const service = fakeService('מעביר לצוות');
    service.generateAIResponse = async () => ({ text: 'מעביר לצוות', handoff: true });
    const result = await resumeConversationAfterForm({
      phone: PHONE,
      studentNames: ['ראם כהן'],
      whatsappService: service,
      now: NOW,
      isSimulator: true,
    });
    assert.equal(result.sent, true);
    assert.equal(result.deterministic, true);
    assert.equal(service.calls.sent.length, 1);
    assert.equal(service.calls.generated.length, 0);
  });
});

test('שאלת השיבוץ אחרי טופס מפרידה בין כל ילד', () => {
  assert.equal(
    placementQuestionAfterForm(['תום פרידמן', 'אביב פרידמן']),
    'הפרטים התקבלו. לאילו קבוצות תרצו לשבץ את תום ואביב?'
  );
});
