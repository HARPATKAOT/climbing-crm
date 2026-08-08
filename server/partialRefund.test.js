import test from 'node:test';
import assert from 'node:assert/strict';
import { executePartialRefund } from './partialRefund.js';

function fakeIcount(overrides = {}) {
  const calls = { find: [], refund: [], doc: [] };
  return {
    calls,
    MIN_PARTIAL_REFUND: 1,
    findCcCharge: async (input) => {
      calls.find.push(input);
      return overrides.charge === undefined
        ? { ccBillLogId: '78979861', charged: 100, alreadyRefunded: false }
        : overrides.charge;
    },
    refundCcAmount: async (input) => {
      calls.refund.push(input);
      if (overrides.refundThrows) throw new Error(overrides.refundThrows);
      return { confirmationCode: '032763', refundType: 'partial', refundAmount: input.sum, remainingAmount: 0.17 };
    },
    createRefundDoc: async (input) => {
      calls.doc.push(input);
      if (overrides.docThrows) throw new Error(overrides.docThrows);
      return { docnum: '4200', docUrl: 'https://x/doc', docId: '1' };
    },
  };
}

const payment = { icount_doc_number: '4102', amount: 100, paid_at: '2026-08-08T10:22:00Z' };

test('מזכה לכרטיס ומוציא חשבונית זיכוי — שני הצדדים', async () => {
  const icount = fakeIcount();
  const result = await executePartialRefund({ icount, payment, amount: 60, clientName: 'דלק איל' });
  assert.equal(result.ok, true);
  assert.equal(icount.calls.refund[0].sum, 60);
  assert.equal(result.refund_doc_number, '4200');
  assert.equal(result.document_error, null);
});

test('מתחת לשקל נעצר לפני שנוגעים בכסף', async () => {
  const icount = fakeIcount();
  const result = await executePartialRefund({ icount, payment, amount: 0.5 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'below_min_refund');
  assert.equal(icount.calls.refund.length, 0);
});

test('מזהה חיוב שכבר שמור על התשלום חוסך את החיפוש ביומן', async () => {
  const icount = fakeIcount();
  await executePartialRefund({
    icount,
    payment: { ...payment, cc_bill_log_id: '999' },
    amount: 20,
    clientName: 'א',
  });
  assert.equal(icount.calls.find.length, 0);
  assert.equal(icount.calls.refund[0].ccBillLogId, '999');
});

test('חיוב שלא נמצא ביומן — נעצר, בלי לנחש', async () => {
  const icount = fakeIcount({ charge: null });
  const result = await executePartialRefund({ icount, payment, amount: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'charge_not_found');
  assert.equal(icount.calls.refund.length, 0);
});

test('חיוב שכבר זוכה אינו מזוכה שוב', async () => {
  const icount = fakeIcount({ charge: { ccBillLogId: '1', alreadyRefunded: true } });
  const result = await executePartialRefund({ icount, payment, amount: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'already_refunded');
  assert.equal(icount.calls.refund.length, 0);
});

test('כשל בהוצאת המסמך אינו מבטל את ההחזר — הוא מדווח', async () => {
  const icount = fakeIcount({ docThrows: 'iCount down' });
  const result = await executePartialRefund({ icount, payment, amount: 60, clientName: 'א' });
  assert.equal(result.ok, true);
  assert.equal(result.amount, 60);
  assert.match(result.document_error, /iCount down/);
});

test('כשל בהחזר לכרטיס לא מוציא מסמך על החזר שלא קרה', async () => {
  const icount = fakeIcount({ refundThrows: 'declined' });
  await assert.rejects(
    () => executePartialRefund({ icount, payment, amount: 60, clientName: 'א' }),
    /declined/
  );
  assert.equal(icount.calls.doc.length, 0);
});

test('תשלום בלי מספר מסמך נעצר מיד', async () => {
  const icount = fakeIcount();
  const result = await executePartialRefund({ icount, payment: { amount: 100 }, amount: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_doc');
});
