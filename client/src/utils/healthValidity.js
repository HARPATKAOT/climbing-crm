/**
 * Health declarations expire together on a fixed two-year cycle:
 * the end of July of even years (31.7.2026, 31.7.2028, ...).
 * A declaration signed during July of a renewal year already counts
 * for the next cycle, so it is not born expired.
 * Old declarations stay stored in the client file — expiry only means
 * a new signature is required.
 */

const endOfJuly = (year) => new Date(year, 6, 31, 23, 59, 59, 999);

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns the expiry Date for a signature date, or null when the date is unknown. */
export function healthExpiryDate(signedAt) {
  const signed = toDate(signedAt);
  if (!signed) return null;
  const year = signed.getFullYear();
  let expiry = endOfJuly(year % 2 === 0 ? year : year + 1);
  if (signed.getTime() > expiry.getTime()) {
    expiry = endOfJuly(expiry.getFullYear() + 2);
  }
  // Signed during the renewal month itself -> valid for the next cycle
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

export function formatHealthExpiry(signedAt) {
  const expiry = healthExpiryDate(signedAt);
  return expiry ? expiry.toLocaleDateString('he-IL') : '';
}
