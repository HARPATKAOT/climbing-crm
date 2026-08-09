import test from 'node:test';
import assert from 'node:assert/strict';
import { runOneTimeBotDataMigrations } from './oneTimeBotDataMigrations.js';

function fakeDb() {
  const store = {
    parents: [{ id: 'pn_2a2aa52d5a6e816c9b12fb757958cee8' }],
    students: [
      { id: 'sn_8d22659dcf6b45f08ca2f5101a8682c5', parentId: 'hadar' },
      { id: 'sn_0f9441f2e38f4dd5bb466f06d91a088d', parentId: 'hadar' },
    ],
    student_guardians: [],
  };
  return {
    store,
    get: (name) => store[name] || [],
    getOne: (name, id) => (store[name] || []).find((row) => row.id === id),
    insert: (name, row) => {
      if ((store[name] || []).some((item) => item.id === row.id)) return null;
      (store[name] ||= []).push(row);
      return row;
    },
  };
}

test('approved family repair links both children once without duplicates', async () => {
  const db = fakeDb();
  const persisted = [];
  const first = await runOneTimeBotDataMigrations(db, async (name, row) => persisted.push([name, row.id]));
  const second = await runOneTimeBotDataMigrations(db, async () => assert.fail('must not persist twice'));
  assert.equal(first.length, 2);
  assert.equal(second.length, 0);
  assert.equal(db.store.student_guardians.length, 2);
  assert.equal(persisted.length, 2);
});
