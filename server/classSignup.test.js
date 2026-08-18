import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyClassResponse,
  classAssignmentMessageText,
  classSeatId,
  classSignupBoard,
  isClassWindowOpen,
  normalizeClassWindow,
  planClassStaffing,
  publicClassBoardView,
} from './classSignup.js';

const TODAY = '2026-08-17';
const CLASS_ROLES = ['הדרכת חוג', 'עוזר מדריך'];

const GROUPS = [
  { id: 'g1', name: "ילדים ג'-ד'", day: 2, time: '16:00', duration: 50, trainer: '', assistants: [] },
  { id: 'g2', name: 'חטיבה', day: 2, time: '18:40', duration: 80, trainer: 'e9', assistants: [] },
];

const EMPLOYEES = [
  { id: 'e1', name: 'דנה', certifications: ['עוזר מדריך'] },
  { id: 'e2', name: 'יואב', certifications: ['הדרכת חוג', 'עוזר מדריך'] },
  { id: 'e9', name: 'ותיק', certifications: ['הדרכת חוג'] },
];

function windowFixture(overrides = {}) {
  const { window: row, error } = normalizeClassWindow({
    title: 'שיבוץ חוגים',
    seats: [
      { group_id: 'g1', label: "ילדים ג'-ד'", day: 2, time: '16:00', duration: 50,
        needs: [{ role: 'הדרכת חוג', count: 1 }, { role: 'עוזר מדריך', count: 2 }] },
      { group_id: 'g2', label: 'חטיבה', day: 2, time: '18:40', duration: 80 },
    ],
    ...overrides,
  }, { classRoles: CLASS_ROLES });
  assert.equal(error, undefined);
  return { ...row, id: 'w1' };
}

test('a class seat carries no date and is keyed by its group', () => {
  const row = windowFixture();
  assert.deepEqual(row.seats.map((s) => s.id), [classSeatId('g1'), classSeatId('g2')]);
  for (const seat of row.seats) assert.equal(seat.date, undefined);
});

test('editing the form keeps the ticks of classes that stayed', () => {
  const first = windowFixture();
  const { window: edited } = normalizeClassWindow({
    seats: [
      { group_id: 'g2', label: 'חטיבה', day: 2, time: '18:40', duration: 80 },
      { group_id: 'g3', label: 'בוגרים', day: 3, time: '20:00', duration: 80 },
    ],
  }, { existing: first, classRoles: CLASS_ROLES });
  assert.equal(edited.seats[0].id, first.seats[1].id);
  assert.equal(edited.token, first.token);
});

test('a class with no stated requirement asks for one trainer and two assistants', () => {
  assert.deepEqual(windowFixture().seats[1].needs, [
    { role: 'הדרכת חוג', count: 1 },
    { role: 'עוזר מדריך', count: 2 },
  ]);
});

test('a trainer may claim an assistant seat; an assistant may not claim a trainer seat', () => {
  const row = windowFixture();
  const fallbacks = { 'עוזר מדריך': ['הדרכת חוג'] };
  // "ותיק" מוסמך רק כמדריך — ובכל זאת מושב עוזר פתוח בפניו.
  const trainerPick = applyClassResponse(row, [], {
    employee_id: 'e9',
    picks: [{ slot_id: classSeatId('g1'), role: 'עוזר מדריך' }],
  }, { today: TODAY, employee: EMPLOYEES[2], roleFallbacks: fallbacks });
  assert.deepEqual(trainerPick.record.picks, [{ slot_id: classSeatId('g1'), role: 'עוזר מדריך' }]);

  // דנה מוסמכת רק כעוזרת — מושב מדריך נשאר סגור גם עם המדרג.
  const assistantPick = applyClassResponse(row, [], {
    employee_id: 'e1',
    picks: [{ slot_id: classSeatId('g1'), role: 'הדרכת חוג' }],
  }, { today: TODAY, employee: EMPLOYEES[0], roleFallbacks: fallbacks });
  assert.deepEqual(assistantPick.record.picks, []);
});

