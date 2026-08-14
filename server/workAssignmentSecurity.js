export const WORK_PAY_FIELDS = new Set([
  'pay_mode', 'flat_amount', 'pay_amount', 'pay_rate', 'rate', 'frozen_rate', 'wage_agreement_id',
  'pay_frozen_at', 'pay_locked_at', 'travel_amount', 'total_pay', 'approved',
]);

export function hasWorkPayOverride(body = {}, existing = {}) {
  return [...WORK_PAY_FIELDS].some((key) => (
    body[key] !== undefined && JSON.stringify(body[key]) !== JSON.stringify(existing?.[key])
  ));
}

export function canMutateApprovedWorkAssignment(existing, hasHrAccess) {
  return existing?.approved !== true || hasHrAccess === true;
}
