import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consecutiveAbsences,
  ensureAttendanceRows,
  getSortedGroupDays,
  groupMeetsOnDay,
} from './attendanceUtils.js';

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

test('ימי קבוצה כפולה מוחזרים בסדר כרונולוגי ומתאימים לכל אחד מהימים', () => {
  const group = { name: 'נבחרת צעירה — ב׳+ה׳ 17:00', day: 4 };
  assert.deepEqual(getSortedGroupDays(group), [1, 4]);
  assert.equal(groupMeetsOnDay(group, 1), true);
  assert.equal(groupMeetsOnDay(group, 4), true);
  assert.equal(groupMeetsOnDay(group, 2), false);
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

// ─── רצף היעדרויות ───────────────────────────────────────────────────────────

const att = (date, status, group_id = 'g1') => ({ date, status, group_id, student_id: 's1' });

test('רצף היעדרויות נספר על פני כל הקבוצות של המתאמן', () => {
  // שתי קבוצות לסירוגין — בכל אחת בנפרד יש 2, יחד 4.
  const rows = [
    att('2026-08-03', 'absent', 'g1'),
    att('2026-08-05', 'absent', 'g2'),
    att('2026-08-10', 'absent', 'g1'),
    att('2026-08-12', 'absent', 'g2'),
    att('2026-07-27', 'attended', 'g1'),
  ];
  assert.equal(consecutiveAbsences(rows), 4);
});

test('נוכחות שוברת את הרצף', () => {
  const rows = [
    att('2026-08-03', 'absent'),
    att('2026-08-10', 'attended'),
    att('2026-08-17', 'absent'),
  ];
  assert.equal(consecutiveAbsences(rows), 1);
});

test('שורה שלא סומנה ויום חג מדולגים ואינם שוברים', () => {
  const rows = [
    att('2026-08-03', 'absent'),
    att('2026-08-10', 'holiday'),
    att('2026-08-17', 'pending'),
    att('2026-08-24', 'absent'),
  ];
  assert.equal(consecutiveAbsences(rows), 2);
});

test('היעדרות מאימון הכירות נספרת', () => {
  assert.equal(consecutiveAbsences([att('2026-08-03', 'intro_absent')]), 1);
});

test('until מגביל לתאריך המפגש שעל המסך', () => {
  const rows = [
    att('2026-08-03', 'absent'),
    att('2026-08-10', 'absent'),
    att('2026-08-17', 'attended'),
  ];
  assert.equal(consecutiveAbsences(rows), 0);
  assert.equal(consecutiveAbsences(rows, { until: '2026-08-10' }), 2);
});

test('בלי נוכחות בכלל אין רצף', () => {
  assert.equal(consecutiveAbsences([]), 0);
});
