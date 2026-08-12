import { chargeAmount, netAmount, normalizePriceIncludesVat, roundMoney, VAT_RATE } from './vat.js';

/**
 * תמחור אירוע לפי מספר משתתפים.
 *
 * מחירון הקיר לא בנוי ממחיר אחד לאירוע. רוב שורותיו הן מחיר לראש עם מינימום
 * משתתפים (70₪ לראש ממינימום 20), חלקן עם תוספת שונה מעבר למינימום (50₪ לראש
 * עד 20, ואז 40₪ לכל ילד נוסף) וחלקן עם תקרת חיוב (110₪ לראש ממינימום 15, עד
 * 2,500₪). ארבעת השדות כאן מכסים את כל השורות האלה; מה שהם לא מכסים — כמו
 * תוספת מדריך לכל שלושה ילדים — נשאר תמחור ידני, במכוון.
 *
 * הקובץ הזה תאום ל-client/src/utils/activityPricing.js. שינוי בנוסחה חייב לקרות
 * בשניהם, אחרת המסך יראה סכום אחד והחיוב יצא אחר.
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

/**
 * הפירוט המלא של חיוב אירוע.
 *
 * `participants` הוא מספר הנרשמים בפועל (או המספר שנקבע ידנית). הוא לא נכנס
 * לחישוב כמו שהוא: המינימום הוא רצפת חיוב, ולכן 12 נרשמים במינימום 15 מחויבים
 * כ-15. זו החלטה עסקית מכוונת — המינימום לא חוסם הרשמה, הוא רק קובע ממה מחייבים.
 */
export function eventChargeBreakdown(source = {}, { participants } = {}) {
  const basis = normalizeChargeBasis(source.charge_basis);
  const includesVat = normalizePriceIncludesVat(source.price_includes_vat);
  const perHead = roundMoney(Number(source.price) || 0);
  const minParticipants = normalizeCount(source.min_participants);
  const cap = normalizeMoney(source.max_charge);
  const extraPerHead = normalizeMoney(source.extra_participant_price);
  const registeredCount = normalizeCount(participants) || 0;

  if (basis !== 'per_participant') {
    // מחיר קבוע לאירוע — ההתנהגות שהייתה כאן מאז ומתמיד, ומה שכל אירוע קיים
    // ממשיך לקבל כל עוד לא בחרו במפורש אחרת.
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
  // תוספת בלי מינימום היא חסרת משמעות: אין ממה "לעבור". במצב כזה כל המשתתפים
  // מחויבים במחיר הבסיס, ולא כולם בתעריף התוספת.
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
  // התקרה נקובה באותו מצב מע״מ כמו המחיר עצמו — מי שהקליד "עד 2,500 לפני מע״מ"
  // מתכוון לאותם 2,500 שבשדה המחיר.
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

/**
 * הסכום לחיוב המזמין, ומספר המשתתפים שעליו הוא נשען.
 *
 * `host_charge_participants` הוא תיקון ידני של הצוות (מישהו נרשם ולא הגיע, או
 * הגיע בלי להירשם). כשהוא ריק — סופרים את הנרשמים בפועל.
 */
export function hostChargeBreakdown(activity = {}, { registeredCount = 0 } = {}) {
  const override = normalizeCount(activity.host_charge_participants);
  return eventChargeBreakdown(activity, {
    participants: override != null ? override : registeredCount,
  });
}
