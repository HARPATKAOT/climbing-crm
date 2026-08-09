import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityDayList,
  singleDayEnabled,
  normalizeAttendingDates,
  registrationDays,
  registrationCoversDate,
  isPartialRegistration,
  participantPrice,
} from './activityDays.js';

/** קייטנה של חמישה ימים, 500 ₪ לכל האירוע או 120 ₪ ליום. */
const camp = (over = {}) => ({
  date: '2026-08-10',
  end_date: '2026-08-14',
  price: 500,
  single_day_price: 120,
  allow_single_day: true,
  ...over,
});

test('ימי האירוע נגזרים מהטווח, כולל שני הקצוות', () => {
  assert.deepEqual(activityDayList(camp()), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14',
  ]);
});

test('אירוע חד-יומי לא מציע ימים בודדים גם כשהדגל דלוק', () => {
  assert.equal(singleDayEnabled(camp({ end_date: null })), false);
  assert.equal(singleDayEnabled(camp({ end_date: '2026-08-10' })), false);
  assert.equal(singleDayEnabled(camp()), true);
});

test('דגל כבוי — כל בחירה נופלת לכל האירוע', () => {
  const off = camp({ allow_single_day: false });
  assert.equal(normalizeAttendingDates(off, ['2026-08-11']), null);
});

test('בחירה מנוקה, ממוינת ובלי כפילויות', () => {
  const result = normalizeAttendingDates(camp(), [
    '2026-08-13', '2026-08-11', '2026-08-11',
  ]);
  assert.deepEqual(result, ['2026-08-11', '2026-08-13']);
});

test('בחירה שמכסה את כל הימים נשמרת כ-null, כדי שיהיה ייצוג אחד ל„הכול”', () => {
  const all = activityDayList(camp());
  assert.equal(normalizeAttendingDates(camp(), all), null);
});

test('תאריך מחוץ לטווח מסונן, ובחירה שכולה מחוץ לטווח נכשלת', () => {
  assert.deepEqual(
    normalizeAttendingDates(camp(), ['2026-08-11', '2026-09-01']),
    ['2026-08-11']
  );
  assert.throws(
    () => normalizeAttendingDates(camp(), ['2026-09-01']),
    /אינם מימי האירוע/
  );
});

test('הרשמה בלי בחירה מכסה את כל הימים', () => {
  assert.equal(registrationDays(camp(), {}).length, 5);
  assert.equal(registrationDays(camp(), { attending_dates: null }).length, 5);
  assert.equal(isPartialRegistration(camp(), {}), false);
});

test('הרשמה חלקית מחזירה רק את ימיה', () => {
  const reg = { attending_dates: ['2026-08-11', '2026-08-12'] };
  assert.deepEqual(registrationDays(camp(), reg), ['2026-08-11', '2026-08-12']);
  assert.equal(isPartialRegistration(camp(), reg), true);
  assert.equal(registrationCoversDate(camp(), reg, '2026-08-11'), true);
  assert.equal(registrationCoversDate(camp(), reg, '2026-08-14'), false);
});

test('אירוע שהתאריכים שלו זזו אחרי ההרשמה — נופלים לכל הימים ולא לאפס', () => {
  const moved = camp({ date: '2026-09-01', end_date: '2026-09-05' });
  const reg = { attending_dates: ['2026-08-11'] };
  assert.equal(registrationDays(moved, reg).length, 5);
});

test('מחיר: אירוע מלא לפי price, חלקי לפי מחיר יום כפול הימים', () => {
  assert.equal(participantPrice(camp(), null), 500);
  assert.equal(participantPrice(camp(), ['2026-08-11', '2026-08-12']), 240);
  assert.equal(participantPrice(camp(), ['2026-08-11']), 120);
});
