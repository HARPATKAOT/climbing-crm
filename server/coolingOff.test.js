/**
 * חלון ההתחרטות — הכלל היחיד שנמדד מרגע הרכישה ולא מרגע הפעילות.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedRefund, normalizeCoolingOffHours } from './cancellationPolicies.js';

const snapshot = {
  cooling_off_hours: 24,
  rules: [
    { id: 'seven_days', min_hours_before: 168, max_hours_before: null, refund_percent: 100, fixed_fee: 50 },
    { id: 'two_to_seven_days', min_hours_before: 48, max_hours_before: 168, refund_percent: 50, fixed_fee: 0 },
    { id: 'under_two_days', min_hours_before: 0, max_hours_before: 48, refund_percent: 0, fixed_fee: 0 },
  ],
};

const startsAt = new Date('2026-08-20T07:30:00Z');

test('קנה יומיים לפני והתחרט אחרי שעה — החזר מלא, לא 50%', () => {
  const purchasedAt = new Date('2026-08-18T10:00:00Z');
  const result = suggestedRefund({
    snapshot,
    paidAmount: 400,
    activityStartsAt: startsAt,
    purchasedAt,
    cancelledAt: new Date('2026-08-18T11:00:00Z'),
  });
  assert.equal(result.rule_id, 'cooling_off');
  assert.equal(result.amount, 400);
});

test('אותה רכישה, יומיים אחרי — חוזרים למדרגה הרגילה', () => {
  const result = suggestedRefund({
    snapshot,
    paidAmount: 400,
    activityStartsAt: startsAt,
    purchasedAt: new Date('2026-08-18T10:00:00Z'),
    cancelledAt: new Date('2026-08-19T12:00:00Z'),
  });
  assert.equal(result.rule_id, 'under_two_days');
  assert.equal(result.amount, 0);
});

test('חלון ההתחרטות אינו שורד את תחילת הפעילות', () => {
  // נקנה שש שעות לפני היציאה; הביטול אחרי שכבר יצאו
  const result = suggestedRefund({
    snapshot,
    paidAmount: 400,
    activityStartsAt: startsAt,
    purchasedAt: new Date('2026-08-20T01:30:00Z'),
    cancelledAt: new Date('2026-08-20T09:00:00Z'),
  });
  assert.notEqual(result.rule_id, 'cooling_off');
  assert.equal(result.amount, 0);
});

test('בלי מועד רכישה הכלל פשוט לא חל, ושאר המדרגות עובדות', () => {
  const result = suggestedRefund({
    snapshot,
    paidAmount: 400,
    activityStartsAt: startsAt,
    purchasedAt: null,
    cancelledAt: new Date('2026-08-12T07:30:00Z'),
  });
  assert.equal(result.rule_id, 'seven_days');
  assert.equal(result.amount, 350);
});

test('מדיניות בלי חלון התחרטות מתנהגת כמו קודם', () => {
  const result = suggestedRefund({
    snapshot: { ...snapshot, cooling_off_hours: 0 },
    paidAmount: 400,
    activityStartsAt: startsAt,
    purchasedAt: new Date('2026-08-18T10:00:00Z'),
    cancelledAt: new Date('2026-08-18T11:00:00Z'),
  });
  assert.equal(result.rule_id, 'under_two_days');
});

test('ביטול על ידינו גובר על הכול', () => {
  const result = suggestedRefund({
    snapshot,
    paidAmount: 400,
    activityStartsAt: startsAt,
    purchasedAt: new Date('2026-08-01T10:00:00Z'),
    cancelledAt: new Date('2026-08-19T23:00:00Z'),
    organizerCancelled: true,
  });
  assert.equal(result.rule_id, 'organizer_cancelled');
  assert.equal(result.amount, 400);
});

test('שעות לא חוקיות אינן מפילות את החישוב', () => {
  assert.equal(normalizeCoolingOffHours(''), 0);
  assert.equal(normalizeCoolingOffHours(-5), 0);
  assert.equal(normalizeCoolingOffHours('abc'), 0);
  assert.equal(normalizeCoolingOffHours(24), 24);
  assert.equal(normalizeCoolingOffHours(99999), 720);
});
