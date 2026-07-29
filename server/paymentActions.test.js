import test from 'node:test';
import assert from 'node:assert/strict';
import {
  paymentOwner,
  paymentDocRefs,
  paymentHasCardCharge,
  checkPaymentRefundable,
  buildInvoiceWhatsAppText,
} from './paymentActions.js';

function fakeDb(tables = {}) {
  return {
    get: (table) => tables[table] || [],
    getOne: (table, id) =>
      (tables[table] || []).find((row) => String(row.id) === String(id)) || null,
    update: (table, id, patch) => {
      const rows = tables[table] || [];
      const idx = rows.findIndex((row) => String(row.id) === String(id));
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...patch };
      return rows[idx];
    },
  };
}

test('payment owner resolves counter sale, registration, host and standalone', () => {
  const db = fakeDb({
    pos_sales: [{ id: 'sale1' }],
    activities: [{ id: 'act1' }],
    activity_registrations: [{ id: 'reg1', activity_id: 'act1' }],
  });

  assert.equal(paymentOwner(db, { id: 'p1', pos_sale_id: 'sale1' }).kind, 'pos');
  assert.equal(
    paymentOwner(db, { id: 'p2', activity_registration_id: 'reg1' }).kind,
    'registration'
  );
  assert.equal(
    paymentOwner(db, { id: 'p3', activity_host_payment: true, activity_id: 'act1' }).kind,
    'host'
  );
  assert.equal(paymentOwner(db, { id: 'p4' }).kind, 'generic');
});

test('a missing linked row falls back to a standalone payment', () => {
  const db = fakeDb({ pos_sales: [] });
  assert.equal(paymentOwner(db, { id: 'p1', pos_sale_id: 'gone' }).kind, 'generic');
});

test('document refs fall back to the counter sale for older rows', () => {
  const db = fakeDb({
    pos_sales: [
      {
        id: 'sale1',
        icount_doc_number: '4080',
        icount_doctype: 'invrec',
        icount_doc_url: 'https://docs/4080.pdf',
        refund_doc_number: '4081',
      },
    ],
  });
  const refs = paymentDocRefs(db, { id: 'p1', pos_sale_id: 'sale1' });
  assert.equal(refs.charge.docnum, '4080');
  assert.equal(refs.charge.url, 'https://docs/4080.pdf');
  assert.equal(refs.refund.docnum, '4081');
});

test('the payment row wins over the sale when both carry a document', () => {
  const db = fakeDb({
    pos_sales: [{ id: 'sale1', icount_doc_number: '4080' }],
  });
  const refs = paymentDocRefs(db, {
    id: 'p1',
    pos_sale_id: 'sale1',
    icount_doc_number: '4099',
  });
  assert.equal(refs.charge.docnum, '4099');
});

test('a payment link counts as a card charge', () => {
  const db = fakeDb();
  assert.equal(paymentHasCardCharge(db, { id: 'p1', payment_url: 'https://pay' }), true);
  assert.equal(paymentHasCardCharge(db, { id: 'p2', cc_last4: '1234' }), true);
  assert.equal(paymentHasCardCharge(db, { id: 'p3', payment_method: 'cash' }), false);
});

test('refund is blocked for pending, already refunded and document-less payments', () => {
  const db = fakeDb();
  assert.equal(checkPaymentRefundable(db, { id: 'p1', status: 'pending' }).ok, false);
  assert.equal(checkPaymentRefundable(db, { id: 'p2', status: 'refunded' }).ok, false);

  const noDoc = checkPaymentRefundable(db, { id: 'p3', status: 'paid' });
  assert.equal(noDoc.ok, false);
  assert.equal(noDoc.code, 'missing_doc');

  const ok = checkPaymentRefundable(db, {
    id: 'p4',
    status: 'paid',
    icount_doc_number: '4080',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.refs.charge.docnum, '4080');
});

test('the invoice message keeps the document link intact', () => {
  const text = buildInvoiceWhatsAppText({
    businessName: 'הרפתקאות',
    parentName: 'דנה',
    description: 'כרטיסייה',
    amount: 450,
    docNumber: '4080',
    url: 'https://docs/4080.pdf',
  });
  assert.match(text, /דנה/);
  assert.match(text, /4080/);
  assert.match(text, /כרטיסייה/);
  assert.ok(text.includes('https://docs/4080.pdf'));
  assert.ok(text.endsWith('הרפתקאות'));
});

test('the refund message says it is a credit document', () => {
  const text = buildInvoiceWhatsAppText({
    parentName: 'דנה',
    url: 'https://docs/4081.pdf',
    kind: 'refund',
  });
  assert.match(text, /מסמך זיכוי/);
});
