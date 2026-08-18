import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCentreReport,
  centreNameTokens,
  firstBillableSession,
  findStudentsByName,
  attendanceCounts,
  formatReportDate,
} from './centreReport.js';

const students = [
  { id: 's1', name: 'יונתן כהן', groupId: 'weekly' },
  { id: 's2', name: 'נועה לוי', groupId: 'weekly' },
  { id: 's3', name: 'יונתן מזרחי' },
];

const groups = [
  { id: 'weekly', trainingDays: [0] },
  { id: 'twice', trainingDays: [1, 4] },
];

const introBookings = [{
  id: 'intro-s1',
  student_id: 's1',
  session_date: '2026-07-05',
  status: 'no_show',
  paid_at: '2026-07-01T08:00:00.000Z',
}];

const attendance = [
  { student_id: 's1', date: '2026-07-05', status: 'intro_attended' },
  { student_id: 's1', date: '2026-07-12', status: 'attended' },
  { student_id: 's1', date: '2026-07-19', status: 'absent' },
  { student_id: 's1', date: '2026-07-26', status: 'attended' },
  { student_id: 's2', date: '2026-07-10', status: 'pending' },
];

test('the intro lesson is excluded, because it was paid for separately', () => {
  // The attendance row knows it is an intro by its own status, decided when the
  // row was created — not derived from the trainee's status today, which would
  // rewrite history every time somebody's status changed.
  const result = firstBillableSession(attendance, 's1');
  assert.equal(result.introDate, '2026-07-05');
  assert.equal(result.firstBillable, '2026-07-12');
  assert.equal(result.sessions, 2); // the absence is not a session
});

test('only marks that mean the trainee climbed are counted', () => {
  assert.equal(attendanceCounts('attended'), true);
  assert.equal(attendanceCounts('makeup'), true);
  assert.equal(attendanceCounts('present'), true);   // normalises to attended
  assert.equal(attendanceCounts('intro_attended'), false);
  assert.equal(attendanceCounts('absent'), false);
  assert.equal(attendanceCounts('pending'), false);
  assert.equal(attendanceCounts('holiday'), false);
});

test('a name the centre typed is answered with the billing date', () => {
  const report = buildCentreReport({ students, attendance, groups, introBookings, name: 'יונתן כהן' });
  assert.equal(report.ok, true);
  assert.equal(report.date, '2026-07-12');
  assert.equal(report.student.id, 's1');
  assert.match(report.reply, /12\.7\.2026/);
  assert.equal(report.billing.label, '3/4');
  assert.match(report.reply, /לפי 3\/4/);
});

test('anything the bot cannot settle goes to a person, with the reason', () => {
  // A wrong date here is a wrong charge to a family, so every uncertain branch
  // ends in a human rather than a best guess.
  const ambiguous = buildCentreReport({ students, attendance, name: 'יונתן' });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'ambiguous');
  assert.match(ambiguous.reply, /יונתן כהן/);
  assert.match(ambiguous.reply, /יונתן מזרחי/);

  const missing = buildCentreReport({ students, attendance, name: 'דני' });
  assert.equal(missing.reason, 'not_found');

  const unmarked = buildCentreReport({ students, attendance, name: 'נועה לוי' });
  assert.equal(unmarked.reason, 'no_attendance');
  assert.equal(unmarked.student.id, 's2');

  assert.equal(buildCentreReport({ students, attendance, name: '' }).reason, 'no_name');
});

test('a trainee with no intro is reported from their first session', () => {
  const noIntro = [{ student_id: 's2', date: '2026-08-02', status: 'attended' }];
  const report = buildCentreReport({ students, attendance: noIntro, groups, name: 'נועה לוי' });
  assert.equal(report.ok, true);
  assert.equal(report.date, '2026-08-02');
  assert.equal(report.billing.label, '4/4');
  assert.match(report.reply, /לפי 4\/4/);
});

