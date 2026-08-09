import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimBotReply,
  finishBotReplyClaim,
  replyKeyForBurst,
} from './botReplyClaims.js';

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
