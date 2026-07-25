import test from 'node:test';
import assert from 'node:assert/strict';
import { isAwaitingHandling, latestInboundAt, threadIsBehindCard } from './conversations.js';

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

test('a customer in the queue with an empty conversation triggers a refill', () => {
  const parent = { last_inbound_whatsapp: '2026-07-25T06:00:00.000Z' };
  assert.equal(threadIsBehindCard(parent, []), true);
});

test('a conversation that already holds the newest inbound is left alone', () => {
  const parent = { last_inbound_whatsapp: '2026-07-25T06:00:00.000Z' };
  const thread = [
    { direction: 'inbound', channel: 'whatsapp', created_at: '2026-07-25T06:00:00.000Z' },
  ];
  assert.equal(threadIsBehindCard(parent, thread), false);
});

test('an outbound-only conversation still counts as behind the card', () => {
  const parent = { last_inbound_whatsapp: '2026-07-25T06:00:00.000Z' };
  const thread = [
    { direction: 'outbound', channel: 'whatsapp', created_at: '2026-07-25T07:00:00.000Z' },
  ];
  assert.equal(threadIsBehindCard(parent, thread), true);
});

test('a customer who never wrote needs no refill', () => {
  assert.equal(threadIsBehindCard({}, []), false);
});

