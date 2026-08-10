import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResponse,
  calendarSlotCandidates,
  eligibleEmployees,
  expandWeeklySlots,
  findSlotAssignment,
  isSlotAssigned,
  isWindowOpen,
  normalizeWindow,
  publicWindowView,
  signupBoard,
  slotId,
  slotTickCounts,
  respondentSummary,
} from './shiftSignup.js';

const TODAY = '2026-08-10';

function windowFixture(overrides = {}) {
  const { window: row, error } = normalizeWindow({
    title: 'משמרות פתיחה',
    role: 'עוזר מדריך',
    work_type: 'counter_shift',
    slots: [
      { date: '2026-08-11', start_time: '15:30', end_time: '18:00', capacity: 2 },
      { date: '2026-08-12', start_time: '15:30', end_time: '18:00', capacity: 1 },
    ],
    ...overrides,
  });
  assert.equal(error, undefined);
  return { ...row, id: 'w1' };
}

test('a window needs a name, a role and at least one shift', () => {
  assert.match(normalizeWindow({ role: 'עוזר מדריך', slots: [] }).error, /שם/);
  assert.match(normalizeWindow({ title: 'א', slots: [] }).error, /תפקיד/);
  assert.match(normalizeWindow({ title: 'א', role: 'עוזר מדריך', slots: [] }).error, /משמרת אחת/);
});

test('a shift with the end before the start is rejected', () => {
  const { error } = normalizeWindow({
    title: 'א',
    role: 'עוזר מדריך',
    slots: [{ date: '2026-08-11', start_time: '18:00', end_time: '15:30' }],
  });
  assert.match(error, /מוקדמת/);
});

test('shifts are sorted, de-duplicated and keyed by date and start time', () => {
  const { window: row } = normalizeWindow({
    title: 'א',
    role: 'עוזר מדריך',
    slots: [
      { date: '2026-08-12', start_time: '15:30', end_time: '18:00' },
      { date: '2026-08-11', start_time: '15:30', end_time: '18:00' },
      { date: '2026-08-11', start_time: '15:30', end_time: '20:00', capacity: 5 },
    ],
  });
  assert.deepEqual(row.slots.map((s) => s.id), ['2026-08-11@15:30', '2026-08-12@15:30']);
  // The duplicate lost, rather than overwriting — first definition of a shift wins.
  assert.equal(row.slots[0].end_time, '18:00');
});

test('editing a window keeps the ids of shifts that did not move', () => {
  const first = windowFixture();
  const { window: edited } = normalizeWindow(
    {
      slots: [
        // The first day was dropped; the second must keep its id so the ticks
        // pointing at it still land on the same shift.
        { date: '2026-08-12', start_time: '15:30', end_time: '18:00', capacity: 1 },
        { date: '2026-08-13', start_time: '15:30', end_time: '18:00', capacity: 1 },
      ],
    },
    { existing: first }
  );
  assert.equal(edited.slots[0].id, first.slots[1].id);
  assert.equal(edited.token, first.token);
});

test('a weekly pattern expands into the concrete dates in range', () => {
  // 2026-08-10 is a Monday, so Sunday=0 and Tuesday=2 in the following two weeks.
  const { slots, error } = expandWeeklySlots({
    from: '2026-08-10',
    to: '2026-08-23',
    weekdays: [0, 2],
    start_time: '15:30',
    end_time: '18:00',
    capacity: 2,
  });
  assert.equal(error, undefined);
  assert.deepEqual(slots.map((s) => s.date), ['2026-08-11', '2026-08-16', '2026-08-18', '2026-08-23']);
  assert.equal(slots[0].capacity, 2);
  assert.equal(slots[0].id, slotId('2026-08-11', '15:30'));
});

test('an impossible pattern says so instead of producing an empty window', () => {
  assert.match(expandWeeklySlots({ from: '2026-08-20', to: '2026-08-10', weekdays: [0] }).error, /מוקדם/);
  assert.match(expandWeeklySlots({ from: '2026-08-10', to: '2026-08-11', weekdays: [] }).error, /יום אחד/);
  assert.match(
    expandWeeklySlots({ from: '2026-08-10', to: '2026-08-11', weekdays: [5], start_time: '15:30', end_time: '18:00' }).error,
    /אין אף תאריך/
  );
});

