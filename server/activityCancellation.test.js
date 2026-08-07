import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeActivityCancellation,
  registrationsToRelease,
  activityIsCancelled,
} from './activityCancellation.js';

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

const activity = { id: 'a1', name: 'טיול לנקיק השחור', date: '2026-08-14' };

function paidRegistration(id, paymentId, name) {
  return {
    id,
    activity_id: 'a1',
    status: 'confirmed',
    payment_status: 'paid',
    payment_id: paymentId,
    participant_name: name,
  };
}

test('an activity nobody registered to is deletable', () => {
  const db = makeDb({ activity_registrations: [], payments: [] });
  const summary = summarizeActivityCancellation(db, activity);
  assert.equal(summary.deletable, true);
  assert.equal(summary.refund_total, 0);
});

test('a group order is one refund document, not one per participant', () => {
  const db = makeDb({
    activity_registrations: [
      paidRegistration('r1', 'p1', 'דנה'),
      paidRegistration('r2', 'p1', 'יואב'),
      paidRegistration('r3', 'p2', 'נועה'),
    ],
    payments: [
      { id: 'p1', status: 'paid', amount: 300, icount_doc_number: '1001', icount_doctype: 'invrec' },
      { id: 'p2', status: 'paid', amount: 150, icount_doc_number: '1002', icount_doctype: 'invrec' },
    ],
  });
  const summary = summarizeActivityCancellation(db, activity);
  assert.equal(summary.deletable, false);
  assert.equal(summary.registrations_count, 3);
  assert.equal(summary.refund_documents, 2);
  assert.equal(summary.paid_participants, 3);
  assert.equal(summary.refund_total, 450);
});

test('a paid registration with no billing document is reported, never silently refunded', () => {
  const db = makeDb({
    activity_registrations: [paidRegistration('r1', 'p1', 'דנה')],
    payments: [{ id: 'p1', status: 'paid', amount: 200 }],
  });
  const summary = summarizeActivityCancellation(db, activity);
  assert.equal(summary.refund_total, 0);
  assert.equal(summary.blocked.length, 1);
  assert.equal(summary.blocked[0].code, 'missing_doc');
  assert.deepEqual(registrationsToRelease(summary), ['r1']);
});

test('unpaid registrations are released without touching money', () => {
  const db = makeDb({
    activity_registrations: [
      { id: 'r1', activity_id: 'a1', status: 'confirmed', payment_status: 'pending', participant_name: 'דנה' },
    ],
    payments: [],
  });
  const summary = summarizeActivityCancellation(db, activity);
  assert.equal(summary.refund_total, 0);
  assert.equal(summary.unpaid.length, 1);
  assert.deepEqual(registrationsToRelease(summary), ['r1']);
});

test('a payment the policy would only partly refund is held back for manual handling', () => {
  const db = makeDb({
    activity_registrations: [paidRegistration('r1', 'p1', 'דנה')],
    payments: [
      { id: 'p1', status: 'paid', amount: 200, icount_doc_number: '1001', icount_doctype: 'invrec' },
    ],
  });
  const summary = summarizeActivityCancellation(db, activity, () => ({
    manual_partial_refund_required: true,
    recommendation: { amount: 150 },
  }));
  assert.equal(summary.refund_total, 0);
  assert.equal(summary.blocked.length, 1);
  assert.equal(summary.blocked[0].code, 'manual_partial_refund_required');
});

test('refunded registrations still block deletion — the rows would be orphaned', () => {
  const db = makeDb({
    activity_registrations: [
      {
        id: 'r1',
        activity_id: 'a1',
        status: 'cancelled',
        payment_status: 'refunded',
        participant_name: 'דנה',
      },
    ],
    payments: [],
  });
  const summary = summarizeActivityCancellation(db, { ...activity, status: 'cancelled' });
  assert.equal(summary.registrations_count, 0);
  assert.equal(summary.total_registrations, 1);
  assert.equal(summary.history_only, true);
  assert.equal(summary.deletable, false);
  assert.equal(summary.already_cancelled, true);
});

test('activityIsCancelled reads both the flag and the two spellings', () => {
  assert.equal(activityIsCancelled({ status: 'cancelled' }), true);
  assert.equal(activityIsCancelled({ status: 'canceled' }), true);
  assert.equal(activityIsCancelled({ cancelled: true }), true);
  assert.equal(activityIsCancelled({ status: 'open' }), false);
});
