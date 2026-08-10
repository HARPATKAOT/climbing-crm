import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklySessionsForStudent } from './studentFrequency.js';

/** db מינימלי: רק get/getOne, כמו בשאר בדיקות הציוד. */
function makeDb(store) {
  return {
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((r) => String(r.id) === String(id)) || null,
  };
}

const student = { id: 's1', name: 'ראם' };

test('קבוצה אחת חד-יומית — אימון אחד בשבוע', () => {
  const db = makeDb({
    students: [student],
    groups: [{ id: 'g1', name: "ילדים ג'-ד' — יום א׳ 17:30", day: 0 }],
    enrollments: [{ id: 'e1', student_id: 's1', group_id: 'g1', status: 'active' }],
  });
  assert.equal(weeklySessionsForStudent({ db, studentId: 's1' }), 1);
});

test('קבוצת ב׳+ה׳ אחת — שני אימונים בשבוע', () => {
  const db = makeDb({
    students: [student],
    groups: [{ id: 'g1', name: 'נבחרת צעירה — ב׳+ה׳ 17:00', day: 4 }],
    enrollments: [{ id: 'e1', student_id: 's1', group_id: 'g1', status: 'active' }],
  });
  assert.equal(weeklySessionsForStudent({ db, studentId: 's1' }), 2);
});

test('ימי אימון מפורשים גוברים על שם הקבוצה', () => {
  const db = makeDb({
    students: [student],
    groups: [{ id: 'g1', name: 'חטיבה — יום ד׳ 18:40', day: 3 }],
    group_bot_meta: [{ id: 'g1', trainingDays: [1, 3] }],
    enrollments: [{ id: 'e1', student_id: 's1', group_id: 'g1', status: 'active' }],
  });
  assert.equal(weeklySessionsForStudent({ db, studentId: 's1' }), 2);
});

test('שתי קבוצות נפרדות של יום אחד — שני אימונים בשבוע', () => {
  const db = makeDb({
    students: [student],
    groups: [
      { id: 'g1', name: "ילדים ג'-ד' — יום א׳ 17:30", day: 0 },
      { id: 'g2', name: "ילדים ג'-ד' — יום ד׳ 17:30", day: 3 },
    ],
    enrollments: [
      { id: 'e1', student_id: 's1', group_id: 'g1', status: 'active' },
      { id: 'e2', student_id: 's1', group_id: 'g2', status: 'active' },
    ],
  });
  assert.equal(weeklySessionsForStudent({ db, studentId: 's1' }), 2);
});

test('רישום שהסתיים לא נספר', () => {
  const db = makeDb({
    students: [student],
    groups: [
      { id: 'g1', name: "ילדים ג'-ד' — יום א׳ 17:30", day: 0 },
      { id: 'g2', name: "ילדים ג'-ד' — יום ד׳ 17:30", day: 3 },
    ],
    enrollments: [
      { id: 'e1', student_id: 's1', group_id: 'g1', status: 'active' },
      { id: 'e2', student_id: 's1', group_id: 'g2', status: 'ended', end_date: '2026-06-30' },
    ],
  });
  assert.equal(weeklySessionsForStudent({ db, studentId: 's1' }), 1);
});

test('בלי רישומים נופלים ל-groupId שעל המתאמן, ואם גם הוא ריק — אימון אחד', () => {
  const withLegacy = makeDb({
    students: [{ ...student, groupId: 'g1' }],
    groups: [{ id: 'g1', name: 'נבחרת בוגרת — ב׳+ה׳ 19:10', day: 4 }],
    enrollments: [],
  });
  assert.equal(weeklySessionsForStudent({ db: withLegacy, studentId: 's1' }), 2);

  const unplaced = makeDb({ students: [student], groups: [], enrollments: [] });
  assert.equal(weeklySessionsForStudent({ db: unplaced, studentId: 's1' }), 1);
});
