/**
 * נוכחות באירוע שיש בו הרשמות חלקיות.
 *
 * הדרישה: משתתף מופיע רק בימים שאליהם נרשם. עד כאן הרשימה הייתה מכפלה מלאה
 * של משתתפים × ימים, וילד שבא ליומיים מתוך חמישה ייצר שלושה תאים ריקים.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActivityAttendance,
  attendanceDaysFor,
  planAttendanceMark,
} from './activityAttendance.js';

const camp = {
  id: 'act1',
  name: 'קייטנת קיץ',
  date: '2026-08-10',
  end_date: '2026-08-12',
  allow_single_day: true,
  single_day_price: 120,
};

const full = { id: 'r1', participant_name: 'דנה', status: 'active' };
const partial = {
  id: 'r2',
  participant_name: 'יונתן',
  status: 'active',
  attending_dates: ['2026-08-11'],
};

test('משתתף מלא מקבל את כל הימים, חלקי רק את שלו', () => {
  assert.equal(attendanceDaysFor({ activity: camp, registration: full }).length, 3);
  const days = attendanceDaysFor({ activity: camp, registration: partial });
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-08-11');
});

test('סרגל הימים מציג את כל ימי האירוע גם כשיש הרשמות חלקיות', () => {
  const built = buildActivityAttendance({ activity: camp, registrations: [full, partial] });
  assert.deepEqual(built.dates, ['2026-08-10', '2026-08-11', '2026-08-12']);
  assert.equal(built.multi_day, true);
});

test('הסכום ליום סופר רק את מי שרשום אליו', () => {
  const built = buildActivityAttendance({ activity: camp, registrations: [full, partial] });
  const byDate = Object.fromEntries(built.totals.map((t) => [t.date, t]));
  assert.equal(byDate['2026-08-10'].total, 1);
  assert.equal(byDate['2026-08-11'].total, 2);
  assert.equal(byDate['2026-08-12'].total, 1);
});

test('כל משתתף נושא את הימים שלו, כדי שהמסך יסנן לפי תאריך ולא לפי אינדקס', () => {
  const built = buildActivityAttendance({ activity: camp, registrations: [full, partial] });
  const yonatan = built.participants.find((p) => p.registration_id === 'r2');
  assert.deepEqual(yonatan.attending_dates, ['2026-08-11']);
});

test('סימון נוכחות ביום שאליו נרשם עובר', () => {
  const plan = planAttendanceMark({
    activity: camp, registration: partial, date: '2026-08-11', status: 'attended',
  });
  assert.equal(plan.action, 'insert');
});

test('סימון נוכחות ביום שאליו לא נרשם נדחה, בהודעה משלו', () => {
  const plan = planAttendanceMark({
    activity: camp, registration: partial, date: '2026-08-12', status: 'attended',
  });
  assert.equal(plan.action, 'invalid');
  assert.match(plan.error, /לא נרשם ליום/);
});

test('תאריך שאינו של האירוע נשאר שגיאה אחרת', () => {
  const plan = planAttendanceMark({
    activity: camp, registration: full, date: '2026-09-01', status: 'attended',
  });
  assert.equal(plan.action, 'invalid');
  assert.match(plan.error, /לא נכלל בימי הפעילות/);
});

test('אירוע בלי הרשמות חלקיות מתנהג בדיוק כמו קודם', () => {
  const built = buildActivityAttendance({ activity: camp, registrations: [full] });
  assert.equal(built.participants[0].days.length, 3);
  for (const total of built.totals) assert.equal(total.total, 1);
});