test('approval seats a trainer in an assistant chair — two trainers, one assistant', () => {
  const row = windowFixture();
  const { groups, skipped } = planClassStaffing(row, [
    { slot_id: classSeatId('g1'), employee_id: 'e2', role: 'הדרכת חוג' },
    // e9 מוסמך רק כמדריך, ולוקח מושב עוזר — התרחיש של שני מדריכים בחוג אחד.
    { slot_id: classSeatId('g1'), employee_id: 'e9', role: 'עוזר מדריך' },
  ], { groups: GROUPS, employees: EMPLOYEES, classRoles: CLASS_ROLES });
  assert.deepEqual(skipped, []);
  assert.equal(groups[0].trainer, 'e2');
  assert.deepEqual(groups[0].assistants, ['e9']);
});

test('the form closes on status and on its deadline, never on a passing date', () => {
  const row = windowFixture();
  assert.equal(isClassWindowOpen(row, TODAY), true);
  // שנה קדימה — לטופס חוגים אין „המשמרת האחרונה עברה”.
  assert.equal(isClassWindowOpen(row, '2027-08-17'), true);
  assert.equal(isClassWindowOpen({ ...row, status: 'closed' }, TODAY), false);
  assert.equal(isClassWindowOpen({ ...row, deadline: '2026-08-16' }, TODAY), false);
  assert.equal(isClassWindowOpen({ ...row, deadline: '2026-08-17' }, TODAY), true);
});

test('the employee sees how many already asked for each role', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', picks: [{ slot_id: classSeatId('g1'), role: 'עוזר מדריך' }] },
    { window_id: 'w1', employee_id: 'e2', picks: [{ slot_id: classSeatId('g1'), role: 'עוזר מדריך' }] },
  ];
  const view = publicClassBoardView(row, responses, TODAY);
  const seat = view.seats[0];
  assert.equal(seat.needs.find((n) => n.role === 'עוזר מדריך').taken, 2);
  assert.equal(seat.needs.find((n) => n.role === 'הדרכת חוג').taken, 0);
});

test('a role the employee is not certified for is refused, not merely hidden', () => {
  const row = windowFixture();
  const { record } = applyClassResponse(row, [], {
    employee_id: 'e1',
    picks: [
      { slot_id: classSeatId('g1'), role: 'הדרכת חוג' },
      { slot_id: classSeatId('g2'), role: 'הדרכת חוג' },
    ],
  }, { today: TODAY, employee: EMPLOYEES[0] });
  assert.deepEqual(record.picks, []);
});

test('one class, one role — the second choice corrects the first', () => {
  const row = windowFixture();
  const { record } = applyClassResponse(row, [], {
    employee_id: 'e2',
    picks: [
      { slot_id: classSeatId('g1'), role: 'הדרכת חוג' },
      { slot_id: classSeatId('g1'), role: 'עוזר מדריך' },
    ],
  }, { today: TODAY, employee: EMPLOYEES[1] });
  assert.deepEqual(record.picks, [{ slot_id: classSeatId('g1'), role: 'הדרכת חוג' }]);
});

test('a second answer replaces the first', () => {
  const row = windowFixture();
  const responses = [{ id: 'r1', window_id: 'w1', employee_id: 'e1', picks: [] }];
  const { record, existing } = applyClassResponse(row, responses, {
    employee_id: 'e1',
    picks: [{ slot_id: classSeatId('g1'), role: 'עוזר מדריך' }],
  }, { today: TODAY, employee: EMPLOYEES[0] });
  assert.equal(existing.id, 'r1');
  assert.equal(record.id, 'r1');
  assert.equal(record.picks.length, 1);
});

test('a closed form refuses answers', () => {
  const row = windowFixture({ status: 'closed' });
  const { error } = applyClassResponse({ ...row, id: 'w1' }, [], { employee_id: 'e1' }, { today: TODAY });
  assert.match(error, /נסגרה/);
});

test('the board shows who asked and who already holds the class', () => {
  const row = windowFixture();
  const responses = [
    { window_id: 'w1', employee_id: 'e1', picks: [{ slot_id: classSeatId('g1'), role: 'עוזר מדריך' }] },
  ];
  const board = classSignupBoard(row, responses, EMPLOYEES, GROUPS, CLASS_ROLES);
  const assistantSeat = board[0].seats.find((s) => s.role === 'עוזר מדריך');
  assert.deepEqual(assistantSeat.claimants.map((c) => c.name), ['דנה']);
  assert.equal(assistantSeat.missing, 2);

  // החוג השני כבר מאויש בלוח, וזה מופיע גם בלי שאיש ענה.
  const trainerSeat = board[1].seats[0];
  assert.equal(trainerSeat.assigned, 1);
  assert.equal(trainerSeat.missing, 0);
  assert.deepEqual(trainerSeat.claimants.map((c) => [c.name, c.answered]), [['ותיק', false]]);
});

