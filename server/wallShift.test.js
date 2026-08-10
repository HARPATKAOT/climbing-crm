import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WALL_ROLE,
  openWallShifts,
  wallShiftOpener,
  wallShiftStage,
  isLastOnShift,
  canClockOut,
  qualifiedClosersOnShift,
  canJoinShift,
  buildWallPayrollRow,
} from './wallShift.js';

const openerShift = { id: 'sh1', employee_id: 'e1', status: 'open', activity_type: 'counter_shift', wall_role: WALL_ROLE.OPENER, clock_in: '2026-08-10T06:00:00.000Z' };
const staffShift = { id: 'sh2', employee_id: 'e2', status: 'open', activity_type: 'counter_shift', wall_role: WALL_ROLE.STAFF, clock_in: '2026-08-10T08:00:00.000Z' };

test('only open counter shifts count as wall shifts', () => {
  const rows = [
    openerShift,
    { ...staffShift, status: 'closed' },
    { id: 'sh3', employee_id: 'e3', status: 'open', activity_type: 'rappel' },
  ];
  assert.deepEqual(openWallShifts(rows).map((s) => s.id), ['sh1']);
});

test('a shift opened before wall_role existed is still recognised as the opener', () => {
  const legacy = { id: 'sh0', employee_id: 'e9', status: 'open', activity_type: 'counter_shift', clock_in: '2026-08-10T05:30:00.000Z' };
  assert.equal(wallShiftOpener([staffShift, legacy])?.id, 'sh0');
});

test('staff who joined an already-open shift are never mistaken for the opener', () => {
  assert.equal(wallShiftOpener([staffShift]), null);
  assert.equal(wallShiftOpener([staffShift, openerShift])?.id, 'sh1');
});

test('the wall is open only after the shift started, the till opened and the checks were signed', () => {
  assert.deepEqual(wallShiftStage({ opener: null, cashOpen: false, pendingSafety: [] }), { stage: 'closed', step: 1 });
  assert.deepEqual(wallShiftStage({ opener: openerShift, cashOpen: false, pendingSafety: [] }), { stage: 'opening', step: 2 });
  assert.deepEqual(wallShiftStage({ opener: openerShift, cashOpen: true, pendingSafety: [{ id: 'sct-ropes-autobelay' }] }), { stage: 'opening', step: 3 });
  assert.deepEqual(wallShiftStage({ opener: openerShift, cashOpen: true, pendingSafety: [] }), { stage: 'open', step: 0 });
});

test('once the day has opened, closing the till does not send the terminal back to the wizard', () => {
  // ספירת הקופה היא שלב בסגירה. אם המצב היה חוזר ל„פתיחה” באמצע, מי שסוגר
  // היה נשאר בלי כפתור סגירה.
  const opened = { ...openerShift, wall_opened_at: '2026-08-10T07:00:00.000Z' };
  assert.deepEqual(wallShiftStage({ opener: opened, cashOpen: false, pendingSafety: [] }), { stage: 'open', step: 0 });
  assert.deepEqual(
    wallShiftStage({ opener: opened, cashOpen: false, pendingSafety: [{ id: 'sct-ropes-autobelay' }] }),
    { stage: 'open', step: 0 }
  );
});

test('the last employee on shift cannot clock out — they close', () => {
  assert.equal(isLastOnShift([openerShift], 'e1'), true);
  assert.equal(isLastOnShift([openerShift, staffShift], 'e1'), false);

  assert.deepEqual(canClockOut([openerShift, staffShift], 'e2').ok, true);
  const blocked = canClockOut([openerShift], 'e1');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'MUST_CLOSE_SHIFT');
  assert.equal(canClockOut([openerShift], 'e7').code, 'NOT_ON_SHIFT');
});

test('two shifts of the same employee do not make them look like two people', () => {
  const second = { ...staffShift, id: 'sh2b', employee_id: 'e1' };
  assert.equal(isLastOnShift([openerShift, second], 'e1'), true);
  assert.equal(canClockOut([openerShift, second], 'e1').code, 'MUST_CLOSE_SHIFT');
});

test('only employees marked as wall staff may join a shift from the terminal', () => {
  assert.equal(canJoinShift({ id: 'e2', is_active: true, is_wall_staff: true }).ok, true);
  assert.equal(canJoinShift({ id: 'e5', is_active: true, is_wall_staff: false }).ok, false);
  assert.equal(canJoinShift(null).ok, false);
});

test('the closers still on shift are those explicitly allowed to open the wall', () => {
  const employees = [
    { id: 'e1', is_active: true, is_wall_staff: true, can_open_wall: true },
    { id: 'e2', is_active: true, is_wall_staff: true, can_open_wall: false },
  ];
  assert.deepEqual(qualifiedClosersOnShift([openerShift, staffShift], employees).map((e) => e.id), ['e1']);
  assert.deepEqual(qualifiedClosersOnShift([staffShift], employees), []);
});

test('the payroll row pays the shift window minus hours already paid by an overlapping assignment', () => {
  const shift = {
    id: 'sh1',
    employee_id: 'e1',
    clock_in: '2026-08-10T06:00:00.000Z',
    clock_out: '2026-08-10T10:00:00.000Z',
  };
  const row = buildWallPayrollRow({
    shift,
    cin: { date: '2026-08-10', hm: '09:00', minutes: 540 },
    cout: { date: '2026-08-10', hm: '13:00', minutes: 780 },
    dayAssignments: [
      { date: '2026-08-10', start_time: '10:00', end_time: '11:00', pay_mode: 'hourly', source: 'manual' },
    ],
    roleLabel: 'הפעלת קיר',
    closerNote: 'נסגר ע"י דנה',
  });
  assert.equal(row.hours, 3);
  assert.equal(row.source, 'wall_shift');
  assert.equal(row.shift_id, 'sh1');
  assert.equal(row.date, '2026-08-10');
  assert.equal(row.start_time, '09:00');
  assert.equal(row.end_time, '13:00');
  assert.equal(row.approved, false);
  assert.match(row.notes, /דנה/);
});

test('a shift with no clock-out produces no payroll row instead of a zero-hour one', () => {
  assert.equal(buildWallPayrollRow({ shift: { id: 'sh1' }, cin: null, cout: null }), null);
});
