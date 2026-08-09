import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CANCELLATION_RULES, resolvePolicyFor, suggestedRefund } from './cancellationPolicies.js';

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

test('products get a policy only when explicitly linked; activities keep the default fallback', () => {
  const policy = { id: 'cp_1', name: 'רגילה', status: 'published', is_default: true, current_version_id: 'cpv_1' };
  const version = { id: 'cpv_1', policy_id: 'cp_1', version_number: 1, status: 'published', rules: DEFAULT_CANCELLATION_RULES, free_text: '' };
  const db = {
    getOne: (table, rowId) => (table === 'cancellation_policies' && rowId === 'cp_1' ? policy : null),
    get: (table) => (table === 'cancellation_policies' ? [policy]
      : table === 'cancellation_policy_versions' ? [version] : []),
  };
  assert.equal(resolvePolicyFor(db, {}, { allowDefault: false }), null);
  assert.equal(resolvePolicyFor(db, {})?.policy.id, 'cp_1');
  assert.equal(resolvePolicyFor(db, { cancellation_policy_id: 'cp_1' }, { allowDefault: false })?.policy.id, 'cp_1');
  assert.equal(resolvePolicyFor(db, { cancellation_policy_disabled: true, cancellation_policy_id: 'cp_1' }, { allowDefault: false }), null);
});