test('a window closes on status, on its deadline and once its last shift has passed', () => {
  const row = windowFixture();
  assert.equal(isWindowOpen(row, TODAY), true);
  assert.equal(isWindowOpen({ ...row, status: 'closed' }, TODAY), false);
  assert.equal(isWindowOpen({ ...row, deadline: '2026-08-09' }, TODAY), false);
  assert.equal(isWindowOpen({ ...row, deadline: '2026-08-10' }, TODAY), true);
  assert.equal(isWindowOpen(row, '2026-08-13'), false);
});

test('the public form hides shifts that already happened', () => {
  const view = publicWindowView(windowFixture(), [], '2026-08-12');
  assert.deepEqual(view.slots.map((s) => s.date), ['2026-08-12']);
});

test('the public form shows how many already ticked each shift', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', slot_ids: [row.slots[0].id] },
    { window_id: 'w1', employee_id: 'e2', slot_ids: [row.slots[0].id, row.slots[1].id] },
    { window_id: 'other', employee_id: 'e3', slot_ids: [row.slots[0].id] },
  ];
  const counts = slotTickCounts(row, responses.filter((r) => r.window_id === 'w1'));
  assert.equal(counts.get(row.slots[0].id), 2);
  assert.equal(counts.get(row.slots[1].id), 1);
  assert.equal(publicWindowView(row, responses.filter((r) => r.window_id === 'w1'), TODAY).slots[0].taken, 2);
});

test('a full shift can still be ticked — the extra name is the reserve', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', slot_ids: [row.slots[1].id] },
  ];
  const { record, error } = applyResponse(
    row,
    responses,
    { employee_id: 'e2', slot_ids: [row.slots[1].id] },
    { today: TODAY }
  );
  assert.equal(error, undefined);
  assert.deepEqual(record.slot_ids, [row.slots[1].id]);
});

test('a second submission replaces the first instead of adding a row', () => {
  const row = windowFixture();
  const responses = [
    { id: 'r1', window_id: 'w1', employee_id: 'e1', slot_ids: [row.slots[0].id], note: 'ישן' },
  ];
  const { record, existing } = applyResponse(
    row,
    responses,
    { employee_id: 'e1', slot_ids: [row.slots[1].id], note: 'חדש' },
    { today: TODAY }
  );
  assert.equal(existing.id, 'r1');
  assert.equal(record.id, 'r1');
  assert.deepEqual(record.slot_ids, [row.slots[1].id]);
  assert.equal(record.note, 'חדש');
});

test('ticking nothing is stored as an answer, not as silence', () => {
  const row = windowFixture();
  const { record, cleared, error } = applyResponse(
    row,
    [],
    { employee_id: 'e1', slot_ids: [] },
    { today: TODAY }
  );
  assert.equal(error, undefined);
  assert.equal(cleared, true);
  assert.deepEqual(record.slot_ids, []);
});

test('shifts that are not in the window, or already past, are dropped from a submission', () => {
  const row = windowFixture();
  const { record } = applyResponse(
    row,
    [],
    { employee_id: 'e1', slot_ids: [row.slots[0].id, row.slots[1].id, 'made-up@10:00'] },
    { today: '2026-08-12' }
  );
  assert.deepEqual(record.slot_ids, [row.slots[1].id]);
});

test('a closed window refuses submissions', () => {
  const row = windowFixture({ status: 'closed' });
  const { error } = applyResponse({ ...row, id: 'w1' }, [], { employee_id: 'e1', slot_ids: [] }, { today: TODAY });
  assert.match(error, /נסגרה/);
});

// ─── משמרות מהיומן ──────────────────────────────────────────────────────────
const ROLES_BY_TYPE = {
  event: ['הדרכת חוג', 'עוזר מדריך'],
  opening_hours: ['הפעלת קיר'],
  route_building: ['בונה מסלולים'],
  personal_training: ['הדרכת חוג'],
  other: [],
};
const CLASS_ROLES = ['הדרכת חוג', 'עוזר מדריך'];

const CALENDAR = [
  { id: 'a1', name: 'יום הולדת לנועם', type: 'event', date: '2026-08-11', start_time: '17:00', end_time: '19:00' },
  { id: 'a2', name: 'פתיחת קיר', type: 'opening_hours', date: '2026-08-12', start_time: '16:00', end_time: '22:00' },
  { id: 'a3', name: 'סבב מסלולים', type: 'route_building', date: '2026-08-12', start_time: '09:00', end_time: '13:00' },
  { id: 'a4', name: 'חופשת קיץ', type: 'training_vacation', date: '2026-08-13', end_date: '2026-08-13' },
  { id: 'a5', name: 'אירוע מבוטל', type: 'event', date: '2026-08-11', start_time: '20:00', end_time: '22:00', status: 'cancelled' },
  { id: 'a6', name: 'אירוע בלי שעות', type: 'event', date: '2026-08-12', all_day: true },
];

