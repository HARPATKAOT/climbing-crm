/**
 * Health declarations expire together on a fixed two-year cycle:
 * the end of July of even years (31.7.2026, 31.7.2028, ...).
 * Keep in sync with client/src/utils/healthValidity.js.
 */

const endOfJuly = (year) => new Date(year, 6, 31, 23, 59, 59, 999);

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function healthExpiryDate(signedAt) {
  const signed = toDate(signedAt);
  if (!signed) return null;
  const year = signed.getFullYear();
  let expiry = endOfJuly(year % 2 === 0 ? year : year + 1);
  if (signed.getTime() > expiry.getTime()) {
    expiry = endOfJuly(expiry.getFullYear() + 2);
  }
  if (signed.getFullYear() === expiry.getFullYear() && signed.getMonth() === 6) {
    expiry = endOfJuly(expiry.getFullYear() + 2);
  }
  return expiry;
}

/** Unknown signature date is treated as valid so old records are not flagged by mistake. */
export function isHealthDeclarationValid(signedAt, now = new Date()) {
  const expiry = healthExpiryDate(signedAt);
  if (!expiry) return true;
  return now.getTime() <= expiry.getTime();
}

export function declarationSignedAt(declaration) {
  if (!declaration || typeof declaration !== 'object') return null;
  return (
    declaration.signedDate
    || declaration.date
    || declaration.signedAt
    || declaration.created_at
    || null
  );
}
