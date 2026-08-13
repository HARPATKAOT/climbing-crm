/**
 * מה שנשאר פתוח בדלפק — טבלת „ממתינים לטיפול”.
 *
 * שני דברים יכולים להשאיר מתאמן פתוח אחרי שהוא כבר נכנס:
 *
 * 1. **תדריך ומבחן אבטחה.** מבחן חסר אינו עוצר את הכניסה — המתאמן משלם, ואז
 *    יוצא עם מדריך לתדריך ולמבחן. השורה נשארת עד שהמדריך חותם.
 * 2. **קישור תשלום שנשלח ועוד לא שולם.** בקיר משלמים במזומן או בקישור שנשלח
 *    להורה האחראי, והקישור נפרע בזמנו שלו — לפעמים תוך דקה, לפעמים אחרי
 *    שיחת טלפון. עד אז אין ראיה בדלפק שמישהו ממתין.
 *
 * ברגע שקישור תשלום נפרע הוא מפסיק להיות משימה ועובר ל„מכירות במשמרת”.
 * כך „ממתינים” נשארת רשימת עבודה בלבד, והכסף שכבר נכנס נמצא מיד ביומן
 * המכירות בלי לחכות לאישור ידני נוסף.
 *
 * טופס השתתפות חסר אינו כאן בכוונה: מי שלא חתם אינו יכול לקנות כניסה או
 * כרטיסייה מלכתחילה, ולכן הוא לא ממתין — הוא חסום, וזה נאמר בדלפק ברגע
 * שבוחרים אותו.
 */

export const PENDING_KIND = Object.freeze({ SAFETY: 'safety_test', PAYMENT: 'payment_link' });

function atOrAfter(value, lowerBound) {
  if (!lowerBound) return true;
  const valueMs = Date.parse(value);
  const lowerMs = Date.parse(lowerBound);
  if (Number.isFinite(valueMs) && Number.isFinite(lowerMs)) return valueMs >= lowerMs;
  return String(value || '') >= String(lowerBound || '');
}

function inCurrentShift(value, { today, dateOf, shiftStartedAt }) {
  if (!value) return false;
  if (shiftStartedAt) return atOrAfter(value, shiftStartedAt);
  return dateOf(value) === today;
}

function linkedPayment(sale, payments = []) {
  if (!sale) return null;
  return (Array.isArray(payments) ? payments : []).find((payment) => (
    (sale.payment_id && String(payment?.id) === String(sale.payment_id))
    || String(payment?.pos_sale_id || '') === String(sale.id || '')
  )) || null;
}

function effectiveSaleStatus(sale, payment) {
  if (sale?.status === 'refunded' || sale?.status === 'cancelled') return sale.status;
  if (payment?.status === 'refunded') return 'refunded';
  if (payment?.status === 'cancelled') return 'cancelled';
  if (payment?.status === 'paid') return 'paid';
  return sale?.status || '';
}

/** מי שנכנס במשמרת הנוכחית, לפי הכניסה האחרונה של כל אחד. */
export function todaysEntrants(checkIns = [], today, dateOf, shiftStartedAt = null) {
  const seen = new Map();
  for (const row of Array.isArray(checkIns) ? checkIns : []) {
    const at = row?.timestamp || row?.created_at;
    if (!at || !row?.climber_id || !inCurrentShift(at, { today, dateOf, shiftStartedAt })) continue;
    const prev = seen.get(row.climber_id);
    if (!prev || String(at) > String(prev)) seen.set(row.climber_id, at);
  }
  return seen;
}

/**
 * מי שנכנס היום ומשהו עדיין פתוח אצלו.
 *
 * רק מי שנכנס ועוד אין לו מבחן אבטחה בתוקף. מי שהכול אצלו סגור לא דורש
 * טיפול, ושורה שלו רק מרחיקה מהעין את מי שכן.
 *
 * @param safetyOf (studentId) => {state, expires_at, test_date}
 */
