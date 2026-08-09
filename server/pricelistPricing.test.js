import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorInUseBy,
  anchorUnitsOf,
  computeAnchoredPrice,
  dependentPriceUpdates,
  discountPercentFor,
  validateAnchorLink,
  withAnchoredPrice,
} from './pricelistPricing.js';

const entry = { id: 'pr_entry', name: 'כניסה לקיר', price: 70, is_price_anchor: true, product_type: 'product' };

const card = (over = {}) => ({
  id: 'pr_card', name: 'כרטיסייה 10', product_type: 'punch_card', visits_total: 10,
  price_anchor_id: 'pr_entry', anchor_discount_percent: 20, ...over,
});

test('מחיר כרטיסייה נגזר מהעוגן ומההנחה על הכמות', () => {
  assert.equal(computeAnchoredPrice(card(), entry), 560);
  assert.equal(computeAnchoredPrice(card({ anchor_discount_percent: 0 }), entry), 700);
  assert.equal(computeAnchoredPrice(card({ visits_total: 4, anchor_discount_percent: 50 }), entry), 140);
});

test('העלאת מחיר הכניסה מזיזה את הכרטיסייה באותו רגע', () => {
  assert.equal(computeAnchoredPrice(card(), { ...entry, price: 80 }), 640);
});

test('הנחה שלילית היא תוספת — אימון זוגי עולה יותר מאישי', () => {
  const coach = { id: 'pr_coach', name: 'אימון אישי', price: 150, is_price_anchor: true };
  const duo = { id: 'pr_duo', product_type: 'punch_card', visits_total: 5, price_anchor_id: 'pr_coach', anchor_discount_percent: -20 };
  assert.equal(computeAnchoredPrice(duo, coach), 900);
});

test('מנוי לזמן נמדד ביחידות שמוקלדות, ובלעדיהן אין מחיר נגזר', () => {
  const membership = { id: 'pr_m', product_type: 'time_membership', duration_days: 30, price_anchor_id: 'pr_entry' };
  assert.equal(anchorUnitsOf(membership), null);
  assert.equal(computeAnchoredPrice(membership, entry), null);
  assert.equal(computeAnchoredPrice({ ...membership, anchor_units: 5 }, entry), 350);
});

test('פריט בלי עוגן שומר על המחיר המוקלד', () => {
  const plain = { id: 'pr_x', name: 'קפה', price: 12, product_type: 'product' };
  assert.equal(computeAnchoredPrice(plain, entry), null);
  assert.equal(withAnchoredPrice(plain, entry).price, 12);
});

test('ההנחה הנגזרת משחזרת מחיר קיים בדיוק, בלי אגורה שנופלת', () => {
  for (const [price, units] of [[410, 10], [440, 10], [140, 4], [2, 8], [1, 10]]) {
    const percent = discountPercentFor(price, units, 70);
    assert.equal(computeAnchoredPrice(card({ visits_total: units, anchor_discount_percent: percent }), entry), price);
  }
});

test('רק פריטים שהמחיר שלהם באמת זז חוזרים לעדכון', () => {
  const items = [
    card({ id: 'a', anchor_discount_percent: 20 }),
    { id: 'b', product_type: 'punch_card', visits_total: 10, price: 700, price_anchor_id: 'pr_entry', anchor_discount_percent: 0 },
    { id: 'c', product_type: 'product', price: 12 },
  ];
  const updates = dependentPriceUpdates(items, entry);
  assert.deepEqual(updates.map((u) => [u.id, u.price]), [['a', 560]]);
});

test('עוגן שלא סומן, עוגן של עצמו ושרשרת עוגנים נחסמים', () => {
  assert.equal(validateAnchorLink(card(), entry), null);
  assert.match(validateAnchorLink(card(), { ...entry, is_price_anchor: false }), /אינו מסומן/);
  assert.match(validateAnchorLink(card({ id: 'pr_entry' }), entry), /העוגן של עצמו/);
  assert.match(validateAnchorLink(card(), { ...entry, price_anchor_id: 'pr_other' }), /לא יכול להישען/);
  assert.match(validateAnchorLink(card({ visits_total: null }), entry), /מספר כניסות/);
  assert.equal(validateAnchorLink({ id: 'x', price: 5 }, null), null);
});

test('יודעים מי נשען על עוגן לפני שמסירים ממנו את הסימון', () => {
  assert.equal(anchorInUseBy([card(), { id: 'z' }], 'pr_entry').length, 1);
  assert.equal(anchorInUseBy([card()], 'pr_other').length, 0);
});
