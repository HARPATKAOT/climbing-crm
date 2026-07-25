import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRegistrationRefundPlan,
  findPaymentForRegistration,
  registrationsSharingPayment,
  summarizeHostPayment,
} from './activityRegistrationRefund.js';

function makeDb(store) {
  return {
    store,
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((row) => String(row.id) === String(id)) || null,
    update: (table, id, patch) => {
      const row = (store[table] || []).find((item) => String(item.id) === String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

test('buildRegistrationRefundPlan rejects unpaid registration', () => {
  const db = makeDb({
    activity_registrations: [
      { id: 'r1', activity_id: 'a1', payment_status: 'pending', status: 'pending_payment' },
    ],
    payments: [],
  });
  const plan = buildRegistrationRefundPlan(db, {
    activity: { id: 'a1' },
    registration: db.getOne('activity_registrations', 'r1'),
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'not_paid');
});

test('buildRegistrationRefundPlan detects shared payment for group order', () => {
  const db = makeDb({
    activity_registrations: [
      {
        id: 'r1',
        activity_id: 'a1',
        order_id: 'o1',
        payment_id: 'p1',
        payment_status: 'paid',
        status: 'confirmed',
        participant_name: 'ילד א',
      },
      {
        id: 'r2',
        activity_id: 'a1',
        order_id: 'o1',
        payment_id: 'p1',
        payment_status: 'paid',
        status: 'confirmed',
        participant_name: 'ילד ב',
      },
    ],
    activity_registration_orders: [
      { id: 'o1', activity_id: 'a1', payment_id: 'p1', payment_status: 'paid', status: 'confirmed' },
    ],
    payments: [
      {
        id: 'p1',
        amount: 200,
        status: 'paid',
        icount_doc_number: '1001',
        icount_doctype: 'invrec',
        activity_registration_order_id: 'o1',
      },
    ],
  });
  const plan = buildRegistrationRefundPlan(db, {
    activity: { id: 'a1' },
    registration: db.getOne('activity_registrations', 'r1'),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.sharedPayment, true);
  assert.equal(plan.affectedRegistrations.length, 2);
  assert.equal(plan.amount, 200);
  assert.deepEqual(plan.participantNames.sort(), ['ילד א', 'ילד ב'].sort());
});

test('findPaymentForRegistration falls back to order payment', () => {
  const db = makeDb({
    activity_registrations: [
      { id: 'r1', activity_id: 'a1', order_id: 'o1', payment_id: null, payment_status: 'paid' },
    ],
    activity_registration_orders: [{ id: 'o1', payment_id: 'p9' }],
    payments: [{ id: 'p9', amount: 50, status: 'paid', icount_doc_number: '9' }],
  });
  const payment = findPaymentForRegistration(db, db.getOne('activity_registrations', 'r1'));
  assert.equal(payment.id, 'p9');
  const shared = registrationsSharingPayment(db, payment, 'a1');
  assert.equal(shared.length, 1);
});

test('summarizeHostPayment exposes invoice fields for paid host', () => {
  const db = makeDb({
    payments: [{
      id: 'hp1',
      amount: 450,
      status: 'paid',
      paid_at: '2026-07-20T10:00:00.000Z',
      icount_doc_number: '555',
      icount_doctype: 'invrec',
      icount_doc_url: 'https://example.com/doc/555',
      activity_host_payment: true,
      activity_id: 'a1',
    }],
  });
  const summary = summarizeHostPayment(db, {
    id: 'a1',
    name: 'יום הולדת',
    price: 450,
    payment_status: 'paid',
    host_payment_id: 'hp1',
  });
  assert.equal(summary.refundable, true);
  assert.equal(summary.icount_doc_number, '555');
  assert.equal(summary.icount_doc_url, 'https://example.com/doc/555');
  assert.equal(summary.amount, 450);
});
