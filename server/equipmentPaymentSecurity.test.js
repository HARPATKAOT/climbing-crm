import test from 'node:test';
import assert from 'node:assert/strict';
import { canClearPaidEquipmentStatus } from './equipmentPaymentSecurity.js';

test('equipment staff cannot erase a recorded payment', () => {
  assert.equal(canClearPaidEquipmentStatus('paid', 'unpaid', false), false);
  assert.equal(canClearPaidEquipmentStatus('paid', 'unpaid', true), true);
  assert.equal(canClearPaidEquipmentStatus('own', 'unpaid', false), true);
  assert.equal(canClearPaidEquipmentStatus('paid', 'paid', false), true);
});
