import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVITY_ATTENDANCE_COLLECTION,
  activityAttendanceId,
  attendanceDaysFor,
  buildActivityAttendance,
  normalizeActivityAttStatus,
  planAttendanceMark,
  registrationCountsForAttendance,
  summarizeDays,
} from './activityAttendance.js';

const CAMP = {
  id: 'act-camp',
  name: 'מחנה קיץ 5 ימים',
  date: '2026-07-26',
  end_date: '2026-07-30',
};

const BIRTHDAY = { id: 'act-bd', name: 'יום הולדת', date: '2026-08-02' };

function reg(id, extra = {}) {
  return {
    id,
    activity_id: CAMP.id,
    participant_name: `משתתף ${id}`,
    participant_type: 'child',
    status: 'confirmed',
    ...extra,
  };
}

test('normalizeActivityAttStatus keeps the three activity statuses only', () => {
  assert.equal(normalizeActivityAttStatus('attended'), 'attended');
  assert.equal(normalizeActivityAttStatus('absent'), 'absent');
  assert.equal(normalizeActivityAttStatus('present'), 'attended');
  assert.equal(normalizeActivityAttStatus('הגיע'), 'attended');
  assert.equal(normalizeActivityAttStatus('לא הגיע'), 'absent');
  // A weekly-class status has no meaning for a one-off activity.
  assert.equal(normalizeActivityAttStatus('makeup'), 'pending');
  assert.equal(normalizeActivityAttStatus(undefined), 'pending');
});

test('a multi-day activity gets one row per day per participant', () => {
  const view = buildActivityAttendance({
    activity: CAMP,
    registrations: [reg('r1'), reg('r2')],
    saved: [],
  });
  assert.deepEqual(view.dates, [
    '2026-07-26', '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
  ]);
  assert.equal(view.multi_day, true);
  assert.equal(view.participants.length, 2);
  assert.equal(view.participants[0].days.length, 5);
  assert.ok(view.participants[0].days.every((day) => day.status === 'pending'));
});

test('a single-day activity gets exactly one column', () => {
  const view = buildActivityAttendance({ activity: BIRTHDAY, registrations: [reg('r1')] });
  assert.deepEqual(view.dates, ['2026-08-02']);
  assert.equal(view.multi_day, false);
});

test('a participant who joins later shows up without any backfill', () => {
  const saved = [{
    id: activityAttendanceId('r1', '2026-07-26'),
    registration_id: 'r1',
    date: '2026-07-26',
    status: 'attended',
  }];
  const view = buildActivityAttendance({
    activity: CAMP,
    registrations: [reg('r1'), reg('r-late')],
    saved,
  });
  const late = view.participants.find((p) => p.registration_id === 'r-late');
  assert.equal(late.days.length, 5);
  assert.ok(late.days.every((day) => day.status === 'pending'));
  // The already-marked participant keeps the mark.
  const early = view.participants.find((p) => p.registration_id === 'r1');
  assert.equal(early.days[0].status, 'attended');
});

test('cancelled registrations drop off the list', () => {
  assert.equal(registrationCountsForAttendance({ status: 'confirmed' }), true);
  assert.equal(registrationCountsForAttendance({ status: 'pending_payment' }), true);
  assert.equal(registrationCountsForAttendance({ status: 'cancelled' }), false);
  const view = buildActivityAttendance({
    activity: BIRTHDAY,
    registrations: [reg('r1'), reg('r2', { status: 'cancelled' })],
  });
  assert.equal(view.participants.length, 1);
});

test('each day is summed on its own', () => {
  const saved = [
    { registration_id: 'r1', date: '2026-07-26', status: 'attended' },
    { registration_id: 'r2', date: '2026-07-26', status: 'absent' },
    { registration_id: 'r1', date: '2026-07-27', status: 'attended' },
  ].map((row) => ({ ...row, id: activityAttendanceId(row.registration_id, row.date) }));

  const view = buildActivityAttendance({
    activity: CAMP,
    registrations: [reg('r1'), reg('r2')],
    saved,
  });
  assert.deepEqual(view.totals[0], {
    date: '2026-07-26', attended: 1, absent: 1, pending: 0, total: 2,
  });
  assert.deepEqual(view.totals[1], {
    date: '2026-07-27', attended: 1, absent: 0, pending: 1, total: 2,
  });
});

test('marking writes a stable row and re-marking updates it', () => {
  const first = planAttendanceMark({
    activity: CAMP,
    registration: reg('r1', { student_id: 's1', parent_id: 'p1' }),
    date: '2026-07-28',
    status: 'attended',
    markedBy: 'staff@kir',
    now: '2026-07-28T09:00:00.000Z',
  });
  assert.equal(first.action, 'insert');
  assert.equal(first.id, 'aatt-r1-2026-07-28');
  assert.equal(first.row.status, 'attended');
  assert.equal(first.row.student_id, 's1');
  assert.equal(first.row.activity_id, CAMP.id);

  const second = planAttendanceMark({
    activity: CAMP,
    registration: reg('r1'),
    date: '2026-07-28',
    status: 'absent',
    existing: first.row,
    now: '2026-07-28T10:00:00.000Z',
  });
  assert.equal(second.action, 'update');
  assert.equal(second.id, first.id);
  assert.equal(second.row.status, 'absent');
  // The original creation time survives an edit.
  assert.equal(second.row.created_at, '2026-07-28T09:00:00.000Z');
});

test('clearing a mark deletes the row instead of storing "pending"', () => {
  const existing = { id: 'aatt-r1-2026-07-28', status: 'attended' };
  assert.deepEqual(
    planAttendanceMark({ activity: CAMP, registration: reg('r1'), date: '2026-07-28', status: 'pending', existing }),
    { action: 'delete', id: 'aatt-r1-2026-07-28' }
  );
  assert.equal(
    planAttendanceMark({ activity: CAMP, registration: reg('r1'), date: '2026-07-28', status: 'pending' }).action,
    'none'
  );
});

test('a date outside the activity is refused', () => {
  const plan = planAttendanceMark({
    activity: CAMP,
    registration: reg('r1'),
    date: '2026-08-15',
    status: 'attended',
  });
  assert.equal(plan.action, 'invalid');
  assert.match(plan.error, /תאריך/);
});

test('marks on days the activity no longer covers are ignored, not shown', () => {
  const saved = [{
    id: activityAttendanceId('r1', '2026-07-30'),
    registration_id: 'r1',
    date: '2026-07-30',
    status: 'attended',
  }];
  // The camp was shortened to three days after the mark was made.
  const shortened = { ...CAMP, end_date: '2026-07-28' };
  const view = buildActivityAttendance({
    activity: shortened,
    registrations: [reg('r1')],
    saved,
  });
  assert.equal(view.dates.length, 3);
  assert.ok(view.participants[0].days.every((day) => day.date <= '2026-07-28'));
});

test('the customer file gets the same days for one registration', () => {
  const saved = [{
    id: activityAttendanceId('r9', '2026-07-27'),
    registration_id: 'r9',
    date: '2026-07-27',
    status: 'absent',
  }];
  const days = attendanceDaysFor({
    activity: CAMP,
    registration: reg('r9'),
    savedById: saved,
  });
  assert.equal(days.length, 5);
  assert.equal(days[1].status, 'absent');
  assert.deepEqual(summarizeDays(days), { total: 5, attended: 0, absent: 1, pending: 4 });
});

test('the durable collection name stays stable', () => {
  assert.equal(ACTIVITY_ATTENDANCE_COLLECTION, 'activity_attendance');
});
