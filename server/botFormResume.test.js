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
  gradeQuestionAfterForm,
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
    // The model is told what happened, in a line marked as a system update so
    // it is never read back to the customer as something they wrote.
    const [{ text }] = service.calls.generated;
    assert.match(text, /^\[מערכת\]/);
    assert.match(text, /ראם כהן/);
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

test('כשל מודל אחרי טופס אינו שולח העברה לצוות, אלא ממשיך את שאלת הכיתות', async () => {
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
    assert.equal(result.fallback, true);
    assert.equal(service.calls.sent.length, 1);
    assert.equal(
      service.calls.sent[0].text,
      'כדי להמשיך, מה הכיתה של תום כיום, ומה הכיתה של אביב?'
    );
    assert.doesNotMatch(service.calls.sent[0].text, /צוות/);
  });
});

test('כשל מודל בלי צעד בטוח להמשך נשאר שקט ולא ממציא העברה', async () => {
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
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'handoff_suppressed');
    assert.equal(service.calls.sent.length, 0);
  });
});

test('שאלת כיתה אחרי טופס מפרידה בין כל ילד', () => {
  const messages = [{
    direction: 'outbound',
    is_ai: true,
    message: 'באיזו כיתה תום ואביב לומדים?',
  }];
  assert.equal(
    gradeQuestionAfterForm(messages, ['תום פרידמן', 'אביב פרידמן']),
    'כדי להמשיך, מה הכיתה של תום כיום, ומה הכיתה של אביב?'
  );
});
