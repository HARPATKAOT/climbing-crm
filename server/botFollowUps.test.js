import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDueDate,
  dueFollowUps,
  findOpenFollowUp,
  followUpMessage,
  newFollowUpId,
} from './botFollowUps.js';

const TODAY = '2026-08-03';
const store = (rows) => ({ get: () => rows });

test('"tomorrow" is counted from today, and cannot land in the past', () => {
  assert.equal(resolveDueDate({ days: 1, today: TODAY }), '2026-08-04');
  assert.equal(resolveDueDate({ days: 7, today: TODAY }), '2026-08-10');
  assert.equal(resolveDueDate({ days: 0, today: TODAY }), TODAY);
  // A month out is a task for the team, not a follow-up — clamped to a fortnight.
  assert.equal(resolveDueDate({ days: 90, today: TODAY }), '2026-08-17');
  // The model is far better at "in one day" than at working out today's date.
  assert.equal(resolveDueDate({ dueDate: '2026-01-01', today: TODAY }), null);
  assert.equal(resolveDueDate({ today: TODAY }), null);
});

test('only open follow-ups that have come due are picked up', () => {
  const rows = [
    { id: 'a', status: 'open', due_date: '2026-08-01' },
    { id: 'b', status: 'open', due_date: TODAY },
    { id: 'c', status: 'open', due_date: '2026-08-09' },
    { id: 'd', status: 'sent', due_date: '2026-08-01' },
    { id: 'e', status: 'cancelled', due_date: '2026-08-01' },
  ];
  assert.deepEqual(
    dueFollowUps(store(rows), { today: TODAY }).map((r) => r.id),
    ['a', 'b']
  );
});

test('one open follow-up per customer per reason', () => {
  const rows = [
    { id: 'a', parent_id: 'p1', reason: 'customer_asked', status: 'open' },
    { id: 'b', parent_id: 'p1', reason: 'pending_signup', status: 'open' },
    { id: 'c', parent_id: 'p1', reason: 'customer_asked', status: 'sent' },
  ];
  assert.equal(findOpenFollowUp(store(rows), { parentId: 'p1', reason: 'customer_asked' })?.id, 'a');
  assert.equal(findOpenFollowUp(store(rows), { parentId: 'p1', reason: 'pending_signup' })?.id, 'b');
  assert.equal(findOpenFollowUp(store(rows), { parentId: 'p2', reason: 'customer_asked' }), null);
});

test('the message says what was promised, not "just checking in"', () => {
  const asked = followUpMessage(
    { reason: 'customer_asked', note: 'ההרשמה של לילי לחוג' },
    { firstName: 'דנה' }
  );
  assert.match(asked, /היי דנה/);
  assert.match(asked, /ההרשמה של לילי לחוג/);

  const signup = followUpMessage(
    { reason: 'pending_signup', subject: 'ראם' },
    { firstName: 'דלק' }
  );
  assert.match(signup, /ראם/);
  assert.match(signup, /מתנ״ס/);

  // No name on the card yet — still a sentence, never "היי undefined".
  assert.match(followUpMessage({ reason: 'general' }, {}), /^היי,/);
});

test('two follow-ups born in the same tick keep separate ids', () => {
  // The generic id is a table prefix plus a millisecond: a placement and a
  // "check with me tomorrow" in one turn collided, and only one was ever sent.
  const ids = new Set(Array.from({ length: 200 }, () => newFollowUpId()));
  assert.equal(ids.size, 200);
});