test('calendar candidates only offer types the role is allowed to staff', () => {
  const { candidates } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'הפעלת קיר',
    from: '2026-08-10',
    to: '2026-08-14',
  });
  assert.deepEqual(candidates.map((c) => c.label), ['פתיחת קיר']);
  assert.equal(candidates[0].activity_id, 'a2');
  assert.equal(candidates[0].work_type, 'counter_shift');
  // The candidate already carries the id the stored slot will have, so a tick
  // in the picker survives into the form unchanged.
  const { window: row } = normalizeWindow({ title: 'א', role: 'הפעלת קיר', slots: candidates });
  assert.deepEqual(row.slots.map((s) => s.id), candidates.map((c) => c.id));
});

test('two classes at the same hour are two candidates, not one', () => {
  const { candidates } = calendarSlotCandidates({
    groups: [
      { id: 'g1', name: 'קבוצה א', day: 2, time: '16:00', duration: 50 },
      { id: 'g2', name: 'קבוצה ב', day: 2, time: '16:00', duration: 50 },
    ],
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'עוזר מדריך',
    from: '2026-08-11',
    to: '2026-08-11',
  });
  assert.equal(candidates.length, 2);
  assert.notEqual(candidates[0].id, candidates[1].id);
});

test('a route-building entry becomes a route-building shift, not a counter one', () => {
  const { candidates } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'בונה מסלולים',
    from: '2026-08-10',
    to: '2026-08-14',
  });
  assert.deepEqual(candidates.map((c) => c.work_type), ['route_building_shift']);
});

test('cancelled entries, vacations and entries without hours are not offered', () => {
  const { candidates, withoutHours } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'עוזר מדריך',
    from: '2026-08-10',
    to: '2026-08-14',
  });
  assert.deepEqual(candidates.map((c) => c.label), ['יום הולדת לנועם']);
  // The all-day entry is reported rather than silently dropped.
  assert.equal(withoutHours, 1);
});

test('a multi-day entry becomes one candidate per day', () => {
  const { candidates } = calendarSlotCandidates({
    activities: [
      { id: 'a7', name: 'קייטנה', type: 'event', date: '2026-08-11', end_date: '2026-08-13', start_time: '08:00', end_time: '13:00' },
    ],
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'עוזר מדריך',
    from: '2026-08-12',
    to: '2026-08-20',
  });
  // Only the days inside the asked-for range.
  assert.deepEqual(candidates.map((c) => c.date), ['2026-08-12', '2026-08-13']);
});

test('weekly classes expand into sessions, with the end time from their duration', () => {
  const { candidates } = calendarSlotCandidates({
    groups: [{ id: 'g1', name: "ילדים ג'-ד' — יום ג׳ 16:00", day: 2, time: '16:00', duration: 50 }],
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'עוזר מדריך',
    from: '2026-08-10',
    to: '2026-08-20',
  });
  assert.deepEqual(candidates.map((c) => c.date), ['2026-08-11', '2026-08-18']);
  assert.equal(candidates[0].end_time, '16:50');
  assert.equal(candidates[0].group_id, 'g1');
  assert.equal(candidates[0].work_type, 'class_shift');
});

test('a class is not offered on a training vacation', () => {
  const { candidates } = calendarSlotCandidates({
    activities: [{ id: 'v1', name: 'חופשה', type: 'training_vacation', date: '2026-08-11', end_date: '2026-08-11' }],
    groups: [{ id: 'g1', name: 'חוג', day: 2, time: '16:00', duration: 50 }],
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'עוזר מדריך',
    from: '2026-08-10',
    to: '2026-08-20',
  });
  assert.deepEqual(candidates.map((c) => c.date), ['2026-08-18']);
});

test('classes are not offered to a role that does not teach', () => {
  const { candidates } = calendarSlotCandidates({
    groups: [{ id: 'g1', name: 'חוג', day: 2, time: '16:00', duration: 50 }],
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'בונה מסלולים',
    from: '2026-08-10',
    to: '2026-08-20',
  });
  assert.equal(candidates.length, 0);
});