export function entryRows({
  checkIns = [], today, dateOf, shiftStartedAt = null, studentOf, safetyOf, includeSettled = false,
}) {
  const rows = [];
  for (const [studentId, at] of todaysEntrants(checkIns, today, dateOf, shiftStartedAt)) {
    const student = studentOf(studentId);
    if (!student) continue;
    const safety = safetyOf(studentId) || { state: 'missing' };
    if (safety.state === 'valid' && !includeSettled) continue;
    rows.push({
      id: `entry:${studentId}`,
      kind: PENDING_KIND.SAFETY,
      student_id: studentId,
      name: student.name,
      at,
      pending: safety.state !== 'valid',
      needs_safety: safety.state !== 'valid',
      state: safety.state,
      expires_at: safety.expires_at || null,
    });
  }
  return rows;
}

/**
 * שורות התשלום: רק קישורים שעוד לא שולמו. תשלום שהושלם כבר אינו משימה —
 * הוא מוצג מיד ביומן המכירות.
 */
/** האם המכירה כוללת פריט שמקנה כניסה לקיר. */
export function saleGrantsEntry(sale) {
  return (Array.isArray(sale?.items) ? sale.items : [])
    .some((line) => line?.grants_wall_climbing === true);
}

/**
 * Recover an immediate wall entry from its paid POS sale.
 *
 * The normal write path creates a check-in. This second source keeps the live
 * counter correct if that write is delayed or another server instance has not
 * seen it yet. Passes and memberships are intentionally excluded: their entry
 * is recorded when the pass is punched, not when it is bought.
 */
export function withPaidEntries({
  checkIns = [], sales = [], punches = [], today, dateOf, shiftStartedAt = null,
}) {
  const merged = [...(Array.isArray(checkIns) ? checkIns : [])];
  const entrants = new Set(todaysEntrants(merged, today, dateOf, shiftStartedAt).keys());

  for (const sale of Array.isArray(sales) ? sales : []) {
    const at = sale?.created_at || sale?.updated_at;
    if (sale?.status !== 'paid' || !inCurrentShift(at, { today, dateOf, shiftStartedAt })) continue;
    const lines = (Array.isArray(sale.items) ? sale.items : []).filter((line) => (
      line?.grants_wall_climbing === true
      && (line?.product_type || 'product') === 'product'
    ));
    for (const line of lines) {
      const participantIds = line?.participant_ids?.length
        ? line.participant_ids
        : [sale.student_id];
      for (const rawId of participantIds) {
        const studentId = rawId ? String(rawId) : '';
        if (!studentId || entrants.has(studentId)) continue;
        entrants.add(studentId);
        merged.push({
          id: `sale-entry:${sale.id}:${studentId}`,
          climber_id: studentId,
          timestamp: at,
          source: 'paid_pos_sale_recovery',
          sale_id: sale.id,
        });
      }
    }
  }

  // A punch is the payment event for a punch card. Unlike buying the card,
  // every successful, non-cancelled punch is an immediate wall entry.
  for (const punch of Array.isArray(punches) ? punches : []) {
    const at = punch?.punched_at || punch?.created_at;
    const studentId = punch?.student_id ? String(punch.student_id) : '';
    if (punch?.cancelled_at || !studentId || !inCurrentShift(at, { today, dateOf, shiftStartedAt })) continue;
    if (entrants.has(studentId)) continue;
    entrants.add(studentId);
    merged.push({
      id: `punch-entry:${punch.id}:${studentId}`,
      climber_id: studentId,
      timestamp: at,
      source: 'pass_punch',
      pass_punch_id: punch.id,
    });
  }
  return merged;
}
export function paymentRows({
  sales = [], payments = [], today, dateOf, shiftStartedAt = null, studentOf,
}) {
  return (Array.isArray(sales) ? sales : [])
    .filter((sale) => {
      if (sale?.payment_method !== 'online') return false;
      const payment = linkedPayment(sale, payments);
      if (effectiveSaleStatus(sale, payment) !== 'pending_payment') return false;
      const at = sale.created_at || sale.updated_at;
      return inCurrentShift(at, { today, dateOf, shiftStartedAt });
    })
    .map((sale) => {
      // השם הוא של מי שהכניסה עבורו, לא של מי ששילם. הורה שמשלם על הבן
      // הופיע ברשימה בשמו שלו, ואחרי התשלום הצטרפה שורה שנייה על שם הבן —
      // שני אנשים ברשימה על כניסה אחת.
      const student = sale.student_id && studentOf ? studentOf(sale.student_id) : null;
      return {
      id: `payment:${sale.id}`,
      kind: PENDING_KIND.PAYMENT,
      sale_id: sale.id,
      student_id: sale.student_id || null,
      name: student?.name || sale.customer_name || 'לקוח',
      payer_name: sale.customer_name || '',
      at: sale.created_at || sale.updated_at,
      pending: true,
      paid: false,
      paid_at: null,
      total: Number(sale.total) || 0,
      // „אפשר להכניס” נאמר רק על מכירה שקונה כניסה. זוג נעליים ששולם אינו
      // אישור כניסה, והכיתוב הזה על שורה של נעליים שולח מטפס לקיר בלי שקנה.
      grants_entry: saleGrantsEntry(sale),
      items: (Array.isArray(sale.items) ? sale.items : [])
        .map((line) => line?.name)
        .filter(Boolean)
        .join(', '),
      };
    });
}

