/**
 * A parent may pay for a climber outside their household only when that
 * climber is already cleared for wall participation. The payer relationship
 * must never be treated as permission to sign documents for somebody else's
 * child.
 */
export function participantPaymentAccess({ inPayerHousehold = false, wallEligible = false } = {}) {
  if (inPayerHousehold) return { allowed: true, kind: 'household' };
  if (wallEligible) return { allowed: true, kind: 'approved_guest' };
  return { allowed: false, kind: 'guest_documents_required' };
}
