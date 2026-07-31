import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureAttendanceRows,
  isIntroAttStatus,
  isIntroStudent,
  keepIntroStatus,
  normalizeAttStatus,
} from './attendanceUtils.js';
import { resolveJoinDate } from './equipmentService.js';

const GROUPS = [{ id: 'g1', name: 'מתחילים', day: 0, active: true }];
// 2026-09-06 הוא יום ראשון.
const DATE = '2026-09-06';

function rowsFor(students) {
  return ensureAttendanceRows({
    groups: GROUPS,
    students,
    attendance: [],
    activities: [],
    date: DATE,
    groupId: 'g1',
  }).created;
}

test('שורה למתאמן בהכירות נולדת מסומנת ככזו', () => {
  const created = rowsFor([
    { id: 's1', status: 'intro_scheduled', groupIds: ['g1'] },
    { id: 's2', status: 'active', groupIds: ['g1'] },
  ]);
  assert.equal(created.find((r) => r.student_id === 's1').status, 'intro_pending');
  assert.equal(created.find((r) => r.student_id === 's2').status, 'pending');
});

test('גם intro_paid נחשב הכירות', () => {
  assert.equal(isIntroStudent({ status: 'intro_paid' }), true);
  assert.equal(isIntroStudent({ status: 'active' }), false);
});

test('intro_pending הוא סטטוס נוכחות מוכר', () => {
  assert.equal(normalizeAttStatus('intro_pending'), 'intro_pending');
  assert.equal(isIntroAttStatus('intro_pending'), true);
});

test('סימון רגיל על שורת הכירות נשאר הכירות', () => {
  assert.equal(keepIntroStatus('intro_pending', 'attended'), 'intro_attended');
  assert.equal(keepIntroStatus('intro_pending', 'absent'), 'intro_absent');
  assert.equal(keepIntroStatus('intro_attended', 'attended'), 'intro_attended');
});

test('חג ובוטל מתארים את היום ועוברים כמו שהם', () => {
  assert.equal(keepIntroStatus('intro_pending', 'holiday'), 'holiday');
  assert.equal(keepIntroStatus('intro_pending', 'cancelled'), 'cancelled');
});

test('שורה רגילה לא הופכת להכירות', () => {
  assert.equal(keepIntroStatus('pending', 'attended'), 'attended');
  assert.equal(keepIntroStatus(undefined, 'absent'), 'absent');
});

test('שורת הכירות שלא סומנה כבר סופרת לקיזוז הנעליים', () => {
  // המדריך עוד לא מילא נוכחות, אבל תאריך ההכירות כבר ידוע.
  assert.equal(resolveJoinDate([{ date: '2026-09-27', status: 'intro_pending' }]), '2026-10-04');
});
