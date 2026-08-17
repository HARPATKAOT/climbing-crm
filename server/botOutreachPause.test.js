import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOutreachPaused,
  openEndedPause,
  outreachPausedUntil,
  pauseRowId,
  resolvePauseUntil,
  setOutreachPause,
  clearOutreachPause,
  OUTREACH_PAUSE_COLLECTION,
} from './botOutreachPause.js';

const NOW = new Date('2026-08-16T09:00:00Z');

/** Enough of the store for these helpers: one collection, by id. */
function makeDb(rows = []) {
  const data = new Map(rows.map((row) => [String(row.id), { ...row }]));
  return {
    get: () => [...data.values()],
    getOne: (_collection, id) => data.get(String(id)) || null,
    insert: (_collection, row) => {
      data.set(String(row.id), { ...row });
      return data.get(String(row.id));
    },
    update: (_collection, id, patch) => {
      const existing = data.get(String(id));
      if (!existing) return null;
      data.set(String(id), { ...existing, ...patch });
      return data.get(String(id));
    },
  };
}

test('a month named by the customer resumes a week before it starts', () => {
  // "נירשם רק באוקטובר" has to come back while September is still running:
  // registering *in* October means the conversation happens before it.
  const october = resolvePauseUntil({ targetMonth: 'אוקטובר', now: NOW });
  assert.equal(october.date, '2026-09-24');

  // A month already behind us is next year's — and that is far enough out
  // that the season ceiling takes over: we come back before, not after.
  const january = resolvePauseUntil({ targetMonth: 'ינואר', now: NOW });
  assert.equal(january.date, '2026-12-14');

  // ISO works too, and so does the month we are standing in.
  assert.equal(resolvePauseUntil({ targetMonth: '2026-10', now: NOW }).date, '2026-09-24');
});

test('days and an explicit date are capped, and the past is refused', () => {
  assert.equal(resolvePauseUntil({ days: 14, now: NOW }).date, '2026-08-30');
  assert.equal(resolvePauseUntil({ untilDate: '2026-09-01', now: NOW }).date, '2026-09-01');
  // Beyond a season it is not a pause any more.
  assert.equal(resolvePauseUntil({ days: 900, now: NOW }).date, '2026-12-14');
  // Nothing usable: the bot has to ask when to come back rather than guess.
  assert.equal(resolvePauseUntil({ now: NOW }), null);
  assert.equal(resolvePauseUntil({ days: 0, now: NOW }), null);
  assert.equal(resolvePauseUntil({ untilDate: '2020-01-01', now: NOW }), null);
});

test('the pause holds until its date and then lets outreach through', async () => {
  const db = makeDb();
  const plan = resolvePauseUntil({ days: 14, now: NOW });
  const saved = await setOutreachPause(db, null, {
    parentId: 'p1',
    until: plan.until,
    reason: 'customer_unavailable',
    note: 'בחו״ל עד סוף אוגוסט',
    now: NOW,
  });
  assert.equal(saved.id, pauseRowId('p1'));
  assert.equal(saved.reason, 'customer_unavailable');
  assert.ok(isOutreachPaused(db, 'p1', NOW));
  // Someone else's card is untouched.
  assert.equal(isOutreachPaused(db, 'p2', NOW), false);
  // The day it expires, the follow-up may go out again.
  assert.equal(isOutreachPaused(db, 'p1', new Date('2026-09-01T09:00:00Z')), false);
  assert.equal(outreachPausedUntil(db, 'p1', new Date('2026-09-01T09:00:00Z')), '');
});

test('a second request moves the date instead of adding a second pause', async () => {
  const db = makeDb();
  const first = resolvePauseUntil({ days: 3, now: NOW });
  await setOutreachPause(db, null, { parentId: 'p1', until: first.until, note: 'בחו״ל', now: NOW });
  const second = resolvePauseUntil({ targetMonth: 'אוקטובר', now: NOW });
  await setOutreachPause(db, null, { parentId: 'p1', until: second.until, note: 'נירשם באוקטובר', now: NOW });

  assert.equal(db.get(OUTREACH_PAUSE_COLLECTION).length, 1);
  assert.equal(outreachPausedUntil(db, 'p1', NOW).slice(0, 10), '2026-09-24');
});

test('an unknown reason is stored as general rather than as itself', async () => {
  const db = makeDb();
  const plan = resolvePauseUntil({ days: 2, now: NOW });
  const saved = await setOutreachPause(db, null, {
    parentId: 'p1',
    until: plan.until,
    reason: 'whatever',
    note: 'משהו',
    now: NOW,
  });
  assert.equal(saved.reason, 'general');
});

test('no date given is silence, not a two-week guess', async () => {
  // "אני בחו״ל" with no return date used to buy a fortnight of quiet, after
  // which the reminders came back on a customer who had never said they would
  // be ready by then. The owner's call: ask, and stay quiet until they answer.
  const open = openEndedPause({ now: NOW });
  assert.equal(open.date, '2026-12-14');
  assert.notEqual(open.date, '2026-08-30');

  const db = makeDb();
  await setOutreachPause(db, null, {
    parentId: 'p1',
    until: open.until,
    reason: 'awaiting_customer_date',
    note: 'בחו״ל, לא אמרה עד מתי',
    now: NOW,
  });
  assert.ok(isOutreachPaused(db, 'p1', new Date('2026-10-01T09:00:00Z')));
  // A date the customer later gives replaces it rather than adding a second row.
  const named = resolvePauseUntil({ untilDate: '2026-09-05', now: NOW });
  await setOutreachPause(db, null, { parentId: 'p1', until: named.until, note: 'חוזרת ב-5.9', now: NOW });
  assert.equal(outreachPausedUntil(db, 'p1', NOW).slice(0, 10), '2026-09-05');
});

test('clearing releases the pause immediately', async () => {
  const db = makeDb();
  const plan = resolvePauseUntil({ days: 30, now: NOW });
  await setOutreachPause(db, null, { parentId: 'p1', until: plan.until, note: 'בחו״ל', now: NOW });
  await clearOutreachPause(db, null, 'p1', { now: NOW });
  assert.equal(isOutreachPaused(db, 'p1', new Date(NOW.getTime() + 1000)), false);
});
