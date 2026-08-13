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
    // Before health and participation were split into two tables, a trip form
    // was stored as one accepted declaration. Its health answers are still a
    // valid global health declaration even though its waiver only covers the
    // trip. Keep that historical evidence readable by the wall checkout.
    || record.waiverAccepted === true
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

function normalizedIdentityName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('he')
    .replace(/[׳״'’`]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizedPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `972${digits.slice(1)}`;
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  return digits;
}

/**
 * An adult can have an old trainee card under a parent and a newer self-signer
 * card created from their own phone. Treat those as the same person's health
 * record only when name + birth date + phone agree; the scoped waivers remain
 * attached to the exact card that signed them.
 */
function healthStudentKeys(db, studentId) {
  const students = db.get('students') || [];
  const parents = db.get('parents') || [];
  const target = db.getOne?.('students', studentId)
    || students.find((row) => String(row.id) === String(studentId));
  if (!target?.birthDate || !normalizedIdentityName(target.name)) return [String(studentId)];
  const targetParent = parents.find((row) => String(row.id) === String(target.parentId || ''));
  const targetPhones = new Set(
    [target.phone, targetParent?.phone].map(normalizedPhone).filter(Boolean)
  );
  const aliases = students.filter((candidate) => {
    if (String(candidate.id) === String(studentId)) return true;
    if (String(candidate.birthDate || '') !== String(target.birthDate || '')) return false;
    if (normalizedIdentityName(candidate.name) !== normalizedIdentityName(target.name)) return false;
    const candidateParent = parents.find((row) => String(row.id) === String(candidate.parentId || ''));
    const candidatePhones = [candidate.phone, candidateParent?.phone]
      .map(normalizedPhone)
      .filter(Boolean);
    return candidatePhones.some((phone) => targetPhones.has(phone));
  });
  return aliases.length > 1 ? aliases.map((row) => String(row.id)) : [String(studentId)];
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
  const studentIds = new Set(healthStudentKeys(db, studentId));
  return newest((db.get('health_declarations') || []).filter((record) => (
    studentIds.has(studentKey(record))
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
  let record = latestHealthDeclaration(db, studentId);
  // Older combined forms stamped the canonical student card before durable
  // health-declaration rows existed. The previous checkout respected this
  // field; dropping it during the document split made those customers appear
  // to have no health declaration at all.
  if (!record) {
    const student = db.getOne?.('students', studentId)
      || (db.get('students') || []).find((row) => String(row.id) === String(studentId));
    if (student?.healthSignedAt) {
      record = {
        id: null,
        studentId: student.id,
        signedDate: student.healthSignedAt,
        source: 'legacy_student_card',
      };
    }
  }
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
