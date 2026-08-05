/**
 * Resolve the person behind a public participation form without exposing a
 * customer file on a weak match. The caller must verify possession of `phone`
 * with OTP before using a `found` result to return personal information.
 */

export function normalizeIdentityPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 9) digits = `972${digits.slice(1)}`;
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  return digits;
}

export function normalizeIdentityNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function uniqueMatches(rows, predicate) {
  return (rows || []).filter(predicate);
}

/**
 * @returns {{status:'found'|'new'|'review_required'|'incomplete', parent?:object, reason?:string}}
 */
export function resolvePublicIdentity(parents = [], { phone, idNumber, hintedParentId = '' } = {}) {
  const phoneKey = normalizeIdentityPhone(phone);
  const idKey = normalizeIdentityNumber(idNumber);
  if (phoneKey.length < 11 || idKey.length < 5) {
    return { status: 'incomplete', reason: 'phone_and_id_required' };
  }

  const phoneMatches = uniqueMatches(parents, (parent) => (
    normalizeIdentityPhone(parent?.phone) === phoneKey
  ));
  const idMatches = uniqueMatches(parents, (parent) => (
    normalizeIdentityNumber(parent?.idNumber || parent?.parentIdNum) === idKey
  ));

  if (phoneMatches.length > 1 || idMatches.length > 1) {
    return { status: 'review_required', reason: 'ambiguous_match' };
  }

  const byPhone = phoneMatches[0] || null;
  const byId = idMatches[0] || null;
  if (byPhone && byId && String(byPhone.id) !== String(byId.id)) {
    return { status: 'review_required', reason: 'conflicting_identifiers' };
  }

  const parent = byPhone || byId;
  if (!parent) return { status: 'new' };

  // A legacy card may have no ID yet. OTP on its exact phone plus the supplied
  // ID is enough to recognise it; the successful submission fills the missing
  // identifier. The reverse is intentionally not automatic: knowing an ID and
  // proving possession of a different phone must not reveal or take over a file.
  if (byPhone && !byId) {
    const storedId = normalizeIdentityNumber(byPhone.idNumber || byPhone.parentIdNum);
    if (storedId && storedId !== idKey) {
      return { status: 'review_required', reason: 'phone_id_mismatch' };
    }
  }
  if (byId && !byPhone) {
    return { status: 'review_required', reason: 'id_phone_mismatch' };
  }
  if (hintedParentId && String(parent.id) !== String(hintedParentId)) {
    return { status: 'review_required', reason: 'link_identity_mismatch' };
  }
  return { status: 'found', parent };
}
