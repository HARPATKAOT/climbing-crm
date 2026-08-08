/**
 * זיכוי על השכרת נעלי טיפוס.
 *
 * ההשכרה היא לחצי עונה, והתשלום מחושב מלכתחילה לפי כמה חודשים נותרו בחצי
 * (`shoesSeasonPricing`). לכן גם הזיכוי הוא לפי הזמן שנותר: מחזירים את ערך
 * החודשים שטרם נוצלו, פחות דמי הביטול שבמדיניות.
 *
 * הדוגמה שממנה זה נגזר: השכרה לחמישה חודשים, נותרו חודשיים, ערכם 60 ₪,
 * דמי ביטול 50 ₪ — מוחזרים 10 ₪.
 *
 * הכללים עצמם אינם כאן אלא במדיניות הביטול, כך ששינוי דמי הביטול נעשה במסך
 * ההגדרות ולא בקוד.
 */

import { suggestedUsageRefund } from './cancellationPolicies.js';

/** תשלומי ציוד מזוהים בשדה הזה, שנשמר עליהם ברגע היצירה. */
export function isEquipmentPayment(payment) {
  return !!payment?.equipment_checkout_token;
}

/**
 * כמה מתקופת ההשכרה כבר נוצל, ביחידות של חצי חודש — אותן יחידות שבהן
 * `shoesSeasonPricing` תמחר אותה מלכתחילה.
 *
 * @param {{half_start?: string, half_end?: string}} pricing מה שנשמר על התשלום
 */
export function rentalUsage({ pricing = {}, refDate = new Date() } = {}) {
  const start = pricing.half_start ? new Date(pricing.half_start) : null;
  const end = pricing.half_end ? new Date(pricing.half_end) : null;
  const now = refDate instanceof Date ? refDate : new Date(refDate);
  const total = Number(pricing.total_units) || 0;

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !total) {
    return { totalUnits: total, usedUnits: total, resolved: false };
  }
  const span = end.getTime() - start.getTime();
  if (span <= 0) return { totalUnits: total, usedUnits: total, resolved: false };

  const elapsed = Math.min(Math.max(0, now.getTime() - start.getTime()), span);
  // מעגלים לחצאי יחידה — אותה גרנולריות שבה ההשכרה תומחרה מלכתחילה
  // (`halfMonthUnits`). בלי זה חודשים קלנדריים באורך שונה מייצרים 3.02 מתוך 5
  // במקום 3, והשארית שמוצגת ללקוח נראית כמו טעות חישוב.
  const raw = (elapsed / span) * total;
  const usedUnits = Math.round(raw * 2) / 2;
  return { totalUnits: total, usedUnits, resolved: true };
}

/**
 * ההחזר המומלץ על השכרה, לפי המדיניות שהוצמדה לה.
 *
 * @param {object} snapshot צילום מדיניות בבסיס `usage`
 */
export function equipmentRefundRecommendation({
  snapshot,
  payment,
  pricing,
  refDate = new Date(),
} = {}) {
  const { totalUnits, usedUnits, resolved } = rentalUsage({ pricing, refDate });
  const recommendation = suggestedUsageRefund({
    snapshot,
    paidAmount: Number(payment?.amount) || 0,
    totalUnits,
    usedUnits,
    purchasedAt: payment?.paid_at || payment?.created_at || null,
    cancelledAt: refDate,
  });
  return {
    ...recommendation,
    total_units: totalUnits,
    used_units: usedUnits,
    remaining_units: Math.max(0, Math.round((totalUnits - usedUnits) * 100) / 100),
    // בלי תאריכי החצי אי אפשר לדעת כמה נוצל, ואז הסכום שיוצג הוא ניחוש.
    // מסמנים כדי שהמסך יבקש אישור ידני במקום להציג מספר כאילו הוא ודאי.
    period_resolved: resolved,
  };
}
