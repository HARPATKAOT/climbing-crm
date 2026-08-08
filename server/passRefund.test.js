import test from 'node:test';
import assert from 'node:assert/strict';
import {
  passUsage,
  passPaidAmount,
  passRefundRecommendation,
  saleRefundPlan,
  passesOfSale,
} from './passRefund.js';

/** מדיניות הכרטיסיות: הנוצל ב-70 ₪ לכניסה, היתרה חוזרת, בלי דמי ביטול. */
const snapshot = {
  basis: 'usage',
  cooling_off_hours: 24,
  usage_rule: {
    settlement: 'full_price',
    full_unit_price: 70,
    unused_refund_percent: 100,
    fixed_fee: 0,
    min_used_units: 0,
    no_refund_after_percent: 100,
  },
};

const card = (over = {}) => ({
  id: 'ps1', sale_id: 's1', status: 'active', pass_type: 'punch_card',
  name: 'כרטיסייה', visits_total: 10, visits_remaining: 5,
  list_price: 700, paid_price: 550, created_at: '2026-08-01T08:00:00Z',
  ...over,
});

test('ניצול נקרא מהכרטיס — 10 סה״כ, 5 נותרו, 5 נוצלו', () => {
  const usage = passUsage(card());
  assert.equal(usage.totalUnits, 10);
  assert.equal(usage.usedUnits, 5);
  assert.equal(usage.unit, 'visits');
});

test('מזוכה מה ששולם על הכרטיס, לא מחיר המחירון', () => {
  assert.equal(passPaidAmount(card()), 550);
});

test('כרטיסייה 550 ₪, נוצלו 5 — מחויב 350, מוחזרים 200', () => {
  const result = passRefundRecommendation({
    snapshot, pass: card(), payment: { paid_at: '2026-08-01T08:00:00Z' },
    refDate: new Date('2026-08-20T00:00:00Z'),
  });
  assert.equal(result.rule_id, 'used_at_full_price');
  assert.equal(result.charged_for_used, 350);
  assert.equal(result.amount, 200);
});

test('לא נוצלה אף כניסה, בתוך החלון — החזר מלא', () => {
  const result = passRefundRecommendation({
    snapshot,
    pass: card({ visits_remaining: 10 }),
    payment: { paid_at: '2026-08-01T08:00:00Z' },
    refDate: new Date('2026-08-01T20:00:00Z'),
  });
  assert.equal(result.rule_id, 'cooling_off');
  assert.equal(result.amount, 550);
});

test('נוצלו 9 — המחיר המלא עולה על ששולם, וההחזר אפס ולא שלילי', () => {
  const result = passRefundRecommendation({
    snapshot, pass: card({ visits_remaining: 1 }),
    refDate: new Date('2026-08-20T00:00:00Z'),
  });
  assert.equal(result.amount, 0);
});

test('מנוי לזמן נמדד בימים ומיושב יחסית, גם כשהמדיניות אומרת מחיר מלא', () => {
  const membership = card({
    pass_type: 'time_membership', visits_total: null, visits_remaining: null,
    valid_from: '2026-08-01', valid_until: '2026-08-31', paid_price: 300,
  });
  const usage = passUsage(membership, new Date('2026-08-16T00:00:00Z'));
  assert.equal(usage.unit, 'days');
  assert.equal(usage.totalUnits, 30);
  assert.equal(usage.usedUnits, 15);

  const result = passRefundRecommendation({
    snapshot, pass: membership, refDate: new Date('2026-08-16T00:00:00Z'),
  });
  // חצי התקופה נותרה — 150, ולא חיוב של 15 ימים במחיר כניסה לקיר
  assert.equal(result.rule_id, 'unused_portion');
  assert.equal(result.amount, 150);
});

test('כרטיס שכבר בוטל אינו נכלל במכירה', () => {
  const passes = [card(), card({ id: 'ps2', status: 'void' })];
  assert.equal(passesOfSale(passes, 's1').length, 1);
});

test('מכירה עם שני כרטיסים — הסכום הכולל הוא סכום ההחזרים', () => {
  const plan = saleRefundPlan({
    snapshot,
    passes: [card(), card({ id: 'ps2', visits_remaining: 10, paid_price: 140, visits_total: 4 })],
    refDate: new Date('2026-08-20T00:00:00Z'),
  });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.total, 340);
  assert.equal(plan.resolved, true);
});

test('כרטיס בלי מחיר ובלי יחידות מסומן כלא פתור, ולא מזכה סכום מנוחש', () => {
  const broken = card({ visits_total: null, visits_remaining: null, list_price: null, paid_price: null });
  const result = passRefundRecommendation({ snapshot, pass: broken });
  assert.equal(result.period_resolved, false);
});
