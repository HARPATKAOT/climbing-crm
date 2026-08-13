import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimBotReply,
  conversationReplyLockKey,
  finishBotReplyClaim,
  releaseBotReplyClaim,
  replyKeyForBurst,
} from './botReplyClaims.js';

test('all overlapping turns for one phone share one conversation lock', () => {
  assert.equal(
    conversationReplyLockKey('972500000000'),
    conversationReplyLockKey('972500000000')
  );
  assert.notEqual(
    conversationReplyLockKey('972500000000'),
    conversationReplyLockKey('972500000001')
  );
  assert.match(conversationReplyLockKey('972500000000'), /^br-lock-[a-f0-9]{32}$/);
});

test('different bursts cannot run model turns concurrently for one phone', async () => {
  const rows = [];
  const db = {
    get: () => rows,
    insert: (_table, record) => {
      if (rows.some((row) => row.id === record.id)) return null;
      rows.push({ ...record });
      return rows.at(-1);
    },
    delete: (_table, id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return true;
    },
  };
  const lock = conversationReplyLockKey('972500000000');
  assert.equal((await claimBotReply(db, lock, { kind: 'conversation_lock' })).claimed, true);
  assert.equal((await claimBotReply(db, lock, { kind: 'conversation_lock' })).claimed, false);
  await releaseBotReplyClaim(db, lock);
  assert.equal((await claimBotReply(db, lock, { kind: 'conversation_lock' })).claimed, true);
});

test('one inbound burst has one stable reply key regardless of webhook order', () => {
  const first = replyKeyForBurst('972500000000', [
    { messageId: 'wamid.1', text: 'שלום' },
    { messageId: 'wamid.2', text: 'רוצה להירשם' },
  ]);
  const retry = replyKeyForBurst('972500000000', [
    { messageId: 'wamid.2', text: 'רוצה להירשם' },
    { messageId: 'wamid.1', text: 'שלום' },
  ]);
  assert.equal(first, retry);
  assert.match(first, /^br-[a-f0-9]{32}$/);
});

test('a completed silent turn remains claimed and cannot run again', async () => {
  const rows = [];
  const db = {
    get: () => rows,
    insert: (_table, record) => {
      if (rows.some((row) => row.id === record.id)) return null;
      rows.push({ ...record });
      return rows.at(-1);
    },
    update: (_table, id, patch) => {
      const row = rows.find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
  const persist = async () => {};

  const first = await claimBotReply(db, 'br-silent', { phone: '972500000000' });
  assert.equal(first.claimed, true);
  await finishBotReplyClaim(db, persist, 'br-silent', { status: 'silent' });
  const retry = await claimBotReply(db, 'br-silent', { phone: '972500000000' });

  assert.equal(retry.claimed, false);
  assert.equal(rows[0].status, 'silent');
  assert.ok(rows[0].completed_at);
  assert.equal(rows[0].sent_at, undefined);
});

test('a claim abandoned mid-flight stops blocking the next attempt', async () => {
  const rows = [];
  const db = {
    get: () => rows,
    insert: (_t, record) => { if (rows.some((r) => r.id === record.id)) return null; rows.push({ ...record }); return rows.at(-1); },
    update: (_t, id, patch) => { const row = rows.find((r) => r.id === id); if (!row) return null; Object.assign(row, patch); return row; },
    delete: (_t, id) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true; },
  };
  const key = replyKeyForBurst('0599111000', [{ messageId: 'm-1' }]);

  const first = await claimBotReply(db, key, { phone: '0599111000' });
  assert.equal(first.claimed, true);

  // The worker died before the send: the row stays "sending" for ever, and
  // every later attempt at the same message refuses itself. One customer sat
  // unanswered behind exactly this.
  const second = await claimBotReply(db, key, { phone: '0599111000' });
  assert.equal(second.claimed, false);
  assert.equal(second.reason, 'already_claimed');

  const later = new Date(Date.now() + 6 * 60 * 1000);
  const retry = await claimBotReply(db, key, { phone: '0599111000', now: later });
  assert.equal(retry.claimed, true, 'a stale claim may be taken again');

  // A finished claim still blocks — that is what stops a double send.
  await finishBotReplyClaim(db, null, key, { status: 'sent' });
  const afterSent = await claimBotReply(db, key, { phone: '0599111000', now: later });
  assert.equal(afterSent.claimed, false);
});
