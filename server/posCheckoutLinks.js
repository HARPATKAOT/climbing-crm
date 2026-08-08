/**
 * A counter sale that cannot be charged yet.
 *
 * Selling wall access to someone whose health declaration or wall waiver is
 * missing or expired used to end in a red error at the register: the sale was
 * refused and nothing was sent, so the customer went home with neither the
 * documents nor the pass. The same problem was already solved for an outing —
 * the participation form is filled first and the payment is what closes it —
 * and this is that shape applied to the counter.
 *
 * The link the register hands out carries the cart, not a product page: the
 * price the staff member set, the benefit they applied and the people the pass
 * is for all travel with the token. Nothing is charged and no sale row exists
 * until the documents are actually signed, so an abandoned link leaves behind a
 * row here and nothing else.
 */

import crypto from 'crypto';

export const POS_CHECKOUT_TABLE = 'pos_checkout_links';

/** Days a link stays usable. Long enough to be filled in the evening, short
 *  enough that a price from last month is never charged. */
export const POS_CHECKOUT_TTL_DAYS = 14;

export const POS_CHECKOUT_STATUS = {
  AWAITING_DOCUMENTS: 'awaiting_documents',
  AWAITING_PAYMENT: 'awaiting_payment',
  PAID: 'paid',
  CANCELLED: 'cancelled',
};

const STATUS_LABELS = {
  [POS_CHECKOUT_STATUS.AWAITING_DOCUMENTS]: 'ממתין למילוי הטפסים',
  [POS_CHECKOUT_STATUS.AWAITING_PAYMENT]: 'הטפסים מולאו · ממתין לתשלום',
  [POS_CHECKOUT_STATUS.PAID]: 'שולם',
  [POS_CHECKOUT_STATUS.CANCELLED]: 'בוטל',
  expired: 'פג תוקף',
};

export function newPosCheckoutToken() {
  return crypto.randomBytes(18).toString('base64url');
}

/** Lines that hand someone climbing time and therefore need documents on file.
 *  A family pass is excluded exactly as the counter check excludes it. */
export function wallAccessLines(lines = []) {
  return (lines || []).filter((line) => line?.grants_wall_climbing && !line.family_shared);
}

/**
 * Everyone a wall-access cart is buying for, once.
 *
 * A line without explicit `participant_ids` is for the customer chosen at the
 * register, repeated for its quantity — the same default `enforceWallAccess…`
 * applies, so the two never disagree about who was sold what.
 */