test('a twice-weekly group deducts every paid intro in the same month', () => {
  const twiceStudent = { id: 's4', name: 'יאיר כהן', groupId: 'twice' };
  const report = buildCentreReport({
    students: [twiceStudent],
    attendance: [{ student_id: 's4', date: '2026-09-08', status: 'attended' }],
    groups,
    introBookings: [{
      id: 'intro-s4', student_id: 's4', session_date: '2026-09-01',
      status: 'no_show', paid_at: '2026-08-31T10:00:00.000Z',
    }],
    name: 'יאיר כהן',
  });
  assert.equal(report.ok, true);
  assert.equal(report.billing.label, '7/8');
  assert.match(report.reply, /לפי 7\/8/);
});

test('an exact name wins over a partial one', () => {
  assert.deepEqual(findStudentsByName(students, 'יונתן כהן').map((s) => s.id), ['s1']);
  assert.equal(findStudentsByName(students, 'יונתן').length, 2);
  assert.equal(findStudentsByName(students, 'א').length, 0);
});

test('dates are written the way a person outside the system reads them', () => {
  assert.equal(formatReportDate('2026-07-05'), '5.7.2026');
  assert.equal(formatReportDate(''), '');
});

test('the verb the centre types is not part of the name, and the order is not fixed', () => {
  const roster = [
    { id: 'a', name: 'קרני אלימלך' },
    { id: 'b', name: 'נטע יאירי' },
    { id: 'c', name: 'יאיר כהן' },
    { id: 'd', name: 'יאיר לוי' },
  ];
  // "אלימלך קרני נרשם" was looked up whole — verb included, names reversed —
  // and came back as a child we do not have.
  assert.deepEqual(findStudentsByName(roster, 'אלימלך קרני נרשם').map((s) => s.id), ['a']);
  assert.deepEqual(findStudentsByName(roster, 'קרני אלימלך').map((s) => s.id), ['a']);

  // "יאירי נטע" matched four children called יאיר, because the typed string
  // contains their whole name. Every word typed has to be in the name.
  assert.deepEqual(findStudentsByName(roster, 'יאירי נטע').map((s) => s.id), ['b']);
  assert.deepEqual(findStudentsByName(roster, 'יאיר').map((s) => s.id), ['c', 'd']);

  // A message that is all verbs is not a name at all.
  assert.deepEqual(findStudentsByName(roster, 'הוא נרשם במתנס'), []);
  assert.deepEqual(centreNameTokens('אלימלך קרני נרשם'), ['אלימלך', 'קרני']);
});

test('before the season opens the answer is the opening day, charged in full', () => {
  const weekly = { id: 'w1', name: 'נטע יאירי', groupId: 'weekly' };
  const report = buildCentreReport({
    students: [weekly],
    attendance: [],
    groups,
    name: 'נטע יאירי',
    seasonStart: '2026-09-01',
    today: '2026-08-16',
  });
  // 1.9.2026 is a Tuesday; the weekly group trains on Sunday, so the first
  // session is the 6th. Nobody has attendance in August — that is not a
  // missing register, it is a season that has not started.
  assert.equal(report.ok, true);
  assert.equal(report.date, '2026-09-06');
  assert.equal(report.beforeSeason, true);
  assert.equal(report.billing.label, 'חודש מלא');
  assert.match(report.reply, /האימון הראשון 6\.9\.2026/);
  assert.match(report.reply, /מחויב במלואו/);

  // Once the season is running, only the register may say when a child began.
  const started = buildCentreReport({
    students: [weekly],
    attendance: [],
    groups,
    name: 'נטע יאירי',
    seasonStart: '2026-09-01',
    today: '2026-09-20',
  });
  assert.equal(started.ok, false);
  assert.equal(started.reason, 'no_attendance');

  // Without a group there is no training day to name, so it stays a person's job.
  const noGroup = buildCentreReport({
    students: [{ id: 'w2', name: 'רון כץ' }],
    attendance: [],
    groups,
    name: 'רון כץ',
    seasonStart: '2026-09-01',
    today: '2026-08-16',
  });
  assert.equal(noGroup.reason, 'no_attendance');
});
