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
  planAssignments,
  planWarnings,
  publicWindowView,
  signupBoard,
  slotId,
  seatTickCounts,
  slotCapacity,
  respondentSummary,
  assignmentMessageText,
} from './shiftSignup.js';

const TODAY = '2026-08-10';

const WALL = 'הפעלת קיר';
const ASSISTANT = 'עוזר מדריך';

function windowFixture(overrides = {}) {
  const { window: row, error } = normalizeWindow({
    title: 'משמרות פתיחה',
    work_type: 'counter_shift',
    slots: [
      // משמרת פתיחה אמיתית: מפעיל קיר אחד ועוזר אחד, לא „שניים”.
      {
        date: '2026-08-11',
        start_time: '15:30',
        end_time: '18:00',
        needs: [{ role: WALL, count: 1 }, { role: ASSISTANT, count: 1 }],
      },
      {
        date: '2026-08-12',
        start_time: '15:30',
        end_time: '18:00',
        needs: [{ role: WALL, count: 1 }],
      },
    ],
    ...overrides,
  });
  assert.equal(error, undefined);
  return { ...row, id: 'w1' };
}

test('a window needs a name and at least one shift — but no longer a role', () => {
  assert.match(normalizeWindow({ slots: [] }).error, /שם/);
  assert.match(normalizeWindow({ title: 'א', slots: [] }).error, /משמרת אחת/);
  // התפקיד ירד מהטופס: הוא יושב על המשמרת, ולכן טופס בלי תפקיד הוא תקין.
  const { window: row, error } = normalizeWindow({
    title: 'א',
    slots: [{ date: '2026-08-11', start_time: '15:30', end_time: '18:00' }],
  });
  assert.equal(error, undefined);
  assert.equal(row.role, undefined);
});

test('a shift with no roles named still asks for someone', () => {
  const { window: row } = normalizeWindow({
    title: 'א',
    slots: [{ date: '2026-08-11', start_time: '15:30', end_time: '18:00', capacity: 3 }],
  });
  // תפקיד ריק פירושו „מי שמתאים”, והספירה הישנה נשמרת כמספר האנשים.
  assert.deepEqual(row.slots[0].needs, [{ role: '', count: 3 }]);
  assert.equal(slotCapacity(row.slots[0]), 3);
});

test('the same role twice in one shift is one count, not two seats', () => {
  const { window: row } = normalizeWindow({
    title: 'א',
    slots: [{
      date: '2026-08-11',
      start_time: '15:30',
      end_time: '18:00',
      needs: [{ role: ASSISTANT, count: 1 }, { role: ASSISTANT, count: 2 }],
    }],
  });
  assert.deepEqual(row.slots[0].needs, [{ role: ASSISTANT, count: 3 }]);
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
    needs: [{ role: WALL, count: 1 }, { role: ASSISTANT, count: 1 }],
  });
  assert.equal(error, undefined);
  assert.deepEqual(slots.map((s) => s.date), ['2026-08-11', '2026-08-16', '2026-08-18', '2026-08-23']);
  // הדפוס נושא את אותם תפקידים לכל תאריך: „כל ראשון ושלישי, מפעיל ועוזר”.
  assert.deepEqual(slots[0].needs, [{ role: WALL, count: 1 }, { role: ASSISTANT, count: 1 }]);
  assert.equal(slotCapacity(slots[0]), 2);
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

test('the public form counts claims per seat, not per shift', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', picks: [{ slot_id: row.slots[0].id, role: WALL }] },
    { window_id: 'w1', employee_id: 'e2', picks: [{ slot_id: row.slots[0].id, role: ASSISTANT }] },
    { window_id: 'w1', employee_id: 'e3', picks: [{ slot_id: row.slots[0].id, role: ASSISTANT }] },
  ];
  const counts = seatTickCounts(row, responses);
  // שלושה ביקשו את אותה משמרת, אבל אחד למקום של המפעיל ושניים למקום העוזר.
  assert.equal(counts.get(`${row.slots[0].id}|${WALL}`), 1);
  assert.equal(counts.get(`${row.slots[0].id}|${ASSISTANT}`), 2);
  const view = publicWindowView(row, responses, TODAY);
  assert.deepEqual(view.slots[0].needs.map((n) => [n.role, n.taken]), [[WALL, 1], [ASSISTANT, 2]]);
});

