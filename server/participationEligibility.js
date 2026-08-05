import {
  declarationSignedAt,
  healthExpiryDate,
  isHealthDeclarationValid,
  isParticipationWaiverValid,
  participationWaiverExpiryDate,
} from './healthValidity.js';
import { normalizeParticipationScope } from './participationDocuments.js';

function approved(record) {
  return !!record && record.status !== 'rejected' && record.status !== 'cancelled' && (
    record.status === 'approved'
    || record.signed === true
    || !!record.signature_url
    || !!record.signatureUrl
  );
}

function newest(rows, readDate = declarationSignedAt) {
  return [...rows].sort((a, b) => String(readDate(b) || '').localeCompare(String(readDate(a) || '')))[0] || null;
}

function studentKey(record) {
  return String(record?.studentId || record?.student_id || '');
}

function waiverScope(record) {
  return normalizeParticipationScope(record?.scope || record?.templateSlug || record?.template_slug || 'wall');
}

export function activeHealthHold(db, studentId) {
  return newest((db.get('health_holds') || []).filter((hold) => (
    String(hold.student_id || hold.studentId || '') === String(studentId)
    && !hold.released_at
    && hold.status !== 'released'
  )), (hold) => hold.created_at);
}

/** Health is global: a complete declaration signed in any flow is the same health record. */
export function latestHealthDeclaration(db, studentId) {
  return newest((db.get('health_declarations') || []).filter((record) => (
    studentKey(record) === String(studentId)
    && approved(record)
    && !!declarationSignedAt(record)
  )));
}

/**
 * Prefer the split waiver table. Combined historical declarations remain a
 * read-only compatibility source until the authorised cleanup migration runs.
 */
export function latestParticipationWaiver(db, studentId, scope) {
  const wanted = normalizeParticipationScope(scope);
  const current = newest((db.get('participation_waivers') || []).filter((record) => (
    studentKey(record) === String(studentId)
    && waiverScope(record) === wanted
    && approved(record)
    && !!declarationSignedAt(record)
  )));
  if (current) return current;
  return newest((db.get('health_declarations') || []).filter((record) => (
    studentKey(record) === String(studentId)
    && waiverScope(record) === wanted
    && approved(record)
    && record.waiverAccepted === true
    && !!declarationSignedAt(record)
  )));
}

export function healthDocumentState(db, studentId, now = new Date()) {
  const hold = activeHealthHold(db, studentId);
  const record = latestHealthDeclaration(db, studentId);
  const signedAt = declarationSignedAt(record);
  if (hold) {
    return { state: 'blocked', record, hold, signed_at: signedAt, expires_at: healthExpiryDate(signedAt)?.toISOString() || null };
  }
  if (!record || !signedAt) return { state: 'missing', record: null, hold: null, signed_at: null, expires_at: null };
  return {
    state: isHealthDeclarationValid(signedAt, now) ? 'valid' : 'expired',
    record,
    hold: null,
    signed_at: signedAt,
    expires_at: healthExpiryDate(signedAt)?.toISOString() || null,
  };
}

export function waiverDocumentState(db, studentId, scope, now = new Date()) {
  const record = latestParticipationWaiver(db, studentId, scope);
  const signedAt = declarationSignedAt(record);
  if (!record || !signedAt) return { state: 'missing', record: null, signed_at: null, expires_at: null };
  return {
    state: isParticipationWaiverValid(signedAt, now) ? 'valid' : 'expired',
    record,
    signed_at: signedAt,
    expires_at: participationWaiverExpiryDate(signedAt)?.toISOString() || null,
  };
}

export function participationEligibility(db, { studentId, scope = 'wall', now = new Date() } = {}) {
  const normalizedScope = normalizeParticipationScope(scope);
  const health = healthDocumentState(db, studentId, now);
  const waiver = waiverDocumentState(db, studentId, normalizedScope, now);
  let status = 'eligible';
  if (health.state === 'blocked') status = 'blocked_health';
  else if (health.state !== 'valid' || waiver.state !== 'valid') status = 'awaiting_documents';
  return {
    student_id: studentId,
    scope: normalizedScope,
    status,
    eligible: status === 'eligible',
    health,
    waiver,
    missing: [
      ...(health.state === 'valid' ? [] : ['health']),
      ...(waiver.state === 'valid' ? [] : [`waiver:${normalizedScope}`]),
    ],
  };
}

export function eligibilityStatusForRegistration(eligibility, { profileComplete = true } = {}) {
  if (!profileComplete) return 'pending_profile';
  return eligibility?.status || 'awaiting_documents';
}