test('approving writes the standing staffing of the class', () => {
  const row = windowFixture();
  const { groups, skipped } = planClassStaffing(row, [
    { slot_id: classSeatId('g1'), employee_id: 'e2', role: 'הדרכת חוג' },
    { slot_id: classSeatId('g1'), employee_id: 'e1', role: 'עוזר מדריך' },
  ], { groups: GROUPS, employees: EMPLOYEES, classRoles: CLASS_ROLES });
  assert.equal(skipped.length, 0);
  assert.deepEqual(groups, [{
    group_id: 'g1',
    group_name: "ילדים ג'-ד'",
    trainer: 'e2',
    assistants: ['e1'],
    placed: [
      { employee_id: 'e2', role: 'הדרכת חוג', seat_id: classSeatId('g1'), label: "ילדים ג'-ד'" },
      { employee_id: 'e1', role: 'עוזר מדריך', seat_id: classSeatId('g1'), label: "ילדים ג'-ד'" },
    ],
  }]);
});

test('a class that already has a trainer is skipped, never overwritten', () => {
  const row = windowFixture();
  const { groups, skipped } = planClassStaffing(row, [
    { slot_id: classSeatId('g2'), employee_id: 'e2', role: 'הדרכת חוג' },
  ], { groups: GROUPS, employees: EMPLOYEES, classRoles: CLASS_ROLES });
  assert.deepEqual(groups, []);
  assert.deepEqual(skipped, [{ employee_id: 'e2', group_id: 'g2', reason: 'trainer_taken' }]);
});

test('an explicit replace fills the chair the skip protected', () => {
  const row = windowFixture();
  const { groups } = planClassStaffing(row, [
    { slot_id: classSeatId('g2'), employee_id: 'e2', role: 'הדרכת חוג' },
  ], { groups: GROUPS, employees: EMPLOYEES, classRoles: CLASS_ROLES, replace: ['g2'] });
  assert.equal(groups[0].trainer, 'e2');
});

test('the trainer never lands in their own assistants list', () => {
  const withAssistant = [{ ...GROUPS[0], assistants: ['e2'] }];
  const { groups } = planClassStaffing(windowFixture(), [
    { slot_id: classSeatId('g1'), employee_id: 'e2', role: 'הדרכת חוג' },
  ], { groups: withAssistant, employees: EMPLOYEES, classRoles: CLASS_ROLES });
  assert.equal(groups[0].trainer, 'e2');
  assert.deepEqual(groups[0].assistants, []);
});

test('someone already assistant of the class is not added twice', () => {
  const withAssistant = [{ ...GROUPS[0], assistants: ['e1'] }];
  const { groups, skipped } = planClassStaffing(windowFixture(), [
    { slot_id: classSeatId('g1'), employee_id: 'e1', role: 'עוזר מדריך' },
  ], { groups: withAssistant, employees: EMPLOYEES, classRoles: CLASS_ROLES });
  assert.deepEqual(groups, []);
  assert.deepEqual(skipped, [{ employee_id: 'e1', group_id: 'g1', reason: 'already' }]);
});

test('an uncertified pick never reaches the class board', () => {
  const { groups, skipped } = planClassStaffing(windowFixture(), [
    { slot_id: classSeatId('g1'), employee_id: 'e1', role: 'הדרכת חוג' },
  ], { groups: GROUPS, employees: EMPLOYEES, classRoles: CLASS_ROLES });
  assert.deepEqual(groups, []);
  assert.deepEqual(skipped, [{ employee_id: 'e1', group_id: 'g1', reason: 'not_certified' }]);
});

test('the message names the classes without pretending to know a date', () => {
  const text = classAssignmentMessageText({ title: 'שיבוץ חוגים' }, [
    { label: "ילדים ג'-ד'", role: 'עוזר מדריך' },
  ]);
  assert.match(text, /ילדים ג'-ד' · עוזר מדריך/);
  assert.match(text, /השיבוץ קבוע/);
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}/);
});
