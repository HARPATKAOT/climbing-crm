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