test('a full seat can still be claimed — the extra name is the reserve', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', picks: [{ slot_id: row.slots[1].id, role: WALL }] },
  ];
  const { record, error } = applyResponse(
    row,
    responses,
    { employee_id: 'e2', picks: [{ slot_id: row.slots[1].id, role: WALL }] },
    { today: TODAY }
  );
  assert.equal(error, undefined);
  assert.deepEqual(record.picks, [{ slot_id: row.slots[1].id, role: WALL }]);
});

test('a second submission replaces the first instead of adding a row', () => {
  const row = windowFixture();
  const responses = [
    { id: 'r1', window_id: 'w1', employee_id: 'e1', picks: [{ slot_id: row.slots[0].id, role: WALL }], note: 'ישן' },
  ];
  const { record, existing } = applyResponse(
    row,
    responses,
    { employee_id: 'e1', picks: [{ slot_id: row.slots[1].id, role: WALL }], note: 'חדש' },
    { today: TODAY }
  );
  assert.equal(existing.id, 'r1');
  assert.equal(record.id, 'r1');
  assert.deepEqual(record.picks, [{ slot_id: row.slots[1].id, role: WALL }]);
  assert.equal(record.note, 'חדש');
});

test('claiming nothing is stored as an answer, not as silence', () => {
  const row = windowFixture();
  const { record, cleared, error } = applyResponse(
    row,
    [],
    { employee_id: 'e1', picks: [] },
    { today: TODAY }
  );
  assert.equal(error, undefined);
  assert.equal(cleared, true);
  assert.deepEqual(record.picks, []);
});

test('a claim on a shift not in the window, or already past, is dropped', () => {
  const row = windowFixture();
  const { record } = applyResponse(
    row,
    [],
    {
      employee_id: 'e1',
      picks: [
        { slot_id: row.slots[0].id, role: WALL },
        { slot_id: row.slots[1].id, role: WALL },
        { slot_id: 'made-up@10:00', role: WALL },
      ],
    },
    { today: '2026-08-12' }
  );
  assert.deepEqual(record.picks, [{ slot_id: row.slots[1].id, role: WALL }]);
});

test('a role the shift does not need is not a seat', () => {
  const row = windowFixture();
  const { record } = applyResponse(
    row,
    [],
    // המשמרת השנייה צריכה מפעיל קיר בלבד; „עוזר מדריך” אינו מושב שלה.
    { employee_id: 'e1', picks: [{ slot_id: row.slots[1].id, role: ASSISTANT }] },
    { today: TODAY }
  );
  assert.deepEqual(record.picks, []);
});

test('a role the employee is not marked for is refused, not just hidden', () => {
  const row = windowFixture();
  const { record } = applyResponse(
    row,
    [],
    {
      employee_id: 'e1',
      picks: [
        { slot_id: row.slots[0].id, role: WALL },
        { slot_id: row.slots[1].id, role: WALL },
      ],
    },
    { today: TODAY, employee: { id: 'e1', certifications: [ASSISTANT] } }
  );
  // הקישור עובר בוואטסאפ; בקשה שנשלחה בלי המסך חייבת להיחסם בשרת.
  assert.deepEqual(record.picks, []);
});

test('one person cannot hold two roles in the same hour', () => {
  const row = windowFixture();
  const { record } = applyResponse(
    row,
    [],
    {
      employee_id: 'e1',
      picks: [
        { slot_id: row.slots[0].id, role: WALL },
        { slot_id: row.slots[0].id, role: ASSISTANT },
      ],
    },
    { today: TODAY }
  );
  assert.deepEqual(record.picks, [{ slot_id: row.slots[0].id, role: WALL }]);
});

