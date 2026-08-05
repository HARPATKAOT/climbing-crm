import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CANCELLATION_RULES, suggestedRefund } from './cancellationPolicies.js';

const snapshot = { rules: DEFAULT_CANCELLATION_RULES };
const start = '2026-09-10T10:00:00+03:00';

test('default cancellation bands use actual paid allocation', () => {
  assert.equal(suggestedRefund({ snapshot, paidAmount: 200, activityStartsAt: start, cancelledAt: '2026-09-01T10:00:00+03:00' }).amount, 150);
  assert.equal(suggestedRefund({ snapshot, paidAmount: 200, activityStartsAt: start, cancelledAt: '2026-09-05T10:00:00+03:00' }).amount, 100);
  assert.equal(suggestedRefund({ snapshot, paidAmount: 200, activityStartsAt: start, cancelledAt: '2026-09-09T10:00:00+03:00' }).amount, 0);
});

test('fixed fee is per cancelled participant and organizer cancellation is full', () => {
  assert.equal(suggestedRefund({ snapshot, paidAmount: 300, activityStartsAt: start, cancelledAt: '2026-09-01T10:00:00+03:00', participantsCancelled: 2 }).amount, 200);
  assert.equal(suggestedRefund({ snapshot, paidAmount: 177.5, activityStartsAt: start, organizerCancelled: true }).amount, 177.5);
});
