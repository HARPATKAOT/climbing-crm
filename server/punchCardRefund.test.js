/**
 * כרטיסייה שבוטלה באמצע.
 *
 * ההנחה בכרטיסייה ניתנת על ההתחייבות לכמות. מי שניצל חלק ממנה לא עמד
 * בהתחייבות, ולכן הכניסות שנוצלו מחויבות במחיר כניסה בודדת מלא — וההפרש חוזר.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedUsageRefund } from './cancellationPolicies.js';

/** כרטיסייה: מה שנוצל במחיר מלא (70 ₪ לכניסה), פחות 50 ₪ דמי ביטול. */
const snapshot = {
  basis: 'usage',
  cooling_off_hours: 24,
  usage_rule: {
    settlement: 'full_price',
    full_unit_price: 70,
    fixed_fee: 50,
    min_used_units: 0,
    no_refund_after_percent: 100,
  },
};

test('כרטיסיית 10 ב-550 ₪, נוצלו 5 — מחויב 350, מוחזרים 150', () => {
  const result = suggestedUsageRefund({
    snapshot, paidAmount: 550, totalUnits: 10, usedUnits: 5,
  });
  assert.equal(result.rule_id, 'used_at_full_price');
  assert.equal(result.charged_for_used, 350);
  assert.equal(result.amount, 150);
});

test('ההנחה לא נשמרת למי שניצל חלק — זה בדיוק ההבדל מיחסי', () => {
  const proRata = suggestedUsageRefund({
    snapshot: { ...snapshot, usage_rule: { settlement: 'pro_rata', unused_refund_percent: 100, fixed_fee: 50 } },
    paidAmount: 550, totalUnits: 10, usedUnits: 5,
  });
  // יחסי היה מחזיר 275 פחות 50 — כלומר שומר ללקוח את ההנחה על מה שצרך
  assert.equal(proRata.amount, 225);
  const fullPrice = suggestedUsageRefund({ snapshot, paidAmount: 550, totalUnits: 10, usedUnits: 5 });
  assert.ok(fullPrice.amount < proRata.amount);
});

test('ניצל כמעט הכול — ההחזר אפס, והלקוח לא נשאר חייב', () => {
  const result = suggestedUsageRefund({
    snapshot, paidAmount: 550, totalUnits: 10, usedUnits: 9,
  });
  // 9 × 70 = 630, יותר ממה ששולם
  assert.equal(result.amount, 0);
});

test('לא ניצל כלום ובתוך חלון ההתחרטות — החזר מלא בלי דמי ביטול', () => {
  const result = suggestedUsageRefund({
    snapshot,
    paidAmount: 550,
    totalUnits: 10,
    usedUnits: 0,
    purchasedAt: '2026-08-08T08:00:00Z',
    cancelledAt: new Date('2026-08-08T20:00:00Z'),
  });
  assert.equal(result.rule_id, 'cooling_off');
  assert.equal(result.amount, 550);
});

test('לא ניצל כלום אחרי החלון — משלם רק את דמי הביטול', () => {
  const result = suggestedUsageRefund({
    snapshot,
    paidAmount: 550,
    totalUnits: 10,
    usedUnits: 0,
    purchasedAt: '2026-08-01T08:00:00Z',
    cancelledAt: new Date('2026-08-08T20:00:00Z'),
  });
  assert.equal(result.amount, 500);
});

test('בלי מחיר יחידה מוגדר נופלים ליחסי במקום לזכות אפס', () => {
  const result = suggestedUsageRefund({
    snapshot: { ...snapshot, usage_rule: { settlement: 'full_price', full_unit_price: 0, fixed_fee: 0 } },
    paidAmount: 550, totalUnits: 10, usedUnits: 5,
  });
  assert.equal(result.rule_id, 'unused_portion');
  assert.equal(result.amount, 275);
});

test('ביטול על ידינו מחזיר הכול, בלי קשר לניצול', () => {
  const result = suggestedUsageRefund({
    snapshot, paidAmount: 550, totalUnits: 10, usedUnits: 7, organizerCancelled: true,
  });
  assert.equal(result.amount, 550);
});