test('a closed window refuses submissions', () => {
  const row = windowFixture({ status: 'closed' });
  const { error } = applyResponse({ ...row, id: 'w1' }, [], { employee_id: 'e1', picks: [] }, { today: TODAY });
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

test('nothing is removed for a role any more — the whole range comes back', () => {
  const { candidates } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    from: '2026-08-10',
    to: '2026-08-14',
  });
  // זה מה שהיה שבור: „הפעלת קיר” החזיר משמרת אחת מתוך שלוש, ורשימה ריקה נראתה
  // כמו יומן ריק. עכשיו כולן חוזרות, וכל אחת אומרת מה היא צריכה.
  assert.deepEqual(candidates.map((c) => c.label), ['יום הולדת לנועם', 'סבב מסלולים', 'פתיחת קיר']);
  const opening = candidates.find((c) => c.activity_id === 'a2');
  assert.deepEqual(opening.needs, [{ role: 'הפעלת קיר', count: 1 }]);
  // המועמד כבר נושא את המזהה שתהיה לו המשמרת השמורה, כך שסימון שורד את היצירה.
  const { window: row } = normalizeWindow({ title: 'א', slots: candidates });
  assert.deepEqual(row.slots.map((s) => s.id), candidates.map((c) => c.id));
});

test('what the manager wrote on the event beats what its type implies', () => {
  const { candidates } = calendarSlotCandidates({
    activities: [{
      ...CALENDAR[1],
      staff_needs: [{ role: 'הפעלת קיר', count: 1 }, { role: 'עוזר מדריך', count: 2 }],
    }],
    rolesByType: ROLES_BY_TYPE,
    from: '2026-08-10',
    to: '2026-08-14',
  });
  assert.deepEqual(candidates[0].needs, [
    { role: 'הפעלת קיר', count: 1 },
    { role: 'עוזר מדריך', count: 2 },
  ]);
  assert.equal(slotCapacity(candidates[0]), 3);
});

test('an event with no needs and an unmapped type is offered to whoever fits', () => {
  const { candidates } = calendarSlotCandidates({
    activities: [{ id: 'x1', name: 'משהו', type: 'other', date: '2026-08-11', start_time: '10:00', end_time: '12:00' }],
    rolesByType: ROLES_BY_TYPE,
    from: '2026-08-10',
    to: '2026-08-14',
  });
  // תפקיד ריק ולא רשימה ריקה: עדיף להציע משמרת בלי לדעת מה היא צריכה מאשר
  // לא להציע אותה בכלל.
  assert.deepEqual(candidates[0].needs, [{ role: '', count: 1 }]);
});

// ─── סינון לפי סוג פעילות ────────────────────────────────────────────────────

const CLASS_GRID = [
  { id: 'g1', name: 'כיתות ג-ד', day: 2, time: '16:00', duration: 50 },
  { id: 'g2', name: 'בוגרים', day: 2, time: '20:00', duration: 80 },
];

test('an empty type list still offers everything', () => {
  const withNone = calendarSlotCandidates({
    activities: CALENDAR, groups: CLASS_GRID,
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
  });
  const withEmpty = calendarSlotCandidates({
    activities: CALENDAR, groups: CLASS_GRID,
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14', types: [],
  });
  assert.deepEqual(withEmpty.candidates, withNone.candidates);
  assert.ok(withNone.candidates.some((c) => c.source === 'group'));
});

test('picking one type drops every other source, classes included', () => {
  const { candidates } = calendarSlotCandidates({
    activities: CALENDAR, groups: CLASS_GRID,
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
    types: ['event'],
  });
  assert.deepEqual(candidates.map((c) => c.label), ['יום הולדת לנועם']);
});

test('classes come only when their own chip is on', () => {
  const off = calendarSlotCandidates({
    activities: CALENDAR, groups: CLASS_GRID,
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
    types: ['event', 'opening_hours'],
  });
  assert.equal(off.candidates.filter((c) => c.source === 'group').length, 0);

  const on = calendarSlotCandidates({
    activities: CALENDAR, groups: CLASS_GRID,
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
    types: ['class'],
  });
  assert.deepEqual(on.candidates.map((c) => c.label), ['כיתות ג-ד', 'בוגרים']);
});

