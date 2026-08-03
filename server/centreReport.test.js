import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCentreReport,
  firstBillableSession,
  findStudentsByName,
  attendanceCounts,
  formatReportDate,
} from './centreReport.js';

const students = [
  { id: 's1', name: 'יונתן כהן' },
  { id: 's2', name: 'נועה לוי' },
  { id: 's3', name: 'יונתן מזרחי' },
];

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
  const report = buildCentreReport({ students, attendance, name: 'יונתן כהן' });
  assert.equal(report.ok, true);
  assert.equal(report.date, '2026-07-12');
  assert.equal(report.student.id, 's1');
  assert.match(report.reply, /12\.7\.2026/);
  assert.match(report.reply, /שולם בנפרד/);
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
  const report = buildCentreReport({ students, attendance: noIntro, name: 'נועה לוי' });
  assert.equal(report.ok, true);
  assert.equal(report.date, '2026-08-02');
  assert.match(report.reply, /ללא אימון היכרות/);
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
