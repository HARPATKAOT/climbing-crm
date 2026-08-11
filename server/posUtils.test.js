import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProductType,
  buildPassFromItem,
  pickBestPunchCard,
  isPassUsable,
  computeSaleTotal,
  passDiscountNote,
  unitCapacity,
  PRODUCT_TYPES,
} from './posUtils.js';

test('normalizeProductType detects punch cards from categories', () => {
  assert.equal(
    normalizeProductType({ categories: ['כרטיסיה'] }),
    PRODUCT_TYPES.PUNCH_CARD
  );
  assert.equal(
    normalizeProductType({ categories: ['מנוי'] }),
    PRODUCT_TYPES.TIME_MEMBERSHIP
  );
  assert.equal(normalizeProductType({ name: 'מגנזיום' }), PRODUCT_TYPES.PRODUCT);
});

test('buildPassFromItem creates punch card with remaining visits', () => {
  const pass = buildPassFromItem({
    item: {
      id: 'p1',
      name: 'כרטיסייה 10',
      product_type: 'punch_card',
      visits_total: 10,
      validity_days: 365,
    },
    studentId: 's1',
    parentId: 'par1',
    saleId: 'sale1',
  });
  assert.equal(pass.pass_type, 'punch_card');
  assert.equal(pass.visits_total, 10);
  assert.equal(pass.visits_remaining, 10);
  assert.ok(pass.valid_until);
  assert.equal(pass.status, 'active');
});

test('a pass bought under a benefit records what was paid, not a renamed product', () => {
  const pass = buildPassFromItem({
    item: { id: 'p1', name: 'כרטיסייה 10', product_type: 'punch_card', visits_total: 10 },
    studentId: 's1',
    saleId: 'sale1',
    discount: { listPrice: 400, paidPrice: 200, couponCode: 'ABC123', couponLabel: '50% הנחה' },
  });
  // The product name stays clean; the benefit lives in its own fields.
  assert.equal(pass.name, 'כרטיסייה 10');
  assert.equal(pass.list_price, 400);
  assert.equal(pass.paid_price, 200);
  assert.equal(pass.coupon_code, 'ABC123');
  assert.equal(pass.coupon_label, '50% הנחה');
});

test('a pass sold at list price carries no benefit fields or note', () => {
  const pass = buildPassFromItem({
    item: { id: 'p1', name: 'כרטיסייה 10', product_type: 'punch_card', visits_total: 10 },
    studentId: 's1',
    saleId: 'sale1',
  });
  assert.equal(pass.coupon_code, null);
  assert.equal(pass.list_price, null);
  assert.equal(passDiscountNote(pass), '');
});

test('the benefit note spells out what was paid against the list price', () => {
  assert.equal(
    passDiscountNote({ coupon_label: '50% הנחה', list_price: 400, paid_price: 200 }),
    'נקנתה ב50% הנחה · שולם ₪200 במקום ₪400'
  );
  // No prices recorded — still say it was a benefit rather than stay silent.
  assert.equal(passDiscountNote({ coupon_label: 'כניסה חינם' }), 'נקנתה בכניסה חינם');
  assert.equal(passDiscountNote(null), '');
});

test('pickBestPunchCard prefers sooner expiry', () => {
  // Both cards must still be valid for "sooner" to mean anything. Written as
  // fixed dates, the nearer one eventually falls into the past and the test
  // starts asserting that an expired card should be picked — which is what it
  // began doing on 2026-08-02. Offsets from today keep the question the one
  // the test set out to ask.
  const inDays = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const best = pickBestPunchCard([
    {
      id: 'a',
      pass_type: 'punch_card',
      status: 'active',
      visits_remaining: 5,
      valid_until: inDays(500),
    },
    {
      id: 'b',
      pass_type: 'punch_card',
      status: 'active',
      visits_remaining: 8,
      valid_until: inDays(30),
    },
  ]);
  assert.equal(best.id, 'b');
});

test('isPassUsable rejects depleted cards', () => {
  assert.equal(
    isPassUsable({
      pass_type: 'punch_card',
      status: 'active',
      visits_remaining: 0,
    }),
    false
  );
});

test('computeSaleTotal sums lines', () => {
  assert.equal(
    computeSaleTotal([
      { unitprice: 50, quantity: 2 },
      { price: 100, quantity: 1 },
    ]),
    200
  );
});

test('מספר משתתפים במוצר הוא כמה אנשים יחידה אחת מכסה', () => {
  assert.equal(unitCapacity({ participants: '2' }), 2);
  assert.equal(unitCapacity({ participants: '1' }), 1);
  assert.equal(unitCapacity({ participants: '' }), 1);
  assert.equal(unitCapacity({}), 1);
  // טקסט חופשי שהוקלד בשדה לא הופך מוצר רגיל למוצר קבוצתי.
  assert.equal(unitCapacity({ participants: 'עד 2 מטפסים' }), 1);
  assert.equal(unitCapacity({ participants: '2 משתתפים' }), 2);
});
