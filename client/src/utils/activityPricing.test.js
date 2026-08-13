import test from 'node:test';
import assert from 'node:assert/strict';
import { displayedHostCharge, hostChargeBreakdown } from './activityPricing.js';

test('a late stale payment row cannot replace an unpaid live per-participant total', () => {
  const breakdown = hostChargeBreakdown({
    charge_basis: 'per_participant',
    price: 45,
    price_includes_vat: true,
    host_charge_participants: 15,
  });
  const stalePayment = {
    status: 'paid',
    entered_amount: 45,
    amount: 45,
  };

  assert.deepEqual(displayedHostCharge(breakdown, stalePayment, 'unpaid'), {
    entered: 675,
    gross: 675,
  });
});

test('a completed host payment keeps its recorded historical amount', () => {
  const breakdown = { entered: 675, gross: 675 };
  const payment = { entered_amount: 630, amount: 630 };
  assert.deepEqual(displayedHostCharge(breakdown, payment, 'paid'), {
    entered: 630,
    gross: 630,
  });
});
