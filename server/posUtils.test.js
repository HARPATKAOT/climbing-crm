import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProductType,
  buildPassFromItem,
  pickBestPunchCard,
  isPassUsable,
  computeSaleTotal,
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

test('pickBestPunchCard prefers sooner expiry', () => {
  const best = pickBestPunchCard([
    {
      id: 'a',
      pass_type: 'punch_card',
      status: 'active',
      visits_remaining: 5,
      valid_until: '2027-12-01',
    },
    {
      id: 'b',
      pass_type: 'punch_card',
      status: 'active',
      visits_remaining: 8,
      valid_until: '2026-08-01',
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