/**
 * טבלה אחת של כל מי שממתין למשהו: תשלום בקישור, או תדריך ומבחן אבטחה.
 * מי שהכול אצלו סגור אינו כאן.
 *
 * הסדר הוא לפי ההגעה. אין כאן שורות שכבר שולמו רק כדי לאשר שראינו אותן.
 */
/**
 * שתי הרשימות של הדלפק.
 *
 * `pending` — מי שמשהו אצלו עוד פתוח: תשלום שלא שולם, או תדריך ומבחן.
 * `active`  — מי שנכנס, שילם ועבר את המבחן (או שלא נזקק לו). זו התמונה של
 * מי נמצא עכשיו על הקיר, וזה מידע אחר לגמרי מרשימת המשימות — ולכן שתי
 * לשוניות ולא טבלה אחת עם דגלים.
 */
/**
 * כל עסקאות הקופה של המשמרת — הלשונית „מכירות במשמרת”.
 *
 * מכירה במזומן או בסליקה במסופון אינה ממתינה לכלום: העובד שגבה אותה ראה את
 * הכסף. היא לא צריכה לעבור דרך רשימת המשימות, אבל היא כן צריכה להיות איפשהו
 * — אחרת אין בדלפק שום תמונה של מה נמכר במשמרת.
 *
 * קישור פתוח מופיע גם כאן וגם ב„ממתינים”, אבל עם תפקיד שונה: כאן הוא רשומת
 * העסקה והפעולות שלה; שם הוא משימה שהדלפק עדיין צריך לסגור. גם עסקאות שבוטלו
 * או זוכו נשארות כאן, כי יומן משמרת חייב להיות מלא ולא להעלים היסטוריה.
 */
