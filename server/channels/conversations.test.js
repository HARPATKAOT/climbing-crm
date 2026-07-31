import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAwaitingHandling,
  latestInboundAt,
  listConversations,
  threadIsBehindCard,
} from './conversations.js';

/** Reads straight from a plain object so the inbox tests never touch db.json. */
function fakeStore(tables = {}) {
  return { read: (table) => tables[table] || [] };
}

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

// ─── Inbox list ──────────────────────────────────────────────────────────────

test('the inbox shows the newest message per customer, most recent first', () => {
  const store = fakeStore({
    parents: [
      { id: 'p1', name: 'דנה', phone: '0501111111', communication_handled_at: '2026-07-29T12:00:00.000Z' },
      { id: 'p2', name: 'יוסי', phone: '0502222222', communication_handled_at: '2026-07-29T12:00:00.000Z' },
    ],
    messages: [
      { id: 'm1', parent_id: 'p1', phone: '0501111111', direction: 'inbound', message: 'שלום', created_at: '2026-07-29T09:00:00.000Z' },
      { id: 'm2', parent_id: 'p1', phone: '0501111111', direction: 'outbound', message: 'היי דנה', created_at: '2026-07-29T10:00:00.000Z' },
      { id: 'm3', parent_id: 'p2', phone: '0502222222', direction: 'inbound', message: 'יש מקום?', created_at: '2026-07-29T11:00:00.000Z' },
    ],
  });

  const { conversations, total } = listConversations({ store });
  assert.equal(total, 2);
  assert.deepEqual(conversations.map((c) => c.parentId), ['p2', 'p1']);
  assert.equal(conversations[1].preview, 'היי דנה');
  assert.equal(conversations[1].direction, 'outbound');
});

test('customers awaiting a reply are pinned above newer handled conversations', () => {
  const store = fakeStore({
    parents: [
      { id: 'p1', name: 'ממתין', phone: '0501111111', last_inbound_whatsapp: '2026-07-29T08:00:00.000Z' },
      { id: 'p2', name: 'טופל', phone: '0502222222', communication_handled_at: '2026-07-29T23:00:00.000Z' },
    ],
    messages: [
      { id: 'm1', parent_id: 'p1', phone: '0501111111', direction: 'inbound', message: 'מחכה', created_at: '2026-07-29T08:00:00.000Z' },
      { id: 'm2', parent_id: 'p2', phone: '0502222222', direction: 'inbound', message: 'חדש יותר', created_at: '2026-07-29T22:00:00.000Z' },
    ],
  });

  const { conversations, awaiting } = listConversations({ store });
  assert.equal(awaiting, 1);
  assert.equal(conversations[0].parentId, 'p1');
  assert.equal(conversations[0].unread, 1);
  assert.equal(conversations[1].unread, 0);
});

test('the whatsapp_logs mirror never doubles a message or its unread count', () => {
  const message = {
    id: 'm1',
    parent_id: 'p1',
    phone: '0501111111',
    direction: 'inbound',
    message: 'הודעה אחת',
    created_at: '2026-07-29T09:00:00.000Z',
  };
  const store = fakeStore({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111', last_inbound_whatsapp: message.created_at }],
    messages: [message],
    whatsapp_logs: [{ ...message }],
  });

  const { conversations, total } = listConversations({ store });
  assert.equal(total, 1);
  // Counted twice, this would read 2.
  assert.equal(conversations[0].unread, 1);
});

test('duplicate cards on one phone collapse onto the richest card', () => {
  const store = fakeStore({
    parents: [
      { id: 'bare', name: 'לקוח וואטסאפ', phone: '0501111111' },
      { id: 'real', name: 'דנה כהן', phone: '972501111111', email: 'dana@example.com' },
    ],
    messages: [
      { id: 'm1', parent_id: 'bare', phone: '972501111111', direction: 'inbound', message: 'היי', created_at: '2026-07-29T09:00:00.000Z' },
    ],
  });

  const { conversations, total } = listConversations({ store });
  assert.equal(total, 1);
  assert.equal(conversations[0].parentId, 'real');
  assert.equal(conversations[0].name, 'דנה כהן');
});

test('a message from a child phone is credited to the family and names the child', () => {
  const store = fakeStore({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם', phone: '0523333333' }],
    messages: [
      { id: 'm1', phone: '0523333333', direction: 'inbound', message: 'אני מאחר', created_at: '2026-07-29T09:00:00.000Z' },
    ],
  });

  const { conversations, total } = listConversations({ store });
  assert.equal(total, 1);
  assert.equal(conversations[0].parentId, 'p1');
  assert.equal(conversations[0].fromStudentName, 'נועם');
});

test('a card awaiting handling still appears when its thread cache is empty', () => {
  const store = fakeStore({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111', last_inbound_whatsapp: '2026-07-29T09:00:00.000Z' }],
  });

  const { conversations } = listConversations({ store });
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].awaiting, true);
  assert.equal(conversations[0].lastMessageAt, '2026-07-29T09:00:00.000Z');
});

test('the unread badge never contradicts the awaiting filter', () => {
  const store = fakeStore({
    // Handled long ago, and the card never recorded the inbound that followed —
    // the message store knows about it, last_inbound_whatsapp does not.
    parents: [{ id: 'p1', name: 'רינה', phone: '0501111111', communication_handled_at: '2026-07-29T01:00:00.000Z' }],
    messages: [
      { id: 'm1', parent_id: 'p1', phone: '0501111111', direction: 'inbound', message: 'רוצה לקבוע', created_at: '2026-07-29T09:00:00.000Z' },
    ],
  });

  const [row] = listConversations({ store }).conversations;
  assert.equal(row.awaiting, false);
  assert.equal(row.unread, 0);
});

test('an image with no caption previews as media rather than an empty row', () => {
  const store = fakeStore({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    messages: [
      { id: 'm1', parent_id: 'p1', phone: '0501111111', direction: 'inbound', message: '', media_type: 'image', media_url: 'https://x/y.jpg', created_at: '2026-07-29T09:00:00.000Z' },
    ],
  });

  assert.equal(listConversations({ store }).conversations[0].preview, '📷 תמונה');
});

test('a message from an unknown number is dropped instead of inventing a customer', () => {
  const store = fakeStore({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    messages: [
      { id: 'm1', phone: '0509999999', direction: 'inbound', message: 'מי זה', created_at: '2026-07-29T09:00:00.000Z' },
    ],
  });

  assert.equal(listConversations({ store }).total, 0);
});

