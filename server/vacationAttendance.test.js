import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityDateRange,
  ensureAttendanceRows,
  findTrainingVacation,
  isTrainingVacationDate,
  planVacationAttendanceReverts,
  planVacationAttendanceUpdates,
  VACATION_MARKER,
} from './attendanceUtils.js';

// 2026-07-27 is a Monday (יום ב׳ = weekday 1).
const MONDAY = '2026-07-27';

const groups = [{ id: 'g1', name: "מתחילים ב׳", day: 1, active: true }];
const students = [
  { id: 's1', groupId: 'g1' },
  { id: 's2', groupId: 'g1' },
];

const vacation = {
  id: 'a1',
  type: 'training_vacation',
  name: 'חופשת קיץ',
  date: MONDAY,
  end_date: '2026-07-29',
  status: 'open',
};

test('findTrainingVacation covers the whole inclusive range', () => {
  assert.equal(findTrainingVacation([vacation], '2026-07-26'), null);
  assert.equal(findTrainingVacation([vacation], MONDAY)?.id, 'a1');
  assert.equal(findTrainingVacation([vacation], '2026-07-28')?.id, 'a1');
  assert.equal(findTrainingVacation([vacation], '2026-07-29')?.id, 'a1');
  assert.equal(findTrainingVacation([vacation], '2026-07-30'), null);
});

test('single-day vacation and timestamped dates still match', () => {
  const single = { ...vacation, end_date: null };
  assert.ok(isTrainingVacationDate([single], MONDAY));
  assert.ok(!isTrainingVacationDate([single], '2026-07-28'));

  const stamped = { ...vacation, date: `${MONDAY}T00:00:00Z`, end_date: null };
  assert.ok(isTrainingVacationDate([stamped], MONDAY));
});

test('only training_vacation activities that are not cancelled count', () => {
  assert.ok(!isTrainingVacationDate([{ ...vacation, type: 'trip' }], MONDAY));
  assert.ok(!isTrainingVacationDate([{ ...vacation, status: 'cancelled' }], MONDAY));
});

test('activityDateRange walks inclusive days and caps runaway ranges', () => {
  assert.deepEqual(activityDateRange(vacation), ['2026-07-27', '2026-07-28', '2026-07-29']);
  assert.deepEqual(activityDateRange({ date: MONDAY }), [MONDAY]);
  assert.deepEqual(activityDateRange({}), []);
  // end before start collapses to a single day
  assert.deepEqual(activityDateRange({ date: MONDAY, end_date: '2026-07-01' }), [MONDAY]);
  assert.equal(activityDateRange({ date: MONDAY, end_date: '2030-01-01' }).length, 120);
});

test('rows created on a vacation day start as holiday with the automation marker', () => {
  const result = ensureAttendanceRows({
    groups,
    students,
    attendance: [],
    activities: [vacation],
    date: MONDAY,
  });
  assert.equal(result.created.length, 2);
  assert.ok(result.created.every((r) => r.status === 'holiday'));
  assert.ok(result.created.every((r) => r.marked_by === VACATION_MARKER));
  assert.equal(result.vacation.id, 'a1');
});

test('rows created on a normal day stay pending', () => {
  const result = ensureAttendanceRows({
    groups,
    students,
    attendance: [],
    activities: [],
    date: MONDAY,
  });
  assert.ok(result.created.every((r) => r.status === 'pending' && r.marked_by === null));
  assert.equal(result.vacation, null);
});

test('only pending rows are flipped — manual marks survive', () => {
  const attendance = [
    { id: 'r1', student_id: 's1', group_id: 'g1', date: MONDAY, status: 'pending' },
    { id: 'r2', student_id: 's2', group_id: 'g1', date: MONDAY, status: 'attended' },
    { id: 'r3', student_id: 's1', group_id: 'g1', date: '2026-07-20', status: 'pending' },
  ];
  const toMark = planVacationAttendanceUpdates({ activities: [vacation], attendance });
  assert.deepEqual(toMark.map((r) => r.id), ['r1']);
});

test('date filter limits the sync to the requested days', () => {
  const attendance = [
    { id: 'r1', student_id: 's1', group_id: 'g1', date: MONDAY, status: 'pending' },
    { id: 'r2', student_id: 's1', group_id: 'g1', date: '2026-07-28', status: 'pending' },
  ];
  const toMark = planVacationAttendanceUpdates({
    activities: [vacation],
    attendance,
    dates: ['2026-07-28'],
  });
  assert.deepEqual(toMark.map((r) => r.id), ['r2']);
});

test('auto-marked rows revert when the vacation is gone; manual holidays do not', () => {
  const attendance = [
    { id: 'r1', student_id: 's1', group_id: 'g1', date: MONDAY, status: 'holiday', marked_by: VACATION_MARKER },
    { id: 'r2', student_id: 's2', group_id: 'g1', date: MONDAY, status: 'holiday', marked_by: 'רועי' },
    { id: 'r3', student_id: 's1', group_id: 'g1', date: '2026-07-28', status: 'holiday', marked_by: VACATION_MARKER },
  ];
  // Vacation deleted entirely → only the auto-marked rows revert.
  const reverts = planVacationAttendanceReverts({ activities: [], attendance });
  assert.deepEqual(reverts.map((r) => r.id), ['r1', 'r3']);

  // Vacation shortened to the 28th → the 27th reverts, the 28th stays.
  const shortened = planVacationAttendanceReverts({
    activities: [{ ...vacation, date: '2026-07-28' }],
    attendance,
  });
  assert.deepEqual(shortened.map((r) => r.id), ['r1']);
});

test('a still-covered auto row is never marked and never reverted twice', () => {
  const attendance = [
    { id: 'r1', student_id: 's1', group_id: 'g1', date: MONDAY, status: 'holiday', marked_by: VACATION_MARKER },
  ];
  assert.equal(planVacationAttendanceUpdates({ activities: [vacation], attendance }).length, 0);
  assert.equal(planVacationAttendanceReverts({ activities: [vacation], attendance }).length, 0);
});
