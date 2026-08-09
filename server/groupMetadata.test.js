import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichGroupWithBotMeta } from './groupMetadata.js';

test('canonical training days preserve both Monday and Thursday', () => {
  const store = {
    get: (table) => table === 'group_bot_meta'
      ? [{ id: 'g', trainingDays: [1, 4], returningPriorityUntil: '2026-09-01' }]
      : [],
  };
  const group = enrichGroupWithBotMeta(store, { id: 'g', day: 4, name: 'מתקדמים' });
  assert.deepEqual(group.trainingDays, [1, 4]);
  assert.equal(group.returningPriorityUntil, '2026-09-01');
});
