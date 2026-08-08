import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rentalUsage,
  shoesPortionOf,
  equipmentRefundRecommendation,
} from './equipmentRefund.js';

/** מדיניות הציוד: כל מה שלא נוצל חוזר, פחות 50 ₪ דמי ביטול. */
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

/** תשלום ציוד אמיתי: נעליים + חולצה, חצי עונה 1.9–14.2. */
function payment({ shoes = 150, shirt = 120, charged = null } = {}) {
  const subtotal = shoes + shirt;
  return {
    equipment_checkout_token: 'chk1',
    amount: charged ?? subtotal,
    paid_at: '2026-09-01T00:00:00Z',
    equipment_allocations: [{
      student_name: 'ילד',
      item_types: ['shoes', 'shirt'],
      shoes_amount: shoes,
      rental_starts_at: '2026-09-01',
      rental_ends_at: '2027-02-14',
      subtotal,
      charge_amount: charged ?? subtotal,
    }],
  };
}

test('רק הנעליים נכנסות לחישוב — החולצה אינה השכרה', () => {
  const shoes = shoesPortionOf(payment());
  assert.equal(shoes.amount, 150);
  assert.equal(shoes.has_shoes, true);
});

test('הנחת משפחה ומע״מ חלים על חלק הנעליים באותו יחס', () => {
  // שולם 243 מתוך מחירון 270 — 90%
  const shoes = shoesPortionOf(payment({ charged: 243 }));
  assert.equal(shoes.amount, 135);
});

test('תשלום ציוד בלי נעליים — אין מה לזכות לפי המדיניות הזו', () => {
  const withoutShoes = {
    equipment_checkout_token: 'chk1',
    amount: 120,
    equipment_allocations: [{ item_types: ['shirt'], shoes_amount: null, subtotal: 120, charge_amount: 120 }],
  };
  const result = equipmentRefundRecommendation({ snapshot, payment: withoutShoes });
  assert.equal(result.has_shoes, false);
  assert.equal(result.period_resolved, false);
});

test('הצטרף בספטמבר ועזב באוקטובר — ההחזר מחושב על הנעליים בלבד', () => {
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: payment(),
    refDate: new Date('2026-10-01T00:00:00Z'),
  });
  assert.equal(result.shoes_amount, 150);
  assert.equal(result.total_units, 5.5);
  assert.equal(result.used_units, 1);
  assert.equal(result.remaining_units, 4.5);
  // 150 × (4.5/5.5) = 122.73, פחות 50
  assert.equal(result.amount, 72.73);
});

test('ביטול באותו יום — החזר מלא על הנעליים, בלי דמי ביטול', () => {
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: payment(),
    refDate: new Date('2026-09-01T10:00:00Z'),
  });
  assert.equal(result.rule_id, 'cooling_off');
  assert.equal(result.amount, 150);
});

test('התקופה נגמרה — אין מה להחזיר', () => {
  const result = equipmentRefundRecommendation({
    snapshot,
    payment: payment(),
    refDate: new Date('2027-03-01T00:00:00Z'),
  });
  assert.equal(result.remaining_units, 0);
  assert.equal(result.amount, 0);
});

test('בלי חלון השכרה — מסומן שלא נפתר, בלי להציג סכום מנוחש', () => {
  const usage = rentalUsage({ startsAt: null, endsAt: null });
  assert.equal(usage.resolved, false);

  const broken = {
    equipment_checkout_token: 'chk1',
    amount: 150,
    equipment_allocations: [{ shoes_amount: 150, subtotal: 150, charge_amount: 150 }],
  };
  const result = equipmentRefundRecommendation({ snapshot, payment: broken });
  assert.equal(result.period_resolved, false);
});
