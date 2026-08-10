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
    groups: [
      { id: 'advanced', name: 'מתקדמים ה-\u05d5', skillLevel: 'מתקדמים', info: 'תיאור ייחודי' },
      { id: 'regular', name: 'מתחילים', skillLevel: 'מתחילים', info: 'לא לשנות' },
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
    update: (name, id, patch) => {
      const index = (store[name] || []).findIndex((row) => row.id === id);
      if (index < 0) return null;
      store[name][index] = { ...store[name][index], ...patch };
      return store[name][index];
    },
  };
}

test('approved data migrations link both children and enrich advanced groups once', async () => {
  const db = fakeDb();
  const persisted = [];
  const first = await runOneTimeBotDataMigrations(db, async (name, row) => persisted.push([name, row.id]));
  const second = await runOneTimeBotDataMigrations(db, async () => assert.fail('must not persist twice'));
  assert.equal(first.length, 3);
  assert.equal(second.length, 0);
  assert.equal(db.store.student_guardians.length, 2);
  assert.equal(persisted.length, 3);
  assert.match(db.store.groups[0].info, /אימון חוץ אחד בחודש/);
  assert.match(db.store.groups[0].info, /3 פעילויות שטח/);
  assert.equal(db.store.groups[1].info, 'לא לשנות');
});