test('asking for opening hours now returns the opening hours', () => {
  const { candidates, byType } = calendarSlotCandidates({
    activities: CALENDAR, groups: [],
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    from: '2026-08-10', to: '2026-08-14',
    types: ['opening_hours'],
  });
  // הרגרסיה של התלונה: קודם זה החזיר אפס.
  assert.deepEqual(candidates.map((c) => c.label), ['פתיחת קיר']);
  assert.equal(byType.find((s) => s.id === 'opening_hours').total, 1);
});

test('the counts describe the range, not the filtered result', () => {
  const { byType } = calendarSlotCandidates({
    activities: CALENDAR, groups: CLASS_GRID,
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
    types: ['event'],
  });
  // Classes were filtered out of the list, but the picker still says how many
  // turning them on would bring.
  assert.equal(byType.find((s) => s.id === 'class').total, 2);
  assert.equal(byType.find((s) => s.id === 'opening_hours').total, 1);
});

test('a filtered-out type does not inflate the without-hours line', () => {
  // a6 is an event with no hours. Ask for opening hours only and it must not be
  // reported — the manager is not being told about something they excluded.
  const { withoutHours, byType } = calendarSlotCandidates({
    activities: CALENDAR, groups: [],
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
    types: ['opening_hours'],
  });
  assert.equal(withoutHours, 0);
  assert.equal(byType.find((s) => s.id === 'event').without_hours, 1);
});

test('an archived entry is not offered, the way a cancelled one is not', () => {
  const { candidates } = calendarSlotCandidates({
    activities: [
      { id: 'c1', name: 'קייטנה שהסתיימה', type: 'event', date: '2026-08-11', end_date: '2026-08-13', start_time: '10:00', end_time: '12:00', status: 'archived' },
      { id: 'c2', name: 'קייטנה בארכיון', type: 'event', date: '2026-08-11', start_time: '10:00', end_time: '12:00', archived: true },
    ],
    rolesByType: ROLES_BY_TYPE, classRoles: CLASS_ROLES,
    role: 'עוזר מדריך', from: '2026-08-10', to: '2026-08-14',
  });
  assert.deepEqual(candidates, []);
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
    from: '2026-08-10',
    to: '2026-08-14',
    types: ['route_building'],
  });
  assert.deepEqual(candidates.map((c) => c.work_type), ['route_building_shift']);
  assert.deepEqual(candidates[0].needs, [{ role: 'בונה מסלולים', count: 1 }]);
});

