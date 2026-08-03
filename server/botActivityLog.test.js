import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordBotAction,
  listBotActions,
  botActionSummary,
  actionTypeMeta,
  newBotActionId,
  BOT_ACTION_TYPES,
  BOT_ACTIONS_COLLECTION,
} from './botActivityLog.js';

/** A store that behaves like db for this collection only. */
function memoryDb(rows = []) {
  const data = [...rows];
  return {
    get: () => data,
    insert: (_table, row) => { data.push(row); return row; },
  };
}

test('a bot action is written with its kind resolved from the type', () => {
  const db = memoryDb();
  const row = recordBotAction(db, null, {
    type: 'placement',
    summary: 'רוני שובץ',
    studentName: 'רוני',
  });
  assert.equal(row.kind, 'action');
  assert.equal(row.type, 'placement');
  assert.equal(row.actor, 'bot');

  const message = recordBotAction(db, null, { type: 'reply', summary: 'היי' });
  assert.equal(message.kind, 'message');
});

test('an unknown type is filed as "other" rather than swallowed', () => {
  const db = memoryDb();
  const row = recordBotAction(db, null, { type: 'something_new', summary: 'x' });
  assert.equal(row.type, 'other');
  assert.equal(actionTypeMeta('nope').type, 'other');
});

test('the journal never breaks the action it is recording', () => {
  // A journal that can fail a placement is worse than no journal.
  const broken = { get: () => { throw new Error('boom'); }, insert: () => { throw new Error('boom'); } };
  assert.equal(recordBotAction(broken, null, { type: 'placement', summary: 'x' }), null);
});

test('reading the journal filters by kind, type and customer, newest first', () => {
  const db = memoryDb([
    { id: 'a', kind: 'action', type: 'placement', parent_id: 'p1', created_at: '2026-08-01T10:00:00Z' },
    { id: 'b', kind: 'message', type: 'reply', parent_id: 'p1', created_at: '2026-08-02T10:00:00Z' },
    { id: 'c', kind: 'action', type: 'waitlist', parent_id: 'p2', created_at: '2026-08-03T10:00:00Z' },
  ]);
  assert.deepEqual(listBotActions(db, {}).map((r) => r.id), ['c', 'b', 'a']);
  assert.deepEqual(listBotActions(db, { kind: 'action' }).map((r) => r.id), ['c', 'a']);
  assert.deepEqual(listBotActions(db, { type: 'reply' }).map((r) => r.id), ['b']);
  assert.deepEqual(listBotActions(db, { parentId: 'p1' }).map((r) => r.id), ['b', 'a']);
  assert.deepEqual(listBotActions(db, { since: '2026-08-02T00:00:00Z' }).map((r) => r.id), ['c', 'b']);
});

test('the summary separates what the bot changed from what it said', () => {
  const db = memoryDb([
    { id: 'a', kind: 'action', type: 'placement', created_at: '2026-08-03T10:00:00Z' },
    { id: 'b', kind: 'action', type: 'placement', created_at: '2026-08-03T11:00:00Z' },
    { id: 'c', kind: 'message', type: 'reply', created_at: '2026-08-03T12:00:00Z' },
  ]);
  const summary = botActionSummary(db, {});
  assert.equal(summary.total, 3);
  assert.equal(summary.actions, 2);
  assert.equal(summary.messages, 1);
  assert.equal(summary.byType.placement, 2);
});

test('every declared type has a label and a kind the screen can render', () => {
  for (const meta of BOT_ACTION_TYPES) {
    assert.ok(meta.label, meta.type);
    assert.ok(['action', 'message'].includes(meta.kind), meta.type);
    assert.ok(meta.icon, meta.type);
  }
  assert.equal(BOT_ACTIONS_COLLECTION, 'bot_actions');
  assert.equal(new Set(Array.from({ length: 200 }, () => newBotActionId())).size, 200);
});
