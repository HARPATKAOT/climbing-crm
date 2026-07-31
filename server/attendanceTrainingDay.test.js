import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureAttendanceRows } from './attendanceUtils.js';

// day: 2 = יום שלישי. 2026-07-31 הוא יום שישי, 2026-08-04 הוא יום שלישי.
const GROUPS = [{ id: 'g1', name: "ילדים ג'-ד' — יום ג'", day: 2, active: true }];
const STUDENTS = [
  { id: 's1', name: 'ראם', status: 'active', groupIds: ['g1'] },
  { id: 's2', name: 'שקד', status: 'active', groupIds: ['g1'] },
];

const run = (date, attendance = []) =>
  ensureAttendanceRows({
    groups: GROUPS,
    students: STUDENTS,
    attendance,
    activities: [],
    date,
    groupId: 'g1',
  });

test('לא נוצרות שורות ביום שהקבוצה לא מתאמנת בו', () => {
  const result = run('2026-07-31');
  assert.equal(result.created.length, 0);
  assert.equal(result.notTrainingDay, true);
  assert.deepEqual(result.groups, []);
});

test('ביום האימון נוצרות שורות לכל הרשומים', () => {
  const result = run('2026-08-04');
  assert.equal(result.created.length, 2);
  assert.equal(result.notTrainingDay, false);
});

test('פתיחה חוזרת ביום אימון לא מכפילה שורות', () => {
  const first = run('2026-08-04');
  const second = run('2026-08-04', first.created);
  assert.equal(second.created.length, 0);
});

test('קבוצה שמתאמנת פעמיים בשבוע נתפסת בשני הימים', () => {
  const twice = [{ id: 'g2', name: "מתקדמים ב׳+ה׳ 15:30", day: 1, active: true }];
  const students = [{ id: 's3', status: 'active', groupIds: ['g2'] }];
  const base = { groups: twice, students, attendance: [], activities: [], groupId: 'g2' };
  // 2026-08-03 שני, 2026-08-06 חמישי
  assert.equal(ensureAttendanceRows({ ...base, date: '2026-08-03' }).created.length, 1);
  assert.equal(ensureAttendanceRows({ ...base, date: '2026-08-06' }).created.length, 1);
  // 2026-08-04 שלישי — לא יום אימון של הקבוצה הזו
  assert.equal(ensureAttendanceRows({ ...base, date: '2026-08-04' }).created.length, 0);
});

test('קבוצה לא פעילה לא מייצרת שורות גם ביום האימון', () => {
  const result = ensureAttendanceRows({
    groups: [{ ...GROUPS[0], active: false }],
    students: STUDENTS,
    attendance: [],
    activities: [],
    date: '2026-08-04',
    groupId: 'g1',
  });
  assert.equal(result.created.length, 0);
});
