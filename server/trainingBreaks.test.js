import test from 'node:test';
import assert from 'node:assert/strict';
import { breakLengthDays, upcomingTrainingBreaks } from './trainingBreaks.js';

const TODAY = '2026-08-11';

const store = (activities) => ({ get: (table) => (table === 'activities' ? activities : []) });

const vacation = (over) => ({ type: 'training_vacation', status: 'open', ...over });

test('אורך החופשה סופר את שני הקצוות', () => {
  assert.equal(breakLengthDays('2027-04-21', '2027-04-28'), 8);
  assert.equal(breakLengthDays('2026-10-27', '2026-10-27'), 1);
});

test('החופשות מוחזרות לפי סדר, ורק אלה שעוד לא הסתיימו', () => {
  const db = store([
    vacation({ id: 'v1', name: 'פסח', date: '2027-04-21', end_date: '2027-04-28' }),
    vacation({ id: 'v2', name: 'סוכות', date: '2026-09-25', end_date: '2026-10-03' }),
    vacation({ id: 'v3', name: 'שעבר', date: '2026-06-01', end_date: '2026-06-05' }),
    { id: 'a1', type: 'trip', name: 'טיול', date: '2026-09-01' },
  ]);
  const rows = upcomingTrainingBreaks(db, { today: TODAY });

  assert.deepEqual(rows.map((r) => r.name), ['סוכות', 'פסח']);
  assert.equal(rows[1].days, 8);
});

test('חופשה שכבר התחילה ועדיין נמשכת היא תשובה, לא היסטוריה', () => {
  const db = store([
    vacation({ id: 'v1', name: 'עכשווית', date: '2026-08-09', end_date: '2026-08-20' }),
  ]);
  assert.equal(upcomingTrainingBreaks(db, { today: TODAY }).length, 1);
});

test('חופשה שבוטלה אינה נאמרת ללקוח', () => {
  const db = store([
    vacation({ id: 'v1', name: 'בוטלה', date: '2026-09-25', end_date: '2026-10-03', status: 'cancelled' }),
    vacation({ id: 'v2', name: 'נמחקה', date: '2026-09-25', end_date: '2026-10-03', cancelled: true }),
  ]);
  assert.deepEqual(upcomingTrainingBreaks(db, { today: TODAY }), []);
});

test('יום בודד — יום התחלה בלי יום סיום', () => {
  const db = store([
    vacation({ id: 'v1', name: 'יום בחירות', date: '2026-10-27', end_date: null }),
  ]);
  const [row] = upcomingTrainingBreaks(db, { today: TODAY });
  assert.equal(row.from, row.to);
  assert.equal(row.days, 1);
});
