import test from 'node:test';
import assert from 'node:assert/strict';
import { rentalUsage, equipmentRefundRecommendation } from './equipmentRefund.js';

/** מדיניות ציוד: כל מה שלא נוצל חוזר, פחות 50 ₪ דמי ביטול. */
const snapshot = {
  basis: 'usage',
  cooling_off_hours: 24,
  usage_rule: {
    unused_refund_percent: 100,
    fixed_fee: 50,
    min_used_units: 0,
    no_refund_after_percent: 100,
  },
};

test('הדוגמה של בעל העסק: נותרו חודשיים מתוך חמישה, ערכם 60 — מוחזרים 10', () => {
  // חמישה חודשים, שולם 150; בנקודה שבה נותרו שתי חמישיות ערכן 60
  const pricing = {
    total_units: 5,
    half_start: '2026-01-01',
    half_end: '2026-06-01',
  };
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: { amount: 150, paid_at: '2026-01-01T00:00:00Z' },
    pricing,
    refDate: new Date('2026-04-01T00:00:00Z'),
  });
  assert.equal(result.remaining_units, 2);
  assert.equal(result.amount, 10);
  assert.equal(result.fixed_fee, 50);
});

test('נותר מעט — דמי הביטול לא הופכים את ההחזר לשלילי', () => {
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: { amount: 150, paid_at: '2026-01-01T00:00:00Z' },
    pricing: { total_units: 5, half_start: '2026-01-01', half_end: '2026-06-01' },
    refDate: new Date('2026-05-20T00:00:00Z'),
  });
  assert.equal(result.amount, 0);
});

test('ביטול באותו יום, לפני שנוצל דבר — החזר מלא בלי דמי ביטול', () => {
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: { amount: 150, paid_at: '2026-01-01T08:00:00Z' },
    pricing: { total_units: 5, half_start: '2026-01-01', half_end: '2026-06-01' },
    refDate: new Date('2026-01-01T10:00:00Z'),
  });
  assert.equal(result.rule_id, 'cooling_off');
  assert.equal(result.amount, 150);
});

test('בלי תאריכי תקופה — מסומן שלא נפתר, ולא מוצג סכום כאילו הוא ודאי', () => {
  const usage = rentalUsage({ pricing: { total_units: 5 } });
  assert.equal(usage.resolved, false);
  assert.equal(usage.usedUnits, 5);

  const result = equipmentRefundRecommendation({
    snapshot,
    payment: { amount: 150 },
    pricing: { total_units: 5 },
  });
  assert.equal(result.period_resolved, false);
  assert.equal(result.amount, 0);
});

test('התקופה נגמרה — אין מה להחזיר', () => {
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: { amount: 150, paid_at: '2026-01-01T00:00:00Z' },
    pricing: { total_units: 5, half_start: '2026-01-01', half_end: '2026-06-01' },
    refDate: new Date('2026-07-01T00:00:00Z'),
  });
  assert.equal(result.remaining_units, 0);
  assert.equal(result.amount, 0);
});
