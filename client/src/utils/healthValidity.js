/**
 * In force until 31 August of the year after signing, whatever month it was
 * signed in. Keep in sync with server/healthValidity.js.
 */
const endOfAugust = (year) => new Date(`${year}-08-31T23:59:59.999+03:00`);

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns the expiry Date for a signature date, or null when the date is unknown. */
export function healthExpiryDate(signedAt) {
  const signed = toDate(signedAt);
  if (!signed) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric',
  }).formatToParts(signed);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  return endOfAugust(year + 1);
}

/** Unknown signature date is treated as valid so old records are not flagged by mistake. */
export function isHealthDeclarationValid(signedAt, now = new Date()) {
  const expiry = healthExpiryDate(signedAt);
  if (!expiry) return true;
  const checkedAt = toDate(now);
  return !!checkedAt && checkedAt.getTime() <= expiry.getTime();
}

export function formatHealthExpiry(signedAt) {
  const expiry = healthExpiryDate(signedAt);
  return expiry ? expiry.toLocaleDateString('he-IL') : '';
}

export function participationWaiverExpiryDate(signedAt) {
  const signed = toDate(signedAt);
  if (!signed) return null;
  const year = Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric',
  }).formatToParts(signed).find((part) => part.type === 'year')?.value);
  return endOfAugust(year + 2);
}

export function isParticipationWaiverValid(signedAt, now = new Date()) {
  const expiry = participationWaiverExpiryDate(signedAt);
  return !!expiry && now.getTime() <= expiry.getTime();
}
