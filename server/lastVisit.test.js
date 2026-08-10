import test from 'node:test';
import assert from 'node:assert/strict';
import { lastVisit, lastVisitLabel, lastWallEntry, lastClassAttendance } from './lastVisit.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

test('the wall log answers for a free climber', () => {
  const checkIns = [
    { climber_id: 's1', timestamp: '2026-08-01T10:00:00.000Z' },
    { climber_id: 's1', timestamp: '2026-08-07T10:00:00.000Z' },
    { climber_id: 's2', timestamp: '2026-08-09T10:00:00.000Z' },
  ];
  assert.equal(lastWallEntry(checkIns, 's1').at, '2026-08-07T10:00:00.000Z');
  const visit = lastVisit({ checkIns, studentId: 's1' }, NOW);
  assert.equal(visit.source, 'wall');
  assert.equal(visit.days_ago, 3);
});

test('class attendance counts only when the climber actually showed up', () => {
  const attendance = [
    { student_id: 's1', date: '2026-08-09', status: 'absent' },
    { student_id: 's1', date: '2026-08-05', status: 'attended' },
    { student_id: 's1', date: '2026-08-06', status: 'present' },
    { student_id: 's1', date: '2026-08-07', status: 'pending' },
  ];
  assert.equal(lastClassAttendance(attendance, 's1', NOW).at, '2026-08-06');
});

test('attendance rows created for future sessions are not a visit', () => {
  const attendance = [
    { student_id: 's1', date: '2026-08-20', status: 'attended' },
    { student_id: 's1', date: '2026-08-03', status: 'attended' },
  ];
  assert.equal(lastClassAttendance(attendance, 's1', NOW).at, '2026-08-03');
});

test('the later of the two sources wins', () => {
  const checkIns = [{ climber_id: 's1', timestamp: '2026-08-02T10:00:00.000Z' }];
  const attendance = [{ student_id: 's1', date: '2026-08-08', status: 'attended' }];
  assert.equal(lastVisit({ checkIns, attendance, studentId: 's1' }, NOW).source, 'class');

  const later = [{ climber_id: 's1', timestamp: '2026-08-09T10:00:00.000Z' }];
  assert.equal(lastVisit({ checkIns: later, attendance, studentId: 's1' }, NOW).source, 'wall');
});

test('a climber with no history reports nothing rather than day zero', () => {
  const visit = lastVisit({ checkIns: [], attendance: [], studentId: 's9' }, NOW);
  assert.deepEqual(visit, { last_at: null, source: null, days_ago: null });
  assert.equal(lastVisitLabel(visit), 'לא נרשמה כניסה קודמת');
});

test('the counter label reads in days, months and years', () => {
  assert.equal(lastVisitLabel({ last_at: 'x', source: 'wall', days_ago: 0 }), 'היה כאן היום (קיר)');
  assert.equal(lastVisitLabel({ last_at: 'x', source: 'class', days_ago: 1 }), 'היה כאן אתמול (חוג)');
  assert.equal(lastVisitLabel({ last_at: 'x', source: 'wall', days_ago: 12 }), 'כניסה אחרונה לפני 12 ימים (קיר)');
  assert.equal(lastVisitLabel({ last_at: 'x', source: 'wall', days_ago: 120 }), 'כניסה אחרונה לפני 4 חודשים (קיר)');
  assert.match(lastVisitLabel({ last_at: 'x', source: 'wall', days_ago: 800 }), /שנתיים|2 שנים/);
});
