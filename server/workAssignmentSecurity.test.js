import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMutateApprovedWorkAssignment,
  hasWorkPayOverride,
} from './workAssignmentSecurity.js';

test('operational shift edits cannot approve or override payroll', () => {
  assert.equal(hasWorkPayOverride({ hours: 4, notes: 'updated' }), false);
  assert.equal(hasWorkPayOverride({ approved: true }, { approved: false }), true);
  assert.equal(hasWorkPayOverride({ pay_amount: 500 }, { pay_amount: 400 }), true);
  assert.equal(hasWorkPayOverride({ approved: true }, { approved: true }), false);
});

test('approved payroll rows are immutable without HR access', () => {
  assert.equal(canMutateApprovedWorkAssignment({ approved: true }, false), false);
  assert.equal(canMutateApprovedWorkAssignment({ approved: true }, true), true);
  assert.equal(canMutateApprovedWorkAssignment({ approved: false }, false), true);
});
