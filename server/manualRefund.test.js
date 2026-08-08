import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateManualRefund,
  isPolicyException,
  manualRefundMarks,
} from './manualRefund.js';

test('סכום תקין עובר', () => {
  const result = validateManualRefund({ amount: 200, paidAmount: 550, reason: 'סוכם טלפונית' });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 200);
});

test('אי אפשר להחזיר יותר ממה ששולם', () => {
  const result = validateManualRefund({ amount: 900, paidAmount: 550, reason: 'טעות' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'exceeds_paid');
});

test('מתחת לשקל נדחה — מגבלת הסולק', () => {
  const result = validateManualRefund({ amount: 0.5, paidAmount: 550, reason: 'טעות' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'below_min_refund');
});

test('אפס ומספר שלילי נדחים', () => {
  assert.equal(validateManualRefund({ amount: 0, paidAmount: 550, reason: 'x' }).ok, false);
  assert.equal(validateManualRefund({ amount: -50, paidAmount: 550, reason: 'x' }).ok, false);
});

test('בלי סיבה אין זיכוי ידני', () => {
  const result = validateManualRefund({ amount: 200, paidAmount: 550, reason: '   ' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'reason_required');
});

test('חריגה ממדיניות מזוהה, והתאמה לה אינה חריגה', () => {
  assert.equal(isPolicyException(200, 150), true);
  assert.equal(isPolicyException(150, 150), false);
  // בלי המלצה בכלל — כל סכום הוא חריגה, כי אין למה להשוות
  assert.equal(isPolicyException(150, null), true);
});

test('הסימון על התשלום מתעד מה המדיניות אמרה, מה נעשה ומי אישר', () => {
  const marks = manualRefundMarks({
    amount: 200,
    reason: 'סוכם טלפונית',
    recommended: 150,
    approvedBy: 'boaz@example.com',
    result: { refund_doc_number: '4210', ccBillLogId: '789' },
    now: '2026-08-08T12:00:00Z',
  });
  assert.equal(marks.refund_amount, 200);
  assert.equal(marks.refund_recommended_amount, 150);
  assert.equal(marks.refund_policy_exception, true);
  assert.equal(marks.refunded_by, 'boaz@example.com');
  assert.equal(marks.refund_manual, true);
  assert.equal(marks.status, 'refunded');
});

test('זיכוי ידני שתואם להמלצה אינו מסומן כחריגה', () => {
  const marks = manualRefundMarks({ amount: 150, reason: 'x', recommended: 150 });
  assert.equal(marks.refund_policy_exception, false);
  assert.equal(marks.refund_manual, true);
});
