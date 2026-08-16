import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateToTwoBroadcastLists } from './broadcastListMigration.js';

function testDb(seed = {}) {
  const store = {
    broadcast_list_defs: [
      { key: 'general', label: 'כללי', sortOrder: 0 },
      { key: 'classes', label: 'חוגים', sortOrder: 1 },
      { key: 'trips', label: 'טיולים', sortOrder: 2 },
      { key: 'events', label: 'אירועים', sortOrder: 3 },
    ],
    broadcast_lists: [],
    ...seed,
  };
  return {
    store,
    get: (table) => store[table] || [],
    insert: (table, row) => {
      store[table] ||= [];
      store[table].push(row);
      return row;
    },
    update: (table, id, patch) => {
      const index = (store[table] || []).findIndex((row) => row.id === id);
      if (index === -1) return null;
      store[table][index] = { ...store[table][index], ...patch };
      return store[table][index];
    },
    updateBroadcastListDef: (key, patch) => {
      const index = store.broadcast_list_defs.findIndex((row) => row.key === key);
      if (index === -1) return null;
      store.broadcast_list_defs[index] = { ...store.broadcast_list_defs[index], ...patch };
      return store.broadcast_list_defs[index];
    },
    deleteBroadcastListDef: (key) => {
      store.broadcast_list_defs = store.broadcast_list_defs.filter((row) => row.key !== key);
      store.broadcast_lists = store.broadcast_lists.filter((row) => row.listName !== key);
      return { ok: true };
    },
  };
}

const listOf = (db, parentId) => Object.fromEntries(
  db.store.broadcast_lists
    .filter((row) => row.parentId === parentId)
    .map((row) => [row.listName, row.subscribed])
);

test('four legacy lists become the five canonical lists', async () => {
  const db = testDb();
  const result = await migrateToTwoBroadcastLists({ database: db });
  assert.deepEqual(
    db.store.broadcast_list_defs.map((row) => row.key),
    ['operational', 'clubs', 'field_trips', 'camps', 'marketing']
  );
  assert.equal(db.store.broadcast_list_defs[0].label, 'תפעולי');
  assert.equal(db.store.broadcast_list_defs[4].label, 'מבצעים ואירועים');
  // כל רשימה נושאת אייקון משלה.
  assert.ok(db.store.broadcast_list_defs.every((row) => row.icon));
  assert.equal(result.retired, 4);
});

// A yes anywhere in the old marketing-shaped lists is still a yes. A no
// everywhere must not become a yes, because that is consent nobody gave.
test('an answer given to any marketing list is carried across', async () => {
  const db = testDb({
    broadcast_lists: [
      { id: 'b1', parentId: 'p1', listName: 'classes', subscribed: true },
      { id: 'b2', parentId: 'p1', listName: 'trips', subscribed: true },
      { id: 'b3', parentId: 'p1', listName: 'general', subscribed: false },
      { id: 'b4', parentId: 'p2', listName: 'classes', subscribed: true },
      { id: 'b5', parentId: 'p2', listName: 'trips', subscribed: false },
      { id: 'b6', parentId: 'p2', listName: 'events', subscribed: false },
    ],
  });
  await migrateToTwoBroadcastLists({ database: db });
  assert.deepEqual(listOf(db, 'p1'), { operational: true, marketing: true });
  assert.deepEqual(listOf(db, 'p2'), { operational: true, marketing: false });
});

test('running twice changes nothing the second time', async () => {
  const db = testDb({
    broadcast_lists: [{ id: 'b1', parentId: 'p1', listName: 'trips', subscribed: true }],
  });
  const first = await migrateToTwoBroadcastLists({ database: db });
  const snapshot = JSON.stringify(db.store);
  const second = await migrateToTwoBroadcastLists({ database: db });
  assert.equal(first.defs, 5);
  assert.deepEqual(second, { defs: 0, parents: 0 });
  assert.equal(JSON.stringify(db.store), snapshot);
});
