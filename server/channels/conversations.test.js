import test from 'node:test';
import assert from 'node:assert/strict';
import { isAwaitingHandling, latestInboundAt } from './conversations.js';

test('customer awaits handling when an inbound message is newer than handled time', () => {
  const parent = {
    last_inbound_whatsapp: '2026-07-25T06:00:00.000Z',
    communication_handled_at: '2026-07-25T05:00:00.000Z',
  };
  assert.equal(isAwaitingHandling(parent), true);
});

test('customer leaves queue only after the latest inbound message is handled', () => {
  const parent = {
    last_inbound_whatsapp: '2026-07-25T06:00:00.000Z',
    last_inbound_instagram: '2026-07-25T07:00:00.000Z',
    communication_handled_at: '2026-07-25T07:01:00.000Z',
  };
  assert.equal(latestInboundAt(parent), '2026-07-25T07:00:00.000Z');
  assert.equal(isAwaitingHandling(parent), false);
});

test('customer without inbound messages never enters the queue', () => {
  assert.equal(isAwaitingHandling({ communication_handled_at: null }), false);
});