test('cancelled entries, vacations and entries without hours are not offered', () => {
  const { candidates, withoutHours } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    from: '2026-08-10',
    to: '2026-08-14',
    types: ['event'],
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

test('a class asks for the role that teaches it', () => {
  const { candidates } = calendarSlotCandidates({
    groups: [{ id: 'g1', name: 'חוג', day: 2, time: '16:00', duration: 50 }],
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    from: '2026-08-10',
    to: '2026-08-20',
  });
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates[0].needs, [{ role: 'הדרכת חוג', count: 1 }]);
});

test('a candidate reports how many are already placed on it', () => {
  const { candidates } = calendarSlotCandidates({
    activities: CALENDAR,
    rolesByType: ROLES_BY_TYPE,
    classRoles: CLASS_ROLES,
    from: '2026-08-10',
    to: '2026-08-14',
    types: ['event'],
    assignments: [
      { employee_id: 'e1', activity_id: 'a1', date: '2026-08-11', role: 'עוזר מדריך' },
      { employee_id: 'e2', activity_id: 'a1', date: '2026-08-11', role: 'הדרכת חוג' },
    ],
  });
  // שניהם נספרים: המשמרת צריכה את שני התפקידים, ומי שממלא אחד מהם תופס מקום.
  assert.equal(candidates[0].staffed, 2);
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

test('the form goes to the whole team, each carrying their own roles', () => {
  const employees = [
    { id: 'e1', name: 'דנה', certifications: ['עוזר מדריך'] },
    { id: 'e2', name: 'יואב', certifications: ['הדרכת חוג'] },
    { id: 'e3', name: 'אורי', certifications: ['עוזר מדריך'], is_active: false },
    { id: 'e4', name: 'בר', certifications: ['עוזר מדריך', 'הדרכת חוג'] },
  ];
  const offered = eligibleEmployees(employees);
  // הארכיון בחוץ, כל השאר בפנים — גם מי שאין לו את התפקיד שהמשמרת הראשונה
  // צריכה, כי אולי יש לו את התפקיד של המשמרת השלישית.
  assert.deepEqual(offered.map((e) => e.name), ['בר', 'דנה', 'יואב']);
  // התפקידים נוסעים איתם, כי המסך מציג לכל אחד רק את המושבים שהוא יכול לקחת.
  assert.deepEqual(offered.find((e) => e.name === 'בר').roles, ['עוזר מדריך', 'הדרכת חוג']);
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

test('the board is one row per seat, not one per shift', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', picks: [{ slot_id: row.slots[0].id, role: WALL }], submitted_at: '2026-08-10T08:00:00.000Z' },
    { window_id: 'w1', employee_id: 'e2', picks: [{ slot_id: row.slots[0].id, role: ASSISTANT }], submitted_at: '2026-08-10T09:00:00.000Z' },
    { window_id: 'w1', employee_id: 'e3', picks: [{ slot_id: row.slots[0].id, role: ASSISTANT }], submitted_at: '2026-08-10T10:00:00.000Z' },
  ];
  const employees = [{ id: 'e1', name: 'דנה' }, { id: 'e2', name: 'יואב' }, { id: 'e3', name: 'נועה' }];
  const assignments = [{ employee_id: 'e1', date: '2026-08-11', start_time: '15:30', role: WALL }];
  const board = signupBoard(row, responses, employees, assignments);

  const [wallSeat, assistantSeat] = board[0].seats;
  assert.equal(wallSeat.role, WALL);
  assert.deepEqual(wallSeat.claimants.map((c) => c.name), ['דנה']);
  assert.equal(wallSeat.claimants[0].assigned, true);
  assert.equal(wallSeat.missing, 0);
  // שניים ביקשו את מקום העוזר וצריך אחד — בדיוק ההחלטה שהמנהל בא לקבל.
  assert.deepEqual(assistantSeat.claimants.map((c) => c.name), ['יואב', 'נועה']);
  assert.equal(assistantSeat.needed, 1);
  assert.equal(assistantSeat.missing, 1);
  assert.equal(board[0].missing, 1);
});

test('someone placed from the calendar counts even though they never answered', () => {
  const row = windowFixture();
  const board = signupBoard(row, [], [], [
    { employee_id: 'e9', date: '2026-08-12', start_time: '15:30', role: WALL },
  ]);
  // משמרת שנראית ריקה כי השיבוץ נעשה ביומן היא מלכודת.
  assert.equal(board[1].seats[0].assigned, 1);
  assert.equal(board[1].missing, 0);
});

test('the board falls back to the name kept on the answer when the employee is gone', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'gone', employee_name: 'עובד שהוסר', picks: [{ slot_id: row.slots[0].id, role: WALL }] },
  ];
  assert.equal(signupBoard(row, responses, [], [])[0].seats[0].claimants[0].name, 'עובד שהוסר');
});

test('the respondent list says which roles each person offered to cover', () => {
  const row = windowFixture();
  const responses = [
    {
      window_id: 'w1',
      employee_id: 'e1',
      picks: [{ slot_id: row.slots[0].id, role: WALL }, { slot_id: row.slots[1].id, role: WALL }],
    },
  ];
  const summary = respondentSummary(row, responses, [{ id: 'e1', name: 'דנה' }], [
    { employee_id: 'e1', date: '2026-08-11', start_time: '15:30' },
  ]);
  assert.equal(summary[0].picked, 2);
  assert.equal(summary[0].assigned, 1);
  assert.deepEqual(summary[0].roles, [WALL]);
});

