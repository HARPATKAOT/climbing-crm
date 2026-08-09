import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_STATE_COLLECTION,
  aiProbeDue,
  getAiServiceState,
  isAiServiceOpen,
  recordAiFailure,
  recordAiSuccess,
} from './aiServiceState.js';

function memoryDb() {
  const rows = new Map();
  return {
    get: (table) => [...(rows.get(table) || new Map()).values()],
    getOne: (table, id) => rows.get(table)?.get(id),
    insert: (table, row) => {
      if (!rows.has(table)) rows.set(table, new Map());
      rows.get(table).set(row.id, { ...row });
      return { ...row };
    },
    update: (table, id, patch) => {
      const current = rows.get(table)?.get(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      rows.get(table).set(id, next);
      return next;
    },
  };
}

test('quota opens immediately; transient failures open only on the third failure', async () => {
  const quotaDb = memoryDb();
  const quota = await recordAiFailure(quotaDb, null, '429 RESOURCE_EXHAUSTED');
  assert.equal(quota.opened, true);
  assert.equal(quota.state.status, 'quota_exhausted');
  assert.equal(isAiServiceOpen(quotaDb), true);

  const transientDb = memoryDb();
  await recordAiFailure(transientDb, null, 'temporary network error');
  await recordAiFailure(transientDb, null, 'temporary network error');
  assert.equal(isAiServiceOpen(transientDb), false);
  const third = await recordAiFailure(transientDb, null, 'temporary network error');
  assert.equal(third.opened, true);
  assert.equal(isAiServiceOpen(transientDb), true);
});

test('a successful probe recovers the circuit and does not erase the outage id', async () => {
  const store = memoryDb();
  await recordAiFailure(store, null, 'quota');
  const before = getAiServiceState(store);
  const success = await recordAiSuccess(store, null);
  assert.equal(success.recovered, true);
  assert.equal(success.state.status, 'healthy');
  assert.equal(success.state.outage_id, before.outage_id);
  assert.equal(aiProbeDue(store), false);
  assert.equal(store.get(AI_STATE_COLLECTION).length, 1);
});
