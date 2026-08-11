process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { unansweredRecoveryCandidates } from './whatsapp.js';

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
