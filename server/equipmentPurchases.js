/**
 * תשלום ציוד הוא רכישה, גם אם הוא לא עבר בקופה.
 *
 * תיק „רכישות” בכרטיס הלקוח נבנה מ-pos_sales בלבד, ותשלום ציוד לא יוצר שם
 * שורה — הוא יוצר רשומת payments עם `equipment_payment`. התוצאה: לקוח ששילם
 * על נעליים ראה „שולם” בתיק הציוד, ומיד מתחתיו „אין רכישות”. שתי אמיתות
 * סותרות על אותו כסף.
 *
 * במקום להתחיל לכתוב מכירות רטרואקטיביות, התיק מציג גם את תשלומי הציוד —
 * בצורת מכירה, אבל בלי להעמיד פנים שהם כאלה: `source` מסמן את המקור, וכרטיס
 * הלקוח לא מציע עליהם „בטל רכישה”, כי אין מה לבטל בקופה.
 *
 * שדרוג נעליים (`equipment_shoes_upgrade`) נספר כאן גם הוא — זו רכישת ציוד
 * לכל דבר, רק בלי פריט חדש לסמן.
 */

/** תשלום שהוא רכישת ציוד, ולא חיוב כללי או תשלום על פעילות. */
function isEquipmentPurchasePayment(payment) {
  return !!(payment?.equipment_payment || payment?.equipment_shoes_upgrade);
}

const SALE_STATUSES = new Set(['paid', 'pending', 'refunded', 'cancelled']);

/**
 * שורות „רכישה” הנגזרות מתשלומי ציוד של אותו תלמיד או אותה משפחה.
 *
 * תשלום שכבר תלוי במכירה (`pos_sale_id`) מדולג — המכירה עצמה כבר ברשימה,
 * ושתי שורות על חיוב אחד גרועות מאפס.
 */
export function equipmentPurchaseRows({ payments = [], studentId = '', parentId = '' } = {}) {
  const askStudent = String(studentId || '').trim();
  const askParent = String(parentId || '').trim();
  if (!askStudent && !askParent) return [];

  return (payments || [])
    .filter((payment) => isEquipmentPurchasePayment(payment) && !payment.pos_sale_id)
    .filter(
      (payment) =>
        (askStudent && String(payment.student_id || '') === askStudent) ||
        (askParent && String(payment.parent_id || '') === askParent)
    )
    .map((payment) => {
      const status = String(payment.status || '').toLowerCase();
      return {
        id: `eqp-${payment.id}`,
        source: 'equipment_payment',
        payment_id: payment.id,
        student_id: payment.student_id || null,
        parent_id: payment.parent_id || null,
        created_at: payment.created_at || payment.paid_at || null,
        status: SALE_STATUSES.has(status) ? status : 'pending',
        total: Number(payment.amount) || 0,
        payment_method: payment.payment_method || 'online',
        items: [
          {
            description: payment.description || 'ציוד',
            quantity: 1,
            unitprice: Number(payment.amount) || 0,
          },
        ],
        payment_url: payment.payment_url || null,
        icount_doc_url: payment.icount_doc_url || null,
        icount_doc_number: payment.icount_doc_number || null,
        icount_doc_id: payment.icount_doc_id || null,
        icount_doctype: payment.icount_doctype || null,
      };
    });
}
