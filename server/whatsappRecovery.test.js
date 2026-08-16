process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unansweredRecoveryCandidates,
  centreStudentName,
  isCentreGreeting,
  greetingFor,
} from './whatsapp.js';

const NOW = Date.parse('2026-08-09T17:00:00.000Z');
const at = (secondsAgo) => new Date(NOW - secondsAgo * 1000).toISOString();

test('recovery combines every unanswered text after the latest outbound reply', () => {
  const rows = [
    { phone: '0501111111', channel: 'whatsapp', direction: 'outbound', message: 'old reply', created_at: at(90) },
    { id: 'm1', phone: '0501111111', channel: 'whatsapp', direction: 'inbound', message: 'first part', created_at: at(50) },
    { id: 'm2', phone: '0501111111', channel: 'whatsapp', direction: 'inbound', message: 'second part', created_at: at(45) },
  ];
  const candidates = unansweredRecoveryCandidates(rows, { now: NOW });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].pending.map((row) => row.id), ['m1', 'm2']);
});

test('recovery ignores acknowledgements, media, fresh messages and already answered text', () => {
  const rows = [
    { phone: '0502000001', channel: 'whatsapp', direction: 'inbound', message: 'תודה', created_at: at(60) },
    { phone: '0502000002', channel: 'whatsapp', direction: 'inbound', message: '', message_type: 'image', created_at: at(60) },
    { phone: '0502000003', channel: 'whatsapp', direction: 'inbound', message: 'still typing', created_at: at(5) },
    { phone: '0502000004', channel: 'whatsapp', direction: 'inbound', message: 'question', created_at: at(60) },
    { phone: '0502000004', channel: 'whatsapp', direction: 'outbound', message: 'answer', created_at: at(50) },
  ];
  assert.deepEqual(unansweredRecoveryCandidates(rows, { now: NOW }), []);
});

test('a message swallowed hours ago is still worth answering, up to a day', () => {
  const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();
  const rows = [
    // «אפשר לשבץ?» sat unanswered from the afternoon: the old two-hour window
    // meant that by the time anyone looked, nobody would ever answer it.
    { id: 'old', phone: '0503000001', channel: 'whatsapp', direction: 'inbound', message: 'אפשר לשבץ?', created_at: hoursAgo(6) },
    // Past a day Meta will not carry free text anyway, so there is nothing to send.
    { id: 'ancient', phone: '0503000002', channel: 'whatsapp', direction: 'inbound', message: 'יש מקום?', created_at: hoursAgo(30) },
  ];
  const phones = unansweredRecoveryCandidates(rows, { now: NOW }).map((c) => c.phone);
  // The phone comes back normalised, the way every other lookup stores it.
  assert.deepEqual(phones, ['972503000001']);
});

test('a handoff holds the bot for minutes, not for ever', async () => {
  const { hasOpenBotHandoff } = await import('./whatsappBot.js');
  const card = (minutesAgo) => ({
    phone: '0599111000',
    bot_handoff_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });

  // The burst this was written for: further bubbles must not each get their
  // own "passing this to the team".
  assert.equal(hasOpenBotHandoff(card(1), '0599111000'), true);

  // But an ordinary question three minutes later, or the next day, deserves an
  // answer. Nine customers in two days were met with silence instead.
  assert.equal(hasOpenBotHandoff(card(30), '0599111000'), false);
  assert.equal(hasOpenBotHandoff(card(60 * 24), '0599111000'), false);
  assert.equal(hasOpenBotHandoff({ phone: '0599111000' }, '0599111000'), false);
});

test('a staff reply from the CRM holds the bot, even if only `messages` has it', async () => {
  const { shouldDeferToHumanStaff } = await import('./whatsappBot.js');
  const { db } = await import('./db.js');
  const phone = '972546103606';
  const backup = { messages: db.get('messages') || [], logs: db.get('whatsapp_logs') || [] };
  try {
    // Exactly the shape that slipped through: sent from the CRM three minutes
    // ago, present in `messages`, absent from the local mirror.
    db.set('messages', [{
      phone,
      channel: 'whatsapp',
      direction: 'outbound',
      is_ai: false,
      source: 'crm',
      message: 'כך שאין מה לחשוש מראשון או רביעי',
      created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    }]);
    db.set('whatsapp_logs', []);
    assert.equal(shouldDeferToHumanStaff(phone, { withinMinutes: 10 }), true);

    // And once the hold has passed, the bot speaks again.
    db.set('messages', [{
      phone,
      channel: 'whatsapp',
      direction: 'outbound',
      is_ai: false,
      source: 'crm',
      message: 'כך שאין מה לחשוש',
      created_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    }]);
    assert.equal(shouldDeferToHumanStaff(phone, { withinMinutes: 10 }), false);
  } finally {
    db.set('messages', backup.messages);
    db.set('whatsapp_logs', backup.logs);
  }
});

test('what the centre types is read as a name, and a greeting is read as a greeting', () => {
  // The verb rode along into the lookup, and the answer the secretary got was
  // "לא מצאתי אצלנו מתאמן בשם אלימלך קרני נרשם".
  assert.equal(centreStudentName('אלימלך קרני נרשם'), 'אלימלך קרני');
  assert.equal(centreStudentName('נטע יאירי'), 'נטע יאירי');
  assert.equal(centreStudentName('הוא נרשם במתנס'), '');
  assert.equal(centreStudentName('מתי איתמר גיגי התחיל?'), 'איתמר גיגי');
  // The length limit counts the name, not the sentence around it.
  assert.equal(centreStudentName('נטע יאירי נרשמה אצלכם במתנ״ס'), 'נטע יאירי');
  assert.equal(centreStudentName('נטע יאירי ביטל את ההרשמה'), 'נטע יאירי');

  // "בוקר טוב" fell through to the ordinary customer flow, which asked the
  // מתנ״ס secretary what her first name was.
  assert.equal(centreStudentName('בוקר טוב'), '');
  assert.equal(isCentreGreeting('בוקר טוב'), true);
  assert.equal(isCentreGreeting('נטע יאירי'), false);
  assert.equal(greetingFor('בוקר טוב'), 'בוקר טוב');
  assert.equal(greetingFor('ערב טוב'), 'ערב טוב');
  assert.equal(greetingFor('אהלן'), 'היי');
});
