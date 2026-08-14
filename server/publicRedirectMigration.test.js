import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PUBLIC_REDIRECT_SECURITY_COLLECTION,
  PUBLIC_REDIRECT_SECURITY_ID,
  ensurePublicRedirectLegacyCutoff,
} from './publicRedirectMigration.js';

function memoryDb(seed = []) {
  const rows = [...seed];
  return {
    rows,
    getOne: (_collection, id) => rows.find((row) => row.id === id) || null,
    insert: (_collection, record) => {
      rows.push({ ...record });
      return rows.at(-1);
    },
    update: (_collection, id, record) => {
      const index = rows.findIndex((row) => row.id === id);
      rows[index] = { ...rows[index], ...record };
      return rows[index];
    },
  };
}

test('first secure boot persists a fixed legacy-link boundary', async () => {
  const db = memoryDb();
  const persisted = [];
  const result = await ensurePublicRedirectLegacyCutoff({
    db,
    now: 1_786_700_000_000,
    requireDurable: true,
    persist: async (collection, record) => {
      persisted.push({ collection, record });
      return { ok: true };
    },
  });
  assert.deepEqual(result, { cutoffMs: 1_786_699_999_999, created: true, durable: true });
  assert.equal(persisted[0].collection, PUBLIC_REDIRECT_SECURITY_COLLECTION);
  assert.equal(persisted[0].record.id, PUBLIC_REDIRECT_SECURITY_ID);
});

test('later boots reuse the original boundary and never widen it', async () => {
  const db = memoryDb([{
    id: PUBLIC_REDIRECT_SECURITY_ID,
    legacy_cutoff_ms: 1_786_699_999_999,
  }]);
  let writes = 0;
  const result = await ensurePublicRedirectLegacyCutoff({
    db,
    now: 1_800_000_000_000,
    requireDurable: true,
    persist: async () => { writes += 1; return { ok: true }; },
  });
  assert.deepEqual(result, { cutoffMs: 1_786_699_999_999, created: false });
  assert.equal(writes, 0);
});

test('production startup fails closed when the boundary cannot be persisted', async () => {
  await assert.rejects(
    ensurePublicRedirectLegacyCutoff({
      db: memoryDb(),
      now: 1_786_700_000_000,
      requireDurable: true,
      persist: async () => ({ ok: false, error: 'store unavailable' }),
    }),
    /Could not persist public redirect security boundary/
  );
});
