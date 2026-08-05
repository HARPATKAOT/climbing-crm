/**
 * Health declarations follow the activity season, which starts on 1 September.
 * A declaration signed January-July closes on 31 August of that year; one
 * signed August-December already belongs to the following season. Keep this in
 * sync with client/src/utils/healthValidity.js.
 */

// 31 August 23:59:59.999 Israel daylight time (UTC+03:00). Keeping the instant
// explicit makes boundary checks independent of the Render host timezone.
const endOfAugust = (year) => new Date(`${year}-08-31T23:59:59.999+03:00`);

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function healthExpiryDate(signedAt) {
  const signed = toDate(signedAt);
  if (!signed) return null;
  const israelParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(signed);
  const year = Number(israelParts.find((part) => part.type === 'year')?.value);
  const month = Number(israelParts.find((part) => part.type === 'month')?.value);
  return endOfAugust(month >= 8 ? year + 1 : year);
}

/** Unknown signature date is treated as valid so old records are not flagged by mistake. */
export function isHealthDeclarationValid(signedAt, now = new Date()) {
  const expiry = healthExpiryDate(signedAt);
  if (!expiry) return true;
  const checkedAt = toDate(now);
  return !!checkedAt && checkedAt.getTime() <= expiry.getTime();
}

export function declarationSignedAt(declaration) {
  if (!declaration || typeof declaration !== 'object') return null;
  return (
    declaration.signedDate
    || declaration.date
    || declaration.signedAt
    || declaration.signed_at
    || declaration.created_at
    || null
  );
}

/** Participation waivers are valid through 31 August of signing year + 2. */
export function participationWaiverExpiryDate(signedAt) {
  const signed = toDate(signedAt);
  if (!signed) return null;
  const yearPart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
  }).formatToParts(signed).find((part) => part.type === 'year');
  return endOfAugust(Number(yearPart?.value) + 2);
}

export function isParticipationWaiverValid(signedAt, now = new Date()) {
  const expiry = participationWaiverExpiryDate(signedAt);
  if (!expiry) return false;
  const at = now instanceof Date ? now : new Date(now);
  return !Number.isNaN(at.getTime()) && at.getTime() <= expiry.getTime();
}

/**
 * The legacy student-level date predates activity-specific declarations and
 * therefore represents the wall form only. A trip/event context may show the
 * date of a matching declaration, but must never present the wall date as an
 * expired declaration of another kind.
 */
export function scopedDeclarationSignedAt({
  declaration,
  studentHealthSignedAt = null,
  templateSlug = '',
} = {}) {
  const matchingDate = declarationSignedAt(declaration);
  if (matchingDate) return matchingDate;
  const slug = String(templateSlug || '').trim().toLowerCase();
  return (!slug || slug === 'wall') ? (studentHealthSignedAt || null) : null;
}