export function shiftSales({
  sales = [], payments = [], today, dateOf, shiftStartedAt = null, studentOf, parentOf,
}) {
  return (Array.isArray(sales) ? sales : [])
    .filter((sale) => {
      const payment = linkedPayment(sale, payments);
      const status = effectiveSaleStatus(sale, payment);
      if (!['paid', 'pending_payment', 'refunded', 'cancelled'].includes(status)) return false;
      const activityTimes = [
        sale?.created_at,
        sale?.updated_at,
        sale?.paid_at,
        sale?.refunded_at,
        sale?.cancelled_at,
        payment?.paid_at,
        payment?.updated_at,
      ].filter(Boolean);
      return activityTimes.some((at) => inCurrentShift(at, { today, dateOf, shiftStartedAt }));
    })
    .map((sale) => {
      const payment = linkedPayment(sale, payments);
      const status = effectiveSaleStatus(sale, payment);
      const student = sale.student_id && studentOf ? studentOf(sale.student_id) : null;
      const parent = sale.parent_id && parentOf ? parentOf(sale.parent_id) : null;
      const lineItems = (Array.isArray(sale.items) ? sale.items : []).map((line) => ({
        name: line?.name || line?.description || 'פריט',
        description: line?.description || line?.name || 'פריט',
        quantity: Number(line?.quantity) || 1,
        unitprice: line?.unitprice == null ? null : Number(line.unitprice),
        total: line?.total == null ? null : Number(line.total),
      }));
      const activityAt = [
        sale.refunded_at,
        sale.cancelled_at,
        payment?.paid_at,
        sale.paid_at,
        sale.updated_at,
        sale.created_at,
      ].find(Boolean);
      return {
        id: `sale:${sale.id}`,
        sale_id: sale.id,
        student_id: sale.student_id || null,
        name: student?.name || sale.customer_name || 'לקוח',
        payer_name: sale.customer_name || '',
        at: activityAt,
        created_at: sale.created_at || null,
        updated_at: sale.updated_at || null,
        paid_at: payment?.paid_at || sale.paid_at || (status === 'paid' ? sale.updated_at : null),
        refunded_at: sale.refunded_at || null,
        cancelled_at: sale.cancelled_at || null,
        method: sale.payment_method || '',
        paid: status === 'paid',
        total: Number(sale.total) || 0,
        grants_entry: saleGrantsEntry(sale),
        seller_name: sale.sold_by || sale.employee_name || sale.seller_name || '',
        status,
        parent_id: sale.parent_id || null,
        customer_name: sale.customer_name || '',
        customer_phone: sale.customer_phone || '',
        customer_email: sale.customer_email || '',
        payment_id: sale.payment_id || payment?.id || null,
        payment_url: sale.payment_url || payment?.payment_url || null,
        doc_number: sale.icount_doc_number || payment?.icount_doc_number || null,
        refund_doc_number: sale.refund_doc_number || payment?.refund_doc_number || null,
        tendered_amount: sale.tendered_amount ?? null,
        change_given: sale.change_given ?? null,
        coupon_code: sale.coupon_code || null,
        coupon_discount: Number(sale.coupon_discount) || 0,
        // תיק הלקוח ב-iCount — קיים רק למי שכבר הופקה לו שם חשבונית.
        icount_client_id: parent?.icount_client_id || sale.icount_client_id || payment?.icount_client_id || null,
        refunded: status === 'refunded' || !!(sale.refund_doc_number || payment?.refund_doc_number),
        cancelled: status === 'cancelled',
        line_items: lineItems,
        items: lineItems
          .map((line) => line.name)
          .filter(Boolean)
          .join(', '),
      };
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

export function buildCounterQueues(parts) {
  const current = {
    ...parts,
    checkIns: withPaidEntries(parts || {}),
  };
  const pending = buildPendingQueue(current);
  const pendingStudents = new Set(pending.map((row) => row.student_id).filter(Boolean));
  const dismissed = new Set(current.dismissedIds || []);
  const active = entryRows({ ...current, includeSettled: true })
    .filter((row) => !row.needs_safety
      && !pendingStudents.has(row.student_id)
      && !dismissed.has(row.id))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { pending, active, sales: shiftSales(current) };
}

export function buildPendingQueue(parts) {
  // הסרה ידנית: לפעמים אדם הלך, ולפעמים הצוות יודע משהו שהמערכת לא. שורה
  // שהוסרה לא חוזרת באותו יום — אחרת ההסרה חסרת ערך והרשימה מפסיקה להיקרא.
  const dismissed = new Set(parts?.dismissedIds || []);
  const entries = entryRows(parts).filter((row) => !dismissed.has(row.id));
  const payments = paymentRows(parts).filter((row) => !dismissed.has(row.id));

  // אדם אחד = שורה אחת. תשלום שנפרע יוצר כניסה, והכניסה מוסיפה המתנה למבחן;
  // בלי האיחוד הזה אותו מתאמן מופיע פעמיים — פעם על הכסף ופעם על התדריך.
  const byStudent = new Map();
  const rows = [];
  for (const payment of payments) {
    if (!payment.student_id) { rows.push(payment); continue; }
    byStudent.set(payment.student_id, payment);
    rows.push(payment);
  }
  for (const entry of entries) {
    const merged = byStudent.get(entry.student_id);
    if (!merged) { rows.push(entry); continue; }
    merged.needs_safety = true;
    merged.state = entry.state;
    merged.expires_at = entry.expires_at;
  }

  return rows.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}
