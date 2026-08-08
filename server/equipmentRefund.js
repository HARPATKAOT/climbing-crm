/**
 * זיכוי על השכרת נעלי טיפוס.
 *
 * המדיניות חלה **רק על הנעליים**. תשלום ציוד הוא תשלום אחד שיכול לכלול גם
 * חולצה ושק מגנזיום, ואלה מכירה ולא השכרה — אין להם „תקופה שנותרה” ולכן אין
 * להם החזר יחסי. לכן מבודדים כאן את רכיב הנעליים מתוך האלוקציות של התשלום.
 *
 * הנעליים מושכרות לחצי עונה, והתשלום עליהן מחושב מלכתחילה לפי כמה נותר
 * (`shoesSeasonPricing`). לכן גם הזיכוי כזה: ערך החודשים שטרם נוצלו, פחות
 * דמי הביטול שבמדיניות.
 *
 * הכללים עצמם אינם כאן אלא בצילום המדיניות שנשמר על התשלום, כך ששינוי דמי
 * הביטול היום אינו משנה החזר של השכרה שנרכשה אתמול.
 */

import { suggestedUsageRefund } from './cancellationPolicies.js';

/** תשלומי ציוד מזוהים בשדה הזה, שנשמר עליהם ברגע היצירה. */
export function isEquipmentPayment(payment) {
  return !!payment?.equipment_checkout_token;
}

/**
 * חלק הנעליים מתוך התשלום, וחלון ההשכרה שלהן.
 *
 * הסכום מוצמד ליחס שבו האלוקציה חויבה בפועל, כדי שהנחת משפחה ומע״מ יחולו
 * עליו כפי שחלו על התשלום עצמו — ולא נחזיר מחיר מחירון על סכום שלא שולם.
 */
export function shoesPortionOf(payment) {
  const allocations = Array.isArray(payment?.equipment_allocations)
    ? payment.equipment_allocations
    : [];
  let amount = 0;
  let startsAt = null;
  let endsAt = null;

  for (const allocation of allocations) {
    const shoes = Number(allocation?.shoes_amount) || 0;
    if (shoes <= 0) continue;
    const subtotal = Number(allocation?.subtotal) || 0;
    const charged = Number(allocation?.charge_amount);
    // יחס החיוב בפועל לעומת המחירון של אותה אלוקציה.
    const ratio = subtotal > 0 && Number.isFinite(charged) && charged > 0
      ? charged / subtotal
      : 1;
    amount += shoes * ratio;

    if (allocation.rental_starts_at && (!startsAt || allocation.rental_starts_at < startsAt)) {
      startsAt = allocation.rental_starts_at;
    }
    if (allocation.rental_ends_at && (!endsAt || allocation.rental_ends_at > endsAt)) {
      endsAt = allocation.rental_ends_at;
    }
  }

  return {
    amount: Math.round(amount * 100) / 100,
    starts_at: startsAt,
    ends_at: endsAt,
    has_shoes: amount > 0,
  };
}

/**
 * כמה מתקופת ההשכרה כבר נוצל, ביחידות של חצי חודש — אותן יחידות שבהן
 * ההשכרה תומחרה מלכתחילה.
 */
export function rentalUsage({ startsAt, endsAt, refDate = new Date() } = {}) {
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const now = refDate instanceof Date ? refDate : new Date(refDate);

  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { totalUnits: 0, usedUnits: 0, resolved: false };
  }
  const span = end.getTime() - start.getTime();
  if (span <= 0) return { totalUnits: 0, usedUnits: 0, resolved: false };

  // חודש ≈ 30.44 יום; מעוגל לחצאי יחידה, אותה גרנולריות שבה ההשכרה תומחרה.
  // בלי העיגול חודשים קלנדריים באורך שונה מייצרים 3.02 מתוך 5, והשארית
  // שמוצגת ללקוח נראית כמו טעות חישוב.
  const totalUnits = Math.round((span / (30.44 * 864e5)) * 2) / 2;
  const elapsed = Math.min(Math.max(0, now.getTime() - start.getTime()), span);
  const usedUnits = Math.round((elapsed / span) * totalUnits * 2) / 2;
  return { totalUnits, usedUnits, resolved: totalUnits > 0 };
}

/**
 * ההחזר המומלץ על ההשכרה, לפי המדיניות שהוצמדה לתשלום.
 *
 * @param {object} snapshot צילום מדיניות בבסיס `usage`
 */
export function equipmentRefundRecommendation({
  snapshot,
  payment,
  refDate = new Date(),
} = {}) {
  const shoes = shoesPortionOf(payment);
  const { totalUnits, usedUnits, resolved } = rentalUsage({
    startsAt: shoes.starts_at,
    endsAt: shoes.ends_at,
    refDate,
  });

  const recommendation = suggestedUsageRefund({
    snapshot,
    paidAmount: shoes.amount,
    totalUnits,
    usedUnits,
    purchasedAt: payment?.paid_at || payment?.created_at || null,
    cancelledAt: refDate,
  });

  return {
    ...recommendation,
    shoes_amount: shoes.amount,
    paid_amount: Number(payment?.amount) || 0,
    rental_starts_at: shoes.starts_at,
    rental_ends_at: shoes.ends_at,
    total_units: totalUnits,
    used_units: usedUnits,
    remaining_units: Math.max(0, Math.round((totalUnits - usedUnits) * 100) / 100),
    has_shoes: shoes.has_shoes,
    // בלי חלון השכרה אי אפשר לדעת כמה נוצל, ואז הסכום שיוצג הוא ניחוש.
    period_resolved: resolved && shoes.has_shoes,
  };
}
