/**
 * „אם אני עכשיו מדבר בשיחה — שלא יתערב, כל עוד לא נשאל משהו חדש.”
 *
 * הבוט כתב „מעביר לצוות” שלוש פעמים בתוך תיאום יום הולדת שהצוות כבר ניהל
 * באותה שיחה, כי ההגנה היחידה שהייתה היא טיימר של דקה. טיימר אינו יודע להבחין
 * בין „כן, 14:00 מעולה” לבין שאלה חדשה — לכן ההבחנה הזאת נשאלת מהמודל, ומה
 * שנשאר דטרמיניסטי הוא רק מי כתב אחרון ומתי.
 */
process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import { continuesStaffThread } from './customerIntent.js';
import { staffHandlingThread, recentConversation, STAFF_THREAD_HOURS } from './whatsappBot.js';

const PHONE = '972501234567';
const ago = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

/** A model that answers the yes/no question with whatever it is handed. */
const answering = (word) => async () => ({ content: { role: 'model', parts: [{ text: word }] }, error: '' });

function withMessages(rows, run) {
  const backup = { messages: db.get('messages') || [], logs: db.get('whatsapp_logs') || [] };
  try {
    db.set('messages', rows);
    db.set('whatsapp_logs', []);
    return run();
  } finally {
    db.set('messages', backup.messages);
    db.set('whatsapp_logs', backup.logs);
  }
}

const templateLine = (message, hours, template) => ({
  id: `t${hours}`, phone: PHONE, channel: 'whatsapp', direction: 'outbound',
  is_ai: false, source: 'crm', template_name: template, message, created_at: ago(hours),
});
const staffLine = (message, hours) => ({
  id: `s${hours}`, phone: PHONE, channel: 'whatsapp', direction: 'outbound',
  is_ai: false, source: 'crm', message, created_at: ago(hours),
});
const botLine = (message, hours) => ({
  id: `b${hours}`, phone: PHONE, channel: 'whatsapp', direction: 'outbound',
  is_ai: true, source: 'ai', message, created_at: ago(hours),
});
const customerLine = (message, hours) => ({
  id: `c${hours}`, phone: PHONE, channel: 'whatsapp', direction: 'inbound',
  is_ai: false, source: 'customer', message, created_at: ago(hours),
});

test('a person who wrote here last is still holding the thread a day later', () => {
  withMessages([
    customerLine('אני רוצה לשריין יום הולדת', 26),
    staffLine('כן, אפשר לשריין. איזו שעה?', 25),
    customerLine('אחרי בית ספר', 24),
  ], () => {
    const handler = staffHandlingThread(PHONE);
    assert.ok(handler, 'ציפינו שהשיחה תיחשב בטיפול של אדם');
    assert.match(handler.text, /אפשר לשריין/);
  });
});

test('a conversation that moved on since is ours to answer again', () => {
  // A season-opening announcement went out from the CRM to everybody, so it
  // reads exactly like a staff reply. Four days later, after a whole exchange
  // with the bot in between, a father wrote "בר שולם" — and the hold that was
  // meant for a live human thread swallowed it. Nothing answered him.
  withMessages([
    staffLine('שמחים לעדכן שההרשמה לעונה נפתחה!', 96),
    customerLine('מה לגבי קישור להרשמה לבר?', 25),
    botLine('🤖🧗🏾 בר משובץ לקבוצת נבחרת תיכון, והמקום שמור עבורו ל-3 ימים.', 25),
  ], () => {
    assert.equal(staffHandlingThread(PHONE), null);
  });
});

test('an announcement sent to everybody is not somebody handling the thread', () => {
  // It goes out under the CRM's name, so only the approved template it carries
  // tells it apart from a staff reply — and a person typing never sends one.
  withMessages([templateLine('שמחים לעדכן שההרשמה נפתחה!', 3, 'openregister')], () => {
    assert.equal(staffHandlingThread(PHONE), null);
  });
});

test('the hold ends when the week runs out, or when somebody brings the bot back', () => {
  withMessages([staffLine('היי מור', STAFF_THREAD_HOURS + 1)], () => {
    assert.equal(staffHandlingThread(PHONE), null);
  });

  withMessages([staffLine('היי מור', 3)], () => {
    // "החזר את הבוט" is an explicit handover, and it outranks the message log.
    assert.equal(staffHandlingThread(PHONE, { resumedAt: ago(1) }), null);
    assert.ok(staffHandlingThread(PHONE, { resumedAt: ago(5) }));
  });

  // Nobody but the bot has written: there is no human thread to stay out of.
  withMessages([botLine('🤖🧗🏾 היי, איך קוראים לך?', 2)], () => {
    assert.equal(staffHandlingThread(PHONE), null);
  });
});

test('the model is handed the conversation, labelled by who wrote each line', () => {
  withMessages([
    customerLine('היי, אפשר לשריין יום הולדת?', 5),
    staffLine('כן. איזו שעה?', 4),
    botLine('🤖🧗🏾 מעביר לצוות', 3),
  ], () => {
    assert.deepEqual(recentConversation(PHONE).map((row) => row.who), ['לקוח', 'צוות', 'בוט']);
    assert.match(recentConversation(PHONE)[1].text, /איזו שעה/);
  });
});

test('continuing the person\'s subject keeps the bot out; a new one lets it answer', async () => {
  const transcript = [
    { who: 'לקוח', text: 'אפשר לשריין יום הולדת ל-30.10?' },
    { who: 'צוות', text: 'כן, אפשר. איזו שעה?' },
  ];
  const call = { apiKey: 'test-key', transcript };

  assert.equal(await continuesStaffThread({
    ...call, message: 'כן, 14:00 מעולה', callModel: answering('כן'),
  }), true);

  assert.equal(await continuesStaffThread({
    ...call, message: 'ואגב, מאיזה גיל אפשר להירשם לחוג?', callModel: answering('לא'),
  }), false);
});

test('when the model cannot be reached the person keeps the thread', async () => {
  // The safe side here is the opposite of everywhere else: a human is already
  // in this conversation, so our silence leaves nobody without an answer.
  const failing = async () => ({ content: null, error: 'quota' });
  assert.equal(await continuesStaffThread({
    transcript: [{ who: 'צוות', text: 'כן, אפשר לשריין' }],
    message: 'כן, 14:00',
    callModel: failing,
    apiKey: 'test-key',
  }), true);

  assert.equal(await continuesStaffThread({ message: 'כן', callModel: null }), true);
});
