/**
 * זיכוי על כרטיסייה או מנוי.
 *
 * הכרטיסייה נמכרת במחיר מוזל בזכות רכישת כמה כניסות מראש. מי שניצל חלק ממנה
 * לא עמד בהתחייבות שבגללה קיבל את ההנחה — ולכן הכניסות שנוצלו מחויבות במחיר
 * כניסה בודדת, והיתרה חוזרת. זה מצב היישוב `full_price` שבמדיניות.
 *
 * מנוי לזמן אינו כמות אלא תקופה, ולכן הוא נמדד ביחסיות של ימים — שם `pro_rata`
 * הוא הנכון.
 *
 * מכירת דלפק אחת יכולה להחזיק כמה פריטים. הסכום שמזוכה הוא זה של הכרטיס עצמו
 * (`paid_price`), ולא של המכירה כולה.
 */

import { suggestedUsageRefund } from './cancellationPolicies.js';

const DAY_MS = 864e5;

export function isPassPayment(payment, passes = []) {
  if (!payment?.pos_sale_id) return false;
  return passes.some((pass) => String(pass.sale_id) === String(payment.pos_sale_id));
}

/** הכרטיסים החיים שנמכרו בעסקה הזאת. כרטיס שכבר בוטל אינו מזוכה שוב. */
export function passesOfSale(passes, saleId) {
  return (passes || []).filter(
    (pass) => String(pass.sale_id) === String(saleId) && pass.status !== 'void'
  );
}

/**
 * כמה מהכרטיס נוצל, ביחידות שמתאימות לסוגו.
 *
 * כרטיסייה — כניסות. מנוי — ימים, מעוגלים ליום שלם כדי שלא יופיע „נוצלו
 * 3.7 ימים" במסך שאדם צריך להסביר ללקוח.
 */
export function passUsage(pass, refDate = new Date()) {
  const now = refDate instanceof Date ? refDate : new Date(refDate);

  const total = Number(pass?.visits_total);
  const remaining = Number(pass?.visits_remaining);
  if (Number.isFinite(total) && total > 0) {
    const used = Number.isFinite(remaining)
      ? Math.min(total, Math.max(0, total - remaining))
      : total;
    return { totalUnits: total, usedUnits: used, unit: 'visits', resolved: true };
  }

  const from = pass?.valid_from ? new Date(pass.valid_from) : null;
  const until = pass?.valid_until ? new Date(pass.valid_until) : null;
  if (from && until && !Number.isNaN(from.getTime()) && !Number.isNaN(until.getTime())) {
    const span = Math.round((until.getTime() - from.getTime()) / DAY_MS);
    if (span > 0) {
      const elapsed = Math.min(span, Math.max(0, Math.round((now.getTime() - from.getTime()) / DAY_MS)));
      return { totalUnits: span, usedUnits: elapsed, unit: 'days', resolved: true };
    }
  }

  return { totalUnits: 0, usedUnits: 0, unit: null, resolved: false };
}

/** מה ששולם על הכרטיס הזה בפועל, אחרי הנחות. */
export function passPaidAmount(pass) {
  const paid = Number(pass?.paid_price);
  if (Number.isFinite(paid) && paid > 0) return Math.round(paid * 100) / 100;
  const list = Number(pass?.list_price);
  return Number.isFinite(list) && list > 0 ? Math.round(list * 100) / 100 : 0;
}

/**
 * ההחזר המומלץ על כרטיס אחד.
 *
 * מנוי לזמן מיושב תמיד יחסית, גם כשהמדיניות קובעת „מחיר מלא" — למחיר יחידה
 * של יום אין משמעות, ולחייב יום מנוי במחיר כניסה לקיר היה מייצר סכום שרירותי.
 */
export function passRefundRecommendation({ snapshot, pass, payment, refDate = new Date() } = {}) {
  const usage = passUsage(pass, refDate);
  const paid = passPaidAmount(pass);

  const effective = usage.unit === 'days' && snapshot?.usage_rule?.settlement === 'full_price'
    ? { ...snapshot, usage_rule: { ...snapshot.usage_rule, settlement: 'pro_rata' } }
    : snapshot;

  const recommendation = suggestedUsageRefund({
    snapshot: effective,
    paidAmount: paid,
    totalUnits: usage.totalUnits,
    usedUnits: usage.usedUnits,
    purchasedAt: payment?.paid_at || pass?.created_at || null,
    cancelledAt: refDate,
  });

  return {
    ...recommendation,
    pass_id: pass?.id || null,
    pass_name: pass?.name || 'כרטיסייה',
    pass_type: pass?.pass_type || null,
    paid_amount: paid,
    unit: usage.unit,
    total_units: usage.totalUnits,
    used_units: usage.usedUnits,
    remaining_units: Math.max(0, usage.totalUnits - usage.usedUnits),
    period_resolved: usage.resolved && paid > 0,
  };
}

/**
 * סיכום לכל הכרטיסים במכירה. מחזיר גם את הסכום הכולל, כי ההחזר לכרטיס האשראי
 * הוא אחד — המסמך והחיוב שייכים למכירה ולא לכרטיס בודד.
 */
export function saleRefundPlan({ snapshot, passes, payment, refDate = new Date() } = {}) {
  const items = (passes || []).map(
    (pass) => passRefundRecommendation({ snapshot, pass, payment, refDate })
  );
  const refundable = items.filter((item) => item.period_resolved);
  const total = refundable.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return {
    items,
    total: Math.round(total * 100) / 100,
    resolved: refundable.length > 0 && refundable.length === items.length,
  };
}
