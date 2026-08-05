import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDueDate,
  dueFollowUps,
  findOpenFollowUp,
  followUpMessage,
  claimFollowUpSend,
  finishFollowUpSend,
  releaseFollowUpSend,
  newFollowUpId,
  inWindowSendAt,
  planFollowUp,
} from './botFollowUps.js';

const TODAY = '2026-08-03';
const store = (rows) => ({ get: () => rows });

test('"tomorrow" is counted from today, and cannot land in the past', () => {
  assert.equal(resolveDueDate({ days: 1, today: TODAY }), '2026-08-04');
  assert.equal(resolveDueDate({ days: 7, today: TODAY }), '2026-08-10');
  assert.equal(resolveDueDate({ days: 0, today: TODAY }), TODAY);
  // "Let's talk in September" is a real request, so the ceiling is a season.
  assert.equal(resolveDueDate({ days: 30, today: TODAY }), '2026-09-02');
  assert.equal(resolveDueDate({ days: 400, today: TODAY }), '2026-11-01');
  // The model is far better at "in one day" than at working out today's date.
  assert.equal(resolveDueDate({ dueDate: '2026-01-01', today: TODAY }), null);
  assert.equal(resolveDueDate({ today: TODAY }), null);
});

test('a next-day follow-up is aimed inside the free-text window, at a civil hour', () => {
  // Meta allows free text for 24 hours after the customer writes, so a
  // follow-up "tomorrow morning" used to land after the window shut — on
  // exactly the people most worth chasing. 23 hours later is still inside it.
  const afternoon = inWindowSendAt({
    lastInboundAt: '2026-08-03T11:00:00Z',        // 14:00 Israel
    now: new Date('2026-08-03T11:05:00Z'),
  });
  assert.equal(afternoon, '2026-08-04T10:00:00.000Z'); // 13:00 Israel, next day

  // 23 hours after a 4am message is 3am. Nobody sends a nudge at 3am: the
  // answer is the last civilised moment still inside the window.
  const smallHours = inWindowSendAt({
    lastInboundAt: '2026-08-03T01:00:00Z',        // 04:00 Israel
    now: new Date('2026-08-03T01:05:00Z'),
  });
  assert.equal(new Date(smallHours).toISOString(), '2026-08-03T18:00:00.000Z'); // 21:00 Israel

  // Window already shut — nothing to aim at, the caller falls back.
  assert.equal(
    inWindowSendAt({
      lastInboundAt: '2026-08-01T11:00:00Z',
      now: new Date('2026-08-03T11:00:00Z'),
    }),
    null
  );
  assert.equal(inWindowSendAt({ lastInboundAt: '' }), null);
});

test('a long follow-up admits it needs a template', () => {
  const soon = planFollowUp({
    days: 1,
    lastInboundAt: '2026-08-03T11:00:00Z',
    now: new Date('2026-08-03T11:05:00Z'),
  });
  assert.equal(soon.needs_template, false);
  assert.equal(soon.due_at, '2026-08-04T10:00:00.000Z');

  const september = planFollowUp({
    days: 30,
    lastInboundAt: '2026-08-03T11:00:00Z',
    now: new Date('2026-08-03T11:05:00Z'),
  });
  assert.equal(september.needs_template, true);
  assert.equal(september.due_date, '2026-09-02');

  // Tomorrow, but the window is already shut: template, not silence.
  const stale = planFollowUp({
    days: 1,
    lastInboundAt: '2026-07-01T11:00:00Z',
    now: new Date('2026-08-03T11:05:00Z'),
  });
  assert.equal(stale.needs_template, true);

  assert.equal(planFollowUp({ lastInboundAt: '2026-08-03T11:00:00Z' }), null);
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
    dueFollowUps(store(rows), { now: new Date(`${TODAY}T12:00:00Z`) }).map((r) => r.id),
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

function claimStore() {
  const rows = [];
  return {
    rows,
    get: (table) => (table === 'automation_sends' ? rows : []),
    appendOnly: async (_table, record) => {
      if (rows.some((row) => row.id === record.id)) return { ok: false, error: 'duplicate key' };
      const saved = { ...record, created_at: record.created_at || record.claimed_at };
      rows.push(saved);
      return { ok: true, record: saved };
    },
    update: (_table, id, updates) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...updates };
      return rows[index];
    },
    deleteDurable: async (_table, id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return { ok: false, notFound: true };
      rows.splice(index, 1);
      return { ok: true };
    },
  };
}

test('only one process can claim the same follow-up before sending', async () => {
  const db = claimStore();
  const row = { id: 'same-follow-up' };
  const [first, second] = await Promise.all([
    claimFollowUpSend(db, row, { date: TODAY, phone: '972500000000' }),
    claimFollowUpSend(db, row, { date: TODAY, phone: '972500000000' }),
  ]);

  assert.equal([first, second].filter((result) => result.claimed).length, 1);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].status, 'claimed');
});

test('a completed claim blocks repeats and a failed claim can be retried', async () => {
  const db = claimStore();
  const row = { id: 'follow-up-1' };
  const first = await claimFollowUpSend(db, row, { date: TODAY });
  assert.equal(first.claimed, true);

  const persisted = [];
  const finished = await finishFollowUpSend(db, first.id, {
    persist: async (_table, record) => {
      persisted.push(record);
      return { ok: true };
    },
  });
  assert.equal(finished.ok, true);
  assert.equal(db.rows[0].status, 'sent');
  assert.equal(persisted.length, 1);
  assert.equal((await claimFollowUpSend(db, row, { date: TODAY })).claimed, false);

  const retryRow = { id: 'follow-up-2' };
  const retryClaim = await claimFollowUpSend(db, retryRow, { date: TODAY });
  assert.equal(retryClaim.claimed, true);
  assert.equal((await releaseFollowUpSend(db, retryClaim.id)).ok, true);
  assert.equal((await claimFollowUpSend(db, retryRow, { date: TODAY })).claimed, true);
});
