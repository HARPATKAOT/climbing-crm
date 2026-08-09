import test from 'node:test';
import assert from 'node:assert/strict';
import { replyKeyForBurst } from './botReplyClaims.js';

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
