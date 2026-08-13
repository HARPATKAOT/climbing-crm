import { chargeAmount, formatIls, netAmount, normalizePriceIncludesVat, roundMoney, VAT_RATE } from './vat.js';

/**
 * תמחור אירוע לפי מספר משתתפים — תאום של server/activityPricing.js.
 *
 * הנוסחה כאן ובשרת חייבות להישאר זהות: המסך מראה למי שעורך את האירוע כמה זה
 * יעלה, והשרת הוא זה שמחייב בפועל. הבדל ביניהן הוא הבטחה שבורה ללקוח.
 */

export const CHARGE_BASES = ['flat', 'per_participant'];

export function normalizeChargeBasis(value) {
  return value === 'per_participant' ? 'per_participant' : 'flat';
}

/** מספר שלם אי-שלילי, או null כשהשדה ריק. null ו-0 הם אותה תשובה: אין מינימום. */
export function normalizeCount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count <= 0) return null;
  return count;
}

/** סכום אי-שלילי, או null כשהשדה ריק. */
export function normalizeMoney(value) {
  if (value === '' || value === null || value === undefined) return null;
  const amount = roundMoney(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function eventChargeBreakdown(source = {}, { participants } = {}) {
  const basis = normalizeChargeBasis(source.charge_basis);
  const includesVat = normalizePriceIncludesVat(source.price_includes_vat);
  const perHead = roundMoney(Number(source.price) || 0);
  const minParticipants = normalizeCount(source.min_participants);
  const cap = normalizeMoney(source.max_charge);
  const extraPerHead = normalizeMoney(source.extra_participant_price);
  const registeredCount = normalizeCount(participants) || 0;

  if (basis !== 'per_participant') {
    return finish({
      basis,
      includesVat,
      perHead,
      extraPerHead: null,
      minParticipants: null,
      cap,
      registeredCount,
      billableCount: null,
      baseCount: 0,
      extraCount: 0,
      subtotal: perHead,
    });
  }

  const billableCount = Math.max(registeredCount, minParticipants || 0);
  const tiered = extraPerHead != null && minParticipants > 0;
  const baseCount = tiered ? Math.min(billableCount, minParticipants) : billableCount;
  const extraCount = tiered ? Math.max(0, billableCount - minParticipants) : 0;
  const subtotal = roundMoney(perHead * baseCount + (tiered ? extraPerHead * extraCount : 0));

  return finish({
    basis,
    includesVat,
    perHead,
    extraPerHead: tiered ? extraPerHead : null,
    minParticipants,
    cap,
    registeredCount,
    billableCount,
    baseCount,
    extraCount,
    subtotal,
  });
}

function finish(parts) {
  const { cap, subtotal, includesVat } = parts;
  const capped = cap != null && subtotal > cap;
  const entered = capped ? cap : roundMoney(subtotal);
  return {
    ...parts,
    capped,
    entered,
    net: netAmount(entered, includesVat),
    gross: chargeAmount(entered, includesVat),
    vat: roundMoney(chargeAmount(entered, includesVat) - netAmount(entered, includesVat)),
    rate: VAT_RATE,
  };
}

export function hostChargeBreakdown(activity = {}, { registeredCount = 0 } = {}) {
  const override = normalizeCount(activity.host_charge_participants);
  return eventChargeBreakdown(activity, {
    participants: override != null ? override : registeredCount,
  });
}

/**
 * Amounts shown in the host-payment card.
 *
 * A legacy payment row can say `status: paid` while the activity is still
 * authoritatively unpaid. That row arrives after the first render and used to
 * replace the correct live total with its stale one-person amount. Only the
 * activity payment status decides when a recorded amount is final.
 */
export function displayedHostCharge(breakdown = {}, hostPayment = null, paymentStatus = 'unpaid') {
  const useRecorded = ['paid', 'partial'].includes(String(paymentStatus || 'unpaid'));
  return {
    entered: useRecorded
      ? (hostPayment?.entered_amount ?? breakdown.entered ?? 0)
      : (breakdown.entered ?? 0),
    gross: useRecorded
      ? (hostPayment?.amount ?? breakdown.gross ?? 0)
      : (breakdown.gross ?? 0),
  };
}

/**
 * שורת ההסבר שמופיעה מתחת לשדות המחיר ובכרטיס התשלום.
 *
 * מי שעורך את האירוע צריך לראות את החשבון עצמו, לא רק את התוצאה — אחרת אי אפשר
 * להבחין בין "מחויב על 20 כי כך נרשמו" לבין "מחויב על 20 כי זה המינימום".
 */
export function describeEventCharge(breakdown) {
  if (!breakdown || breakdown.entered <= 0) return '';
  if (breakdown.basis !== 'per_participant') {
    return `${formatIls(breakdown.entered)} לאירוע · לתשלום ${formatIls(breakdown.gross)}`;
  }

  const parts = [];
  if (breakdown.extraCount > 0) {
    parts.push(`${breakdown.baseCount} × ${formatIls(breakdown.perHead)}`);
    parts.push(`${breakdown.extraCount} נוספים × ${formatIls(breakdown.extraPerHead)}`);
  } else {
    parts.push(`${breakdown.billableCount} משתתפים × ${formatIls(breakdown.perHead)}`);
  }

  let line = `${parts.join(' + ')} = ${formatIls(breakdown.entered)}`;
  if (breakdown.capped) line += ` (תקרה ${formatIls(breakdown.cap)})`;
  if (breakdown.minParticipants && breakdown.registeredCount < breakdown.minParticipants) {
    line += ` · לפי מינימום ${breakdown.minParticipants}`;
  }
  return `${line} · לתשלום ${formatIls(breakdown.gross)}`;
}

/** תקציר קצר לשורת מחירון, למשל "70₪ לראש · מינימום 20". */
export function describePriceRule(rule) {
  if (!rule) return '';
  const includesVat = normalizePriceIncludesVat(rule.price_includes_vat);
  const suffix = includesVat ? ' כולל מע״מ' : '';
  if (normalizeChargeBasis(rule.charge_basis) !== 'per_participant') {
    return Number(rule.price) > 0 ? `${formatIls(rule.price)} לאירוע${suffix}` : '';
  }
  const bits = [`${formatIls(rule.price)} לראש${suffix}`];
  const min = normalizeCount(rule.min_participants);
  if (min) bits.push(`מינימום ${min}`);
  const extra = normalizeMoney(rule.extra_participant_price);
  if (extra && min) bits.push(`${formatIls(extra)} לכל נוסף`);
  const cap = normalizeMoney(rule.max_charge);
  if (cap) bits.push(`עד ${formatIls(cap)}`);
  return bits.join(' · ');
}
