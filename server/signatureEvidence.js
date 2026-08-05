import crypto from 'crypto';

const FALLBACK_EVIDENCE_KEY = crypto.randomBytes(32);

function evidenceKey() {
  const source = process.env.EVIDENCE_SIGNING_SECRET
    || process.env.OTP_TOKEN_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.META_WA_ACCESS_TOKEN
    || '';
  if (!source) return { key: FALLBACK_EVIDENCE_KEY, strength: 'process_ephemeral' };
  return {
    key: crypto.createHmac('sha256', 'crm.signature-evidence.v1').update(source).digest(),
    strength: process.env.EVIDENCE_SIGNING_SECRET ? 'dedicated_secret' : 'derived_server_secret',
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])])
    );
  }
  return value === undefined ? null : value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''));
  return crypto.createHash('sha256').update(input).digest('hex');
}

function sealPayload(payloadHash) {
  const { key, strength } = evidenceKey();
  return {
    seal: crypto.createHmac('sha256', key).update(payloadHash).digest('hex'),
    keyId: sha256(key).slice(0, 16),
    sealStrength: strength,
  };
}

/** Create a tamper-evident event. The raw OTP code/token is never included. */
export function createSignatureEvidenceEvent({
  eventType = 'document_signed',
  documentType,
  documentId,
  signer = {},
  participant = {},
  signingCapacity = 'self',
  relationship = '',
  occurredAt = new Date().toISOString(),
  contentSnapshot = {},
  signature = '',
  phoneVerification = null,
  requestContext = null,
  clientTimeline = null,
  source = 'public_form',
  activityId = null,
  orderId = null,
  fileHash = null,
  priorEvidenceId = null,
} = {}) {
  const id = `se_${crypto.randomUUID()}`;
  const contentHash = sha256(canonicalJson(contentSnapshot));
  const signatureHash = signature ? sha256(signature) : null;
  const payload = {
    schemaVersion: 2,
    eventId: id,
    eventType,
    document: { type: documentType || '', id: documentId || '' },
    signer,
    participant,
    signingCapacity,
    relationship: relationship || null,
    occurredAt,
    source,
    activityId: activityId || null,
    orderId: orderId || null,
    phoneVerification: phoneVerification || null,
    requestContext: requestContext || null,
    clientTimeline: clientTimeline || null,
    // The append-only journal must be able to stand on its own. A hash proves
    // that a supplied snapshot is unchanged, but it cannot reconstruct what
    // was signed after a display row or generated PDF is removed. Preserve the
    // exact canonical snapshot and signature artifact alongside their hashes.
    signedContent: canonicalValue(contentSnapshot),
    signatureArtifact: signature || null,
    contentHash,
    signatureHash,
    fileHash: fileHash || null,
    priorEvidenceId: priorEvidenceId || null,
  };
  const payloadHash = sha256(canonicalJson(payload));
  const sealed = sealPayload(payloadHash);
  return {
    id,
    event_type: eventType,
    document_type: documentType || '',
    document_id: documentId || '',
    signer_parent_id: signer.parentId || null,
    student_id: participant.studentId || null,
    occurred_at: occurredAt,
    payload,
    payload_hash: payloadHash,
    seal: sealed.seal,
    key_id: sealed.keyId,
    seal_strength: sealed.sealStrength,
    created_at: occurredAt,
  };
}

export function evidenceReference(event) {
  return event ? {
    id: event.id,
    schemaVersion: event.payload?.schemaVersion || 1,
    contentHash: event.payload?.contentHash || null,
    signatureHash: event.payload?.signatureHash || null,
    payloadHash: event.payload_hash,
    seal: event.seal,
    keyId: event.key_id,
    sealStrength: event.seal_strength,
  } : null;
}

export async function appendSignatureEvidence(db, event) {
  if (!db?.appendOnly) {
    throw Object.assign(new Error('יומן ראיות החתימה אינו זמין'), { status: 503 });
  }
  const result = await db.appendOnly('signature_evidence', event);
  if (!result?.ok) {
    throw Object.assign(new Error(result?.error || 'שמירת ראיות החתימה נכשלה'), { status: 503 });
  }
  return result.record || event;
}

export function verifySignatureEvidenceEvent(event) {
  if (!event?.payload || !event?.payload_hash || !event?.seal) return false;
  const payloadHash = sha256(canonicalJson(event.payload));
  if (payloadHash !== event.payload_hash) return false;
  const sealed = sealPayload(payloadHash);
  return sealed.keyId === event.key_id && sealed.seal === event.seal;
}

/** Supporting transport facts; OTP + content seal remain the primary evidence. */
export function requestEvidence(req, requestId = crypto.randomUUID()) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const remoteAddress = String(req?.socket?.remoteAddress || req?.ip || '').slice(0, 120);
  return {
    requestId,
    serverReceivedAt: new Date().toISOString(),
    ipAddress: (forwarded || remoteAddress).slice(0, 120) || null,
    remoteAddress: remoteAddress || null,
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 500) || null,
    acceptLanguage: String(req?.headers?.['accept-language'] || '').slice(0, 160) || null,
  };
}
