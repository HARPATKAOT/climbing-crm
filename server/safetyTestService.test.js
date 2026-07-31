import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextSafetyReset,
  safetyTestExpiry,
  safetyTestStatus,
} from './safetyTestService.js';

const secTest = (date, extra = {}) => ({
  test_type: 'security',
  test_date: date,
  passed: true,
  examiner: 'בועז',
  ...extra,
});

test('מבחן תקף חצי שנה כשהחצי שנה נגמר לפני 31 באוגוסט', () => {
  assert.equal(safetyTestExpiry('2026-10-01').toISOString().slice(0, 10), '2027-04-01');
});

test('התוקף מתאפס ב-31 באוגוסט גם כשלא עברו חצי שנה', () => {
  // מבחן ביוני — חצי שנה היו דצמבר, אבל האיפוס קודם.
  assert.equal(safetyTestExpiry('2027-06-01').toISOString().slice(0, 10), '2027-08-31');
});

test('מבחן ב-31 באוגוסט תקף עד השנה הבאה, לא מתאפס מיד', () => {
  assert.equal(nextSafetyReset('2026-08-31').toISOString().slice(0, 10), '2027-08-31');
  // חצי שנה קדימה (28.2) מוקדם מהאיפוס הבא, ולכן הוא הקובע.
  assert.equal(safetyTestExpiry('2026-08-31').toISOString().slice(0, 10), '2027-02-28');
});

test('בלי מבחן — חסר', () => {
  const status = safetyTestStatus([], '2026-10-01');
  assert.equal(status.state, 'missing');
  assert.equal(status.expires_at, null);
});

test('מבחן טרי — תקף, עם תאריך תפוגה וימים שנותרו', () => {
  const status = safetyTestStatus([secTest('2026-10-01')], '2026-11-01');
  assert.equal(status.state, 'valid');
  assert.equal(status.expires_at, '2027-04-01');
  assert.equal(status.days_left, 151);
  assert.equal(status.examiner, 'בועז');
});

test('אחרי 31 באוגוסט כולם פגי תוקף', () => {
  const status = safetyTestStatus([secTest('2027-06-01')], '2027-09-01');
  assert.equal(status.state, 'expired');
  assert.equal(status.expires_at, '2027-08-31');
});

test('מבחן שנכשל אינו מקנה תוקף', () => {
  const status = safetyTestStatus([secTest('2026-10-01', { passed: false })], '2026-11-01');
  assert.equal(status.state, 'missing');
});

test('מבחן רמה אינו מבחן אבטחה', () => {
  const status = safetyTestStatus(
    [secTest('2026-10-01', { test_type: 'level' })],
    '2026-11-01'
  );
  assert.equal(status.state, 'missing');
});

test('נלקח המבחן האחרון כשיש כמה', () => {
  const status = safetyTestStatus(
    [secTest('2026-10-01'), secTest('2026-12-20'), secTest('2026-11-05')],
    '2027-01-01'
  );
  assert.equal(status.test_date, '2026-12-20');
  assert.equal(status.state, 'valid');
});