test('a candidate reports how many are already placed on it in that role', () => {
  const { candidates } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    role: 'עוזר מדריך',
    from: '2026-08-10',
    to: '2026-08-14',
    assignments: [
      { employee_id: 'e1', activity_id: 'a1', date: '2026-08-11', role: 'עוזר מדריך' },
      // Same day, different role — belongs to someone else's count.
      { employee_id: 'e2', activity_id: 'a1', date: '2026-08-11', role: 'הדרכת חוג' },
    ],
  });
  assert.equal(candidates[0].staffed, 1);
});

test('two classes at the same hour stay two separate shifts', () => {
  const { window: row, error } = normalizeWindow({
    title: 'חוגים',
    role: 'עוזר מדריך',
    slots: [
      { date: '2026-08-11', start_time: '16:00', end_time: '16:50', group_id: 'g1', label: 'קבוצה א' },
      { date: '2026-08-11', start_time: '16:00', end_time: '16:50', group_id: 'g2', label: 'קבוצה ב' },
    ],
  });
  assert.equal(error, undefined);
  assert.equal(row.slots.length, 2);
  assert.notEqual(row.slots[0].id, row.slots[1].id);
});

test('a placement is matched by what it staffs, not by the clock', () => {
  const slot = { date: '2026-08-11', start_time: '16:00', group_id: 'g1' };
  const assignments = [
    // The class was moved half an hour later after the placement was made.
    { id: 'w1', employee_id: 'e1', date: '2026-08-11', start_time: '16:30', group_id: 'g1' },
    { id: 'w2', employee_id: 'e1', date: '2026-08-11', start_time: '16:00', group_id: 'g2' },
  ];
  assert.equal(findSlotAssignment(assignments, 'e1', slot).id, 'w1');
});

test('only active staff marked for the role are offered the form', () => {
  const employees = [
    { id: 'e1', name: 'דנה', certifications: ['עוזר מדריך'] },
    { id: 'e2', name: 'יואב', certifications: ['הדרכת חוג'] },
    { id: 'e3', name: 'אורי', certifications: ['עוזר מדריך'], is_active: false },
    { id: 'e4', name: 'בר', certifications: ['עוזר מדריך', 'הדרכת חוג'] },
  ];
  assert.deepEqual(
    eligibleEmployees(employees, 'עוזר מדריך').map((e) => e.name),
    ['בר', 'דנה']
  );
});

test('a placement on the roster marks the tick as assigned', () => {
  const row = windowFixture();
  const slot = row.slots[0];
  const assignments = [
    { employee_id: 'e1', date: '2026-08-11', start_time: '15:30' },
    { employee_id: 'e2', date: '2026-08-11', start_time: '19:00' },
  ];
  assert.equal(isSlotAssigned(assignments, 'e1', slot), true);
  assert.equal(isSlotAssigned(assignments, 'e2', slot), false);
});

test('the board shows who offered, who is placed and how many are still missing', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', slot_ids: [row.slots[0].id], submitted_at: '2026-08-10T08:00:00.000Z' },
    { window_id: 'w1', employee_id: 'e2', slot_ids: [row.slots[0].id], submitted_at: '2026-08-10T09:00:00.000Z' },
  ];
  const employees = [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יואב' }];
  const assignments = [{ employee_id: 'e1', date: '2026-08-11', start_time: '15:30' }];
  const board = signupBoard(row, responses, employees, assignments);

  assert.deepEqual(board[0].signed.map((s) => s.name), ['דנה', 'יואב']);
  assert.equal(board[0].signed[0].assigned, true);
  assert.equal(board[0].signed[1].assigned, false);
  // Two people are needed and one is placed, so one is still missing.
  assert.equal(board[0].missing, 1);
  assert.equal(board[1].signed.length, 0);
  assert.equal(board[1].missing, 1);
});

test('the board falls back to the name kept on the answer when the employee is gone', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'gone', employee_name: 'עובד שהוסר', slot_ids: [row.slots[0].id] },
  ];
  assert.equal(signupBoard(row, responses, [], [])[0].signed[0].name, 'עובד שהוסר');
});

test('the respondent list counts what each person is still waiting to hear about', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', slot_ids: [row.slots[0].id, row.slots[1].id] },
  ];
  const summary = respondentSummary(row, responses, [{ id: 'e1', name: 'דנה' }], [
    { employee_id: 'e1', date: '2026-08-11', start_time: '15:30' },
  ]);
  assert.equal(summary[0].picked, 2);
  assert.equal(summary[0].assigned, 1);
});
