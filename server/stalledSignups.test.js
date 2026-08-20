import test from 'node:test';
import assert from 'node:assert/strict';
import { findStalledSignups } from './automations.js';

const TODAY = '2026-08-10';
const daysAgo = (n) => new Date(Date.parse(`${TODAY}T09:00:00`) - n * 86400000).toISOString();

/** Only `get` is used by the finder. */
function fakeStore(tables = {}) {
  return { get: (name) => tables[name] || [] };
}

test('a hold older than the window is reported, a fresh one is not', () => {
  const store = fakeStore({
    students: [
      { id: 's1', name: 'נועם', status: 'awaiting_parent_confirmation' },
      { id: 's2', name: 'רותם', status: 'awaiting_parent_confirmation' },
      { id: 's3', name: 'רשום כבר', status: 'registered' },
    ],
    lead_status_history: [
      { entity_id: 's1', to_status: 'awaiting_parent_confirmation', changed_at: daysAgo(9) },
      { entity_id: 's2', to_status: 'awaiting_parent_confirmation', changed_at: daysAgo(1) },
    ],
  });

  const stalled = findStalledSignups({ days: 5, today: TODAY, store });
  assert.deepEqual(stalled.map((r) => r.student.name), ['נועם']);
  assert.ok(stalled[0].daysWaiting >= 9);
});

test('the newest entry into the status is the one that counts', () => {
  const store = fakeStore({
    students: [{ id: 's1', name: 'נועם', status: 'awaiting_parent_confirmation' }],
    lead_status_history: [
      { entity_id: 's1', to_status: 'awaiting_parent_confirmation', changed_at: daysAgo(40) },
      // Placed again two days ago — that is the wait the team should see.
      { entity_id: 's1', to_status: 'awaiting_parent_confirmation', changed_at: daysAgo(2) },
    ],
  });
  assert.deepEqual(findStalledSignups({ days: 5, today: TODAY, store }), []);
});

test('a hold with no history row still ages, from the record itself', () => {
  const store = fakeStore({
    students: [
      { id: 's1', name: 'ותיק', status: 'awaiting_parent_confirmation', updated_at: daysAgo(30) },
    ],
    lead_status_history: [],
  });
  const stalled = findStalledSignups({ days: 5, today: TODAY, store });
  assert.equal(stalled.length, 1);
});

test('the longest wait comes first', () => {
  const store = fakeStore({
    students: [
      { id: 's1', name: 'שבוע', status: 'awaiting_parent_confirmation' },
      { id: 's2', name: 'חודש', status: 'awaiting_parent_confirmation' },
    ],
    lead_status_history: [
      { entity_id: 's1', to_status: 'awaiting_parent_confirmation', changed_at: daysAgo(7) },
      { entity_id: 's2', to_status: 'awaiting_parent_confirmation', changed_at: daysAgo(30) },
    ],
  });
  assert.deepEqual(
    findStalledSignups({ days: 5, today: TODAY, store }).map((r) => r.student.name),
    ['חודש', 'שבוע']
  );
});
