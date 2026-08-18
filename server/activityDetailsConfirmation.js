import crypto from 'crypto';
import {
  appendSignatureEvidence,
  createSignatureEvidenceEvent,
  evidenceReference,
} from './signatureEvidence.js';

/**
 * אישור פרטי פעילות — טופס נפרד, לא נגיעה במסמכים חתומים.
 *
 * הצהרות וכתבי ויתור שכבר נחתמו הם קפואים: התוכן שלהם מגובה ב-hash חתום
 * ביומן הראיות, וכל תוספת בדיעבד ניתנת להוכחה כעריכה שאחרי החתימה. כשבעל
 * העסק רוצה שההורים יאשרו גם את תוכנית הטיול, האישור הזה נחתם כמסמך משלו —
 * עם אותה שרשרת ראיות (OTP, חתימה, seal) — ולא מוזרק לתוך מה שכבר נחתם.
 */

export const DETAILS_CONFIRMATION_TEXT =
  'קראתי את פרטי הפעילות והתוכנית המפורטים לעיל, ואני מאשר/ת את השתתפות '
  + 'המשתתפים הרשומים מטעמי בהתאם לתוכנית זו. ידוע לי שהתוכנית עשויה להשתנות '
  + 'בהתאם לתנאי מזג האוויר ושיקולי בטיחות של הצוות.';

/** The four structured page sections, same keys the event page prints. */
const PAGE_SECTION_FIELDS = ['audience', 'included', 'what_to_bring', 'important_info'];

/**
 * What the signer is confirming, taken from the activity row — not from the
 * request — so the snapshot records the plan as the system held it.
 */
export function activityDetailsSnapshot(activity) {
  const sections = {};
  for (const key of PAGE_SECTION_FIELDS) {
    const value = String(activity?.[key] || '').trim();
    if (value) sections[key] = value;
  }
  return {
    id: activity?.id || null,
    name: String(
      activity?.registration_page_title || activity?.name || ''
    ).trim(),
    date: activity?.date || '',
    endDate: activity?.end_date || activity?.endDate || '',
    details: String(
      activity?.registration_page_body || activity?.description || ''
    ).trim(),
    ...(Object.keys(sections).length ? { sections } : {}),
  };
}

/** The signer already confirmed this activity — one confirmation per parent. */
export function findDetailsConfirmation(db, activityId, { parentId = null, phone = '', phonesMatch = null } = {}) {
  return (db.get('activity_detail_confirmations') || []).find((row) => {
    if (String(row.activity_id) !== String(activityId)) return false;
    if (row.status === 'cancelled') return false;
    if (parentId && String(row.parent_id || '') === String(parentId)) return true;
    if (phone && typeof phonesMatch === 'function') return phonesMatch(row.signer_phone, phone);
    return false;
  }) || null;
}

/**
 * Create the signed confirmation: evidence event first shape-wise (the row
 * embeds its reference), row persisted durably, journal appended after —
 * the same order the waivers use.
 */
export async function confirmActivityDetails({
  db,
  persist,
  activity,
  parent = null,
  participantNames = [],
  signerName = '',
  signerPhone = '',
  signature = '',
  phoneVerification = null,
  requestContext = null,
}) {
  const name = String(signerName || parent?.name || '').trim();
  if (!name) {
    throw Object.assign(new Error('חסר שם החותם'), { status: 400 });
  }
  if (!String(signature || '').startsWith('data:image')) {
    throw Object.assign(new Error('חסרה חתימה'), { status: 400 });
  }
  const signedAt = new Date().toISOString();
  const id = `adc_${crypto.randomUUID()}`;
  const signer = {
    name,
    phone: signerPhone || parent?.phone || '',
    parentId: parent?.id || null,
  };
  const contentSnapshot = {
    documentType: 'activity_details_confirmation',
    title: 'אישור פרטי פעילות',
    confirmationText: DETAILS_CONFIRMATION_TEXT,
    activity: activityDetailsSnapshot(activity),
    signer,
    participants: participantNames.filter(Boolean),
    signedAt,
    ...(phoneVerification ? { phoneVerification } : {}),
  };
  const evidence = createSignatureEvidenceEvent({
    documentType: 'activity_details_confirmation',
    documentId: id,
    signer: { ...signer, parentId: signer.parentId },
    participant: {},
    signingCapacity: 'self',
    occurredAt: signedAt,
    contentSnapshot,
    signature,
    phoneVerification,
    requestContext,
    source: 'public_form',
    activityId: activity?.id || null,
  });
  const record = db.insert('activity_detail_confirmations', {
    id,
    activity_id: activity?.id || null,
    parent_id: parent?.id || null,
    signer_name: name,
    signer_phone: signer.phone,
    participant_names: contentSnapshot.participants,
    signature_url: signature,
    status: 'approved',
    form_snapshot: {
      ...contentSnapshot,
      evidence: evidenceReference(evidence),
    },
    signed_at: signedAt,
    created_at: signedAt,
  });
  const persisted = await persist('activity_detail_confirmations', record);
  if (persisted?.ok === false) {
    throw Object.assign(new Error('שמירת האישור נכשלה — נסו שוב'), { status: 503 });
  }
  await appendSignatureEvidence(db, evidence);
  return record;
}
