/**
 * ביצוע זיכוי חלקי — הכסף והמסמך, בסדר הזה.
 *
 * עד כאן המערכת ידעה רק לבטל מסמך שלם, ולכן כל החזר שאינו מלא נשלח להיעשות
 * ידנית ב-iCount. שני הצדדים קיימים ב-API ואומתו מולו: `cc/refund` מחזיר
 * לכרטיס, ו-`doc/create` בסוג `refund` מוציא חשבונית זיכוי. חשוב: זיכוי חלקי
 * **אינו** יוצר מסמך מעצמו, ולכן שני השלבים כאן ולא אחד.
 *
 * הסדר מכוון. הכסף קודם: אם הזיכוי לכרטיס נכשל, לא נוצר מסמך שמעיד על החזר
 * שלא קרה. אם דווקא המסמך נכשל אחרי שהכסף חזר — זה מדווח במפורש כדי שיושלם
 * ידנית, ולא נבלע.
 */

/**
 * @param {object} icount מודול החיוב (מוזרק כדי שהמודול יישאר בר-בדיקה)
 * @param {number} amount הסכום להחזר, ברוטו
 */
export async function executePartialRefund({
  icount,
  payment,
  amount,
  reason,
  clientName,
  clientId,
  emailTo,
} = {}) {
  const gross = Math.round((Number(amount) || 0) * 100) / 100;
  if (gross <= 0) {
    return { ok: false, error: 'סכום הזיכוי חייב להיות גדול מאפס' };
  }
  if (gross < icount.MIN_PARTIAL_REFUND) {
    return {
      ok: false,
      code: 'below_min_refund',
      error: `סכום הזיכוי חייב להיות מעל ${icount.MIN_PARTIAL_REFUND} ₪ — זו מגבלה של הסולק`,
    };
  }
  const docnum = payment?.icount_doc_number;
  if (!docnum) {
    return { ok: false, code: 'missing_doc', error: 'לתשלום אין מספר מסמך במערכת החיוב' };
  }

  // מזהה החיוב שמור על התשלום רק מאז 8.8.26; לתשלומים שקדמו לכך מאתרים אותו
  // ביומן החיובים לפי מספר המסמך.
  let ccBillLogId = payment.cc_bill_log_id || null;
  let charge = null;
  if (!ccBillLogId) {
    charge = await icount.findCcCharge({
      docnum,
      around: payment.paid_at || payment.created_at || new Date(),
    });
    if (!charge) {
      return {
        ok: false,
        code: 'charge_not_found',
        error: 'לא נמצא חיוב אשראי למסמך הזה — ייתכן שהתשלום לא נעשה בכרטיס',
      };
    }
    if (charge.alreadyRefunded) {
      return { ok: false, code: 'already_refunded', error: 'החיוב כבר זוכה' };
    }
    ccBillLogId = charge.ccBillLogId;
  }

  const refund = await icount.refundCcAmount({ ccBillLogId, sum: gross });

  // הכסף חזר. מכאן והלאה כישלון אינו מבטל את ההחזר, ולכן הוא מדווח ולא נזרק.
  let doc = null;
  let docError = '';
  try {
    doc = await icount.createRefundDoc({
      clientId,
      clientName,
      amount: gross,
      description: reason || 'זיכוי',
      comment: `זיכוי חלקי למסמך ${docnum}`,
      emailTo,
    });
  } catch (err) {
    docError = err.message || 'יצירת חשבונית הזיכוי נכשלה';
  }

  return {
    ok: true,
    amount: gross,
    ccBillLogId,
    confirmation_code: refund.confirmationCode,
    refund_type: refund.refundType,
    remaining_amount: refund.remainingAmount,
    refund_doc_number: doc?.docnum || null,
    refund_doc_url: doc?.docUrl || null,
    // הכסף חזר אבל הספרים לא מעודכנים — זה חייב להיאמר, לא להיבלע.
    document_error: docError || null,
  };
}