export function wallParticipantIds(lines = [], fallbackStudentId = null) {
  const ids = [];
  for (const line of wallAccessLines(lines)) {
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const explicit = (line.participant_ids || []).map(String).filter(Boolean);
    const forLine = explicit.length
      ? explicit
      : Array.from({ length: quantity }, () => String(fallbackStudentId || ''));
    for (const id of forLine) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Who is missing what, in the order the cart names them.
 *
 * `eligibilityOf` and `nameOf` are injected so this stays a pure function over
 * the participation rules rather than a second copy of them.
 *
 * @returns {Array<{student_id:string, name:string, missing:string[], health_state:string, waiver_state:string}>}
 */
export function documentGaps({ participantIds = [], eligibilityOf, nameOf } = {}) {
  const gaps = [];
  for (const studentId of participantIds) {
    const eligibility = eligibilityOf(studentId);
    if (eligibility?.eligible) continue;
    const missing = [];
    if (eligibility?.health?.state !== 'valid') missing.push('health');
    if (eligibility?.waiver?.state !== 'valid') missing.push('waiver');
    gaps.push({
      student_id: String(studentId),
      name: nameOf ? nameOf(studentId) : '',
      missing,
      health_state: eligibility?.health?.state || 'missing',
      waiver_state: eligibility?.waiver?.state || 'missing',
      // A medical hold is not a paperwork gap — a new declaration does not
      // lift it, so a link would send the customer to fill a form that still
      // will not let them climb.
      blocked: eligibility?.health?.state === 'blocked',
    });
  }
  return gaps;
}

/** Hebrew for what one person still owes, for the register and the link page. */
export function gapText(gap) {
  if (!gap) return '';
  if (gap.blocked) return 'קיימת חסימה רפואית — נדרש בירור מול הצוות';
  const parts = [];
  if (gap.missing.includes('health')) {
    parts.push(gap.health_state === 'expired' ? 'הצהרת בריאות שפגה' : 'הצהרת בריאות');
  }
  if (gap.missing.includes('waiver')) {
    parts.push(gap.waiver_state === 'expired' ? 'אישור טיפוס בקיר שפג' : 'אישור טיפוס בקיר');
  }
  return parts.join(' · ');
}

export function posCheckoutExpiresAt(from = new Date(), days = POS_CHECKOUT_TTL_DAYS) {
  const at = new Date(from);
  at.setDate(at.getDate() + days);
  return at.toISOString();
}

export function isPosCheckoutExpired(row, now = new Date()) {
  if (!row?.expires_at) return false;
  // A link that already produced a payment is judged by the payment, not by the
  // clock: the customer reached the clearing page in time.
  if (row.status === POS_CHECKOUT_STATUS.PAID) return false;
  return new Date(row.expires_at).getTime() < new Date(now).getTime();
}

/** The status to show, with expiry folded in. */
export function posCheckoutStatus(row, now = new Date()) {
  if (!row) return null;
  if (row.status === POS_CHECKOUT_STATUS.CANCELLED) return POS_CHECKOUT_STATUS.CANCELLED;
  if (isPosCheckoutExpired(row, now)) return 'expired';
  return row.status || POS_CHECKOUT_STATUS.AWAITING_DOCUMENTS;
}

export function posCheckoutStatusLabel(row, now = new Date()) {
  return STATUS_LABELS[posCheckoutStatus(row, now)] || '';
}

/** Can this link still be filled in and paid? */
export function isPosCheckoutOpen(row, now = new Date()) {
  const status = posCheckoutStatus(row, now);
  return status === POS_CHECKOUT_STATUS.AWAITING_DOCUMENTS
    || status === POS_CHECKOUT_STATUS.AWAITING_PAYMENT;
}

/**
 * The stored row. `lines` are the cart as the register computed it, minus the
 * catalogue object each line carries in memory — the link is re-priced from
 * this snapshot, never from today's price list, so a customer pays what the
 * staff member quoted them.
 */
export function buildPosCheckoutLink({
  token,
  lines = [],
  total = 0,
  parentId = null,
  studentId = null,
  customerName = '',
  customerPhone = '',
  customerEmail = '',
  couponCode = null,
  gaps = [],
  createdBy = null,
  now = new Date(),
} = {}) {
  const at = new Date(now).toISOString();
  return {
    id: token,
    status: POS_CHECKOUT_STATUS.AWAITING_DOCUMENTS,
    items: lines.map(({ item, ...rest }) => rest),
    total: Number(total) || 0,
    parent_id: parentId || null,
    student_id: studentId || null,
    customer_name: customerName || '',
    customer_phone: customerPhone || '',
    customer_email: customerEmail || '',
    coupon_code: couponCode || null,
    participants: gaps.map((gap) => ({
      student_id: gap.student_id,
      name: gap.name,
      missing: gap.missing,
    })),
    sale_id: null,
    payment_id: null,
    payment_url: null,
    documents_signed_at: null,
    paid_at: null,
    expires_at: posCheckoutExpiresAt(now),
    created_by: createdBy || null,
    created_at: at,
    updated_at: at,
  };
}

/** One line of Hebrew for the WhatsApp message and the register's own list. */
export function checkoutItemsLabel(row) {
  const byName = new Map();
  for (const line of row?.items || []) {
    const name = line.name || 'פריט';
    byName.set(name, (byName.get(name) || 0) + (Number(line.quantity) || 1));
  }
  return [...byName]
    .map(([name, quantity]) => (quantity > 1 ? `${name} (${quantity})` : name))
    .join(', ');
}