// ─── נמענים מפורשים ─────────────────────────────────────────────────────────

test('a named recipient list narrows the audience', () => {
  const employees = [
    { id: 'e1', name: 'דנה', certifications: [ASSISTANT] },
    { id: 'e2', name: 'יואב', certifications: [ASSISTANT] },
    { id: 'e3', name: 'נועה', certifications: [] },
  ];
  assert.deepEqual(eligibleEmployees(employees, ['e2', 'e3']).map((e) => e.id), ['e2', 'e3']);
  // רשימה ריקה פירושה כל הצוות.
  assert.deepEqual(eligibleEmployees(employees, []).map((e) => e.id), ['e1', 'e2', 'e3']);
});

test('an archived employee is never offered the form, even when named', () => {
  const employees = [{ id: 'e1', name: 'דנה', is_active: false, certifications: [ASSISTANT] }];
  assert.deepEqual(eligibleEmployees(employees, ['e1']), []);
});

test('recipients survive an edit that does not mention them', () => {
  const first = windowFixture({ recipients: ['e1', 'e2'] });
  const { window: edited } = normalizeWindow({ title: 'שם חדש' }, { existing: first });
  assert.deepEqual(edited.recipients, ['e1', 'e2']);
});

// ─── כמה משמרות אני רוצה ────────────────────────────────────────────────────

test('the wanted count cannot exceed what was actually claimed', () => {
  const row = windowFixture();
  const { record } = applyResponse(row, [], {
    employee_id: 'e1',
    picks: [{ slot_id: row.slots[0].id, role: WALL }],
    wanted_count: 5,
  }, { today: TODAY });
  assert.equal(record.wanted_count, 1);
});

test('an unanswered wanted count is zero, not one', () => {
  const row = windowFixture();
  const { record } = applyResponse(row, [], {
    employee_id: 'e1',
    picks: [
      { slot_id: row.slots[0].id, role: WALL },
      { slot_id: row.slots[1].id, role: WALL },
    ],
    wanted_count: '',
  }, { today: TODAY });
  assert.equal(record.wanted_count, 0);
});

// ─── אישור השיבוצים ─────────────────────────────────────────────────────────

test('an approved seat becomes a roster row carrying its role', () => {
  const row = windowFixture({
    slots: [{
      date: '2026-08-11', start_time: '15:30', end_time: '18:00',
      needs: [{ role: 'בונה מסלולים', count: 2 }],
      activity_id: 'a1', work_type: 'route_building_shift', label: 'בניית מסלולים',
    }],
  });
  const { rows } = planAssignments(row, [
    { slot_id: row.slots[0].id, employee_id: 'e1', role: 'בונה מסלולים' },
  ], { assignments: [], today: TODAY });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].assignment, {
    employee_id: 'e1',
    date: '2026-08-11',
    start_time: '15:30',
    end_time: '18:00',
    activity_id: 'a1',
    group_id: null,
    work_type: 'route_building_shift',
    // התפקיד הוא מה שקובע את התעריף, ולכן הוא בא מהמושב שאושר.
    role: 'בונה מסלולים',
    source: 'shift_signup',
  });
});

test('a role the shift does not need falls back to one it does', () => {
  const row = windowFixture();
  const { rows } = planAssignments(row, [
    // המשמרת השנייה צריכה מפעיל קיר בלבד.
    { slot_id: row.slots[1].id, employee_id: 'e1', role: 'המצאה' },
  ], { assignments: [], today: TODAY });
  // שיבוץ בלי תפקיד תקף הוא שיבוץ בלי תעריף, ולכן נופלים למושב הקיים.
  assert.equal(rows[0].assignment.role, WALL);
});

test('approving twice does not place the same person twice', () => {
  const row = windowFixture();
  const picks = [{ slot_id: row.slots[0].id, employee_id: 'e1' }];
  const { rows, skipped } = planAssignments(row, picks, {
    assignments: [{ id: 'w9', employee_id: 'e1', date: '2026-08-11', start_time: '15:30' }],
    today: TODAY,
  });
  assert.equal(rows.length, 0);
  assert.equal(skipped[0].reason, 'already');
});

