/**
 * זיכוי בסכום שנקבע ידנית.
 *
 * כל שאר מסלולי הזיכוי דורשים שהסכום יהיה בדיוק מה שהמדיניות ממליצה. זה נכון
 * ברוב המקרים — הוא מונע טעויות ומייצר עקביות מול לקוחות — אבל הוא גם אומר
 * שכל מקרה שהמדיניות לא צפתה נגמר ביציאה ידנית למערכת החיוב, בלי שנשאר לו זכר
 * אצלנו.
 *
 * המסלול הזה סוגר את הפער, ובמכוון הוא מרעיש: הוא דורש סיבה, רושם מי אישר,
 * ומסמן את התשלום כחריגה ממדיניות — כדי שאפשר יהיה למצוא אחר כך את כל
 * הפעמים שחרגנו ולשאול למה.
 */

/** מגבלות שמונעות טעות הקלדה מלהפוך לזיכוי שגוי. */
export function validateManualRefund({ amount, paidAmount, reason, minRefund = 1 } = {}) {
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const paid = Math.round((Number(paidAmount) || 0) * 100) / 100;

  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'סכום הזיכוי חייב להיות גדול מאפס' };
  }
  if (value < minRefund) {
    return {
      ok: false,
      code: 'below_min_refund',
      error: `סכום הזיכוי חייב להיות מעל ${minRefund} ₪ — זו מגבלה של הסולק`,
    };
  }
  // אי אפשר להחזיר יותר ממה שנגבה. בלי זה טעות הקלדה של ספרה אחת מוציאה
  // מהעסק סכום שלא נכנס אליו מעולם.
  if (paid > 0 && value > paid) {
    return {
      ok: false,
      code: 'exceeds_paid',
      error: `הסכום גבוה ממה ששולם (₪${paid.toLocaleString()})`,
    };
  }
  if (!String(reason || '').trim()) {
    return { ok: false, code: 'reason_required', error: 'זיכוי ידני מחייב סיבה' };
  }
  return { ok: true, amount: value };
}

/**
 * האם הסכום חורג ממה שהמדיניות ממליצה. חריגה אינה שגיאה — היא רק חייבת
 * להיות מסומנת ככזו.
 */
export function isPolicyException(amount, recommended) {
  if (recommended == null || !Number.isFinite(Number(recommended))) return true;
  return Math.abs(Number(amount) - Number(recommended)) >= 0.005;
}

/** מה שנרשם על התשלום אחרי זיכוי ידני. */
export function manualRefundMarks({
  amount,
  reason,
  recommended = null,
  approvedBy = null,
  result = {},
  now = new Date().toISOString(),
} = {}) {
  return {
    status: 'refunded',
    refunded_at: now,
    refund_amount: amount,
    refund_reason: reason,
    refund_doc_number: result.refund_doc_number || null,
    refund_doc_url: result.refund_doc_url || null,
    refunded_by: approvedBy,
    // שלושת אלה הם התיעוד של החריגה: מה המדיניות אמרה, מה נעשה בפועל,
    // ומי לקח את ההחלטה.
    refund_manual: true,
    refund_recommended_amount: recommended,
    refund_policy_exception: isPolicyException(amount, recommended),
    cc_bill_log_id: result.ccBillLogId || null,
    updated_at: now,
  };
}
