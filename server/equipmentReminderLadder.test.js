import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LADDER_DAYS,
  firstSessionForGroups,
  ladderExhausted,
  ladderPlan,
  nextLadderDelay,
} from './equipmentReminderLadder.js';

const NOW = new Date('2026-08-16T09:00:00Z');

test('three reminders with widening gaps, and then no fourth', () => {
  // Each unanswered reminder says the parent is not in a position to deal with
  // it now — not that they did not hear. So the gaps grow, and after three
  // the ladder ends rather than becoming a weekly drip.
  assert.deepEqual([...LADDER_DAYS], [3, 10, 24]);
  assert.equal(nextLadderDelay(0), 3);
  assert.equal(nextLadderDelay(1), 10);
  assert.equal(nextLadderDelay(2), 24);
  assert.equal(nextLadderDelay(3), null);

  assert.equal(ladderExhausted(2), false);
  assert.equal(ladderExhausted(3), true);
  assert.equal(ladderExhausted(4), true);
});

test('the rungs land on the right days', () => {
  assert.equal(ladderPlan({ attempt: 0, now: NOW }).due_date, '2026-08-19');
  assert.equal(ladderPlan({ attempt: 1, now: NOW }).due_date, '2026-08-26');
  assert.equal(ladderPlan({ attempt: 2, now: NOW }).due_date, '2026-09-09');
  assert.equal(ladderPlan({ attempt: 3, now: NOW }), null);
  // Outside a conversation, so always by template.
  assert.equal(ladderPlan({ attempt: 0, now: NOW }).needs_template, true);
});

test('nothing goes out before the week the trainee actually starts', () => {
  // The season opens on 1.9; a Sunday group's first session is the 6th, so the
  // earliest useful moment is the 30th of August — not three days from now.
  const plan = ladderPlan({ attempt: 0, now: NOW, firstSessionDate: '2026-09-06' });
  assert.equal(plan.due_date, '2026-08-30');

  // Once that week has arrived the ladder's own spacing takes over again.
  const later = ladderPlan({
    attempt: 0,
    now: new Date('2026-09-02T09:00:00Z'),
    firstSessionDate: '2026-09-06',
  });
  assert.equal(later.due_date, '2026-09-05');
});

test('the first session is the group day, not the season opening', () => {
  const sunday = { id: 'g1', trainingDays: [0] };
  const wednesday = { id: 'g2', trainingDays: [3] };
  // 1.9.2026 is a Tuesday.
  assert.equal(firstSessionForGroups([sunday], { seasonStart: '2026-09-01' }), '2026-09-06');
  assert.equal(firstSessionForGroups([wednesday], { seasonStart: '2026-09-01' }), '2026-09-02');
  // Twice a week: whichever comes first.
  assert.equal(
    firstSessionForGroups([], { seasonStart: '2026-09-01', weekdays: [0, 3] }),
    '2026-09-02'
  );
  // No group and no season: nothing to anchor to, and the ladder just spaces
  // itself normally.
  assert.equal(firstSessionForGroups([], { seasonStart: '2026-09-01' }), '');
  assert.equal(firstSessionForGroups([sunday], { seasonStart: '' }), '');
});