test('a double-clicked name is one placement', () => {
  const row = windowFixture();
  const pick = { slot_id: row.slots[0].id, employee_id: 'e1' };
  const { rows } = planAssignments(row, [pick, { ...pick }], { assignments: [], today: TODAY });
  assert.equal(rows.length, 1);
});

test('a shift that already passed is skipped rather than back-dated', () => {
  const row = windowFixture();
  const { rows, skipped } = planAssignments(row, [{ slot_id: row.slots[0].id, employee_id: 'e1' }], {
    assignments: [],
    today: '2026-08-20',
  });
  assert.equal(rows.length, 0);
  assert.equal(skipped[0].reason, 'past');
});

test('the warning is on the seat, not on the shift', () => {
  const row = windowFixture();
  // המשמרת הראשונה צריכה מפעיל אחד ועוזר אחד — שלושה אנשים בסך הכול, אבל
  // שניים מהם על מקום העוזר. ספירה לפי משמרת הייתה מפספסת בדיוק את זה.
  const picks = [
    { slot_id: row.slots[0].id, employee_id: 'e1', role: WALL },
    { slot_id: row.slots[0].id, employee_id: 'e2', role: ASSISTANT },
    { slot_id: row.slots[0].id, employee_id: 'e3', role: ASSISTANT },
    { slot_id: row.slots[1].id, employee_id: 'e1', role: WALL },
  ];
  const warnings = planWarnings(row, picks, {
    responses: [{ window_id: 'w1', employee_id: 'e1', wanted_count: 1 }],
    employees: [{ id: 'e1', name: 'דנה' }],
    assignments: [],
  });
  const over = warnings.filter((w) => w.type === 'over_capacity');
  assert.equal(over.length, 1);
  assert.equal(over[0].role, ASSISTANT);
  assert.match(over[0].text, /2 אנשים למקום של 1/);
  const wanted = warnings.find((w) => w.type === 'over_wanted');
  assert.match(wanted.text, /דנה — 2 משמרות, ביקש 1/);
  // התכנון עצמו עדיין מייצר את כל השורות: אזהרה אינה חסימה.
  assert.equal(planAssignments(row, picks, { assignments: [], today: TODAY }).rows.length, 4);
});

test('someone already holding the seat counts toward its warning', () => {
  const row = windowFixture();
  const warnings = planWarnings(row, [{ slot_id: row.slots[1].id, employee_id: 'e2', role: WALL }], {
    responses: [],
    employees: [],
    assignments: [{ employee_id: 'e1', date: '2026-08-12', start_time: '15:30', role: WALL }],
  });
  assert.equal(warnings.filter((w) => w.type === 'over_capacity').length, 1);
});

test('a different role on the same shift is not a clash', () => {
  const row = windowFixture();
  const warnings = planWarnings(row, [{ slot_id: row.slots[0].id, employee_id: 'e2', role: ASSISTANT }], {
    responses: [],
    employees: [],
    // כבר יש מפעיל קיר על המשמרת — זה לא תופס את מקום העוזר.
    assignments: [{ employee_id: 'e1', date: '2026-08-11', start_time: '15:30', role: WALL }],
  });
  assert.deepEqual(warnings, []);
});

test('the message to an employee names the role for each shift', () => {
  const row = windowFixture();
  const text = assignmentMessageText(row, [
    { slot: { date: '2026-08-12', start_time: '15:30', end_time: '18:00', label: 'פתיחת קיר' }, role: WALL },
    { slot: { date: '2026-08-11', start_time: '15:30', end_time: '18:00' }, role: ASSISTANT },
  ]);
  const lines = text.split('\n').filter((line) => line.startsWith('•'));
  assert.deepEqual(lines, [
    `• יום שלישי, 11.8 · 15:30–18:00 · ${ASSISTANT}`,
    `• יום רביעי, 12.8 · 15:30–18:00 · פתיחת קיר · ${WALL}`,
  ]);
  assert.match(text, /משמרות פתיחה/);
});
