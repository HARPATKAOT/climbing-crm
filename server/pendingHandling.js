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
 * שורת תשלום **אינה נעלמת מעצמה כשהכסף מגיע**: היא נצבעת כ„שולם”, והמדריך
 * מסיר אותה בלחיצה. זו כל הנקודה — הלחיצה היא מה שמוודא שאדם אמיתי ראה
 * שהתשלום עבר, במקום ששורה תיעלם מהמסך בזמן שאיש לא הסתכל.
 *
 * טופס השתתפות חסר אינו כאן בכוונה: מי שלא חתם אינו יכול לקנות כניסה או
 * כרטיסייה מלכתחילה, ולכן הוא לא ממתין — הוא חסום, וזה נאמר בדלפק ברגע
 * שבוחרים אותו.
 */

export const PENDING_KIND = Object.freeze({ SAFETY: 'safety_test', PAYMENT: 'payment_link' });

/** מי שנכנס היום, לפי הכניסה האחרונה של כל אחד. */
export function todaysEntrants(checkIns = [], today, dateOf) {
  const seen = new Map();
  for (const row of Array.isArray(checkIns) ? checkIns : []) {
    const at = row?.timestamp || row?.created_at;
    if (!at || !row?.climber_id || dateOf(at) !== today) continue;
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
export function entryRows({ checkIns = [], today, dateOf, studentOf, safetyOf, includeSettled = false }) {
  const rows = [];
  for (const [studentId, at] of todaysEntrants(checkIns, today, dateOf)) {
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
 * שורות התשלום: קישורים שנשלחו היום ועוד לא נסגרו בלחיצת מדריך.
 *
 * שורה ששולמה ונוקתה כבר אינה כאן; שורה ששולמה ולא נוקתה נשארת דווקא כן —
 * היא ההודעה למדריך שהכסף נכנס.
 */
/** האם המכירה כוללת פריט שמקנה כניסה לקיר. */
export function saleGrantsEntry(sale) {
  return (Array.isArray(sale?.items) ? sale.items : [])
    .some((line) => line?.grants_wall_climbing === true);
}

export function paymentRows({ sales = [], today, dateOf, studentOf }) {
  return (Array.isArray(sales) ? sales : [])
    .filter((sale) => {
      if (sale?.payment_method !== 'online') return false;
      if (sale?.handled_at) return false;
      if (sale?.status !== 'pending_payment' && sale?.status !== 'paid') return false;
      const at = sale.created_at || sale.updated_at;
      return !!at && dateOf(at) === today;
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
      paid: sale.status === 'paid',
      paid_at: sale.status === 'paid' ? (sale.updated_at || null) : null,
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
 * הסדר הוא סדר הדחיפות ולא סדר השעה — מי שכבר שילם וממתין רק ללחיצה בראש,
 * ואחריו השאר לפי סדר ההגעה.
 */
/**
 * שתי הרשימות של הדלפק.
 *
 * `pending` — מי שמשהו אצלו עוד פתוח: תשלום שלא אושר, או תדריך ומבחן.
 * `active`  — מי שנכנס, שילם ועבר את המבחן (או שלא נזקק לו). זו התמונה של
 * מי נמצא עכשיו על הקיר, וזה מידע אחר לגמרי מרשימת המשימות — ולכן שתי
 * לשוניות ולא טבלה אחת עם דגלים.
 */
/**
 * כל המכירות של היום — הלשונית „מכירות במשמרת”.
 *
 * מכירה במזומן או בסליקה במסופון אינה ממתינה לכלום: העובד שגבה אותה ראה את
 * הכסף. היא לא צריכה לעבור דרך רשימת המשימות, אבל היא כן צריכה להיות איפשהו
 * — אחרת אין בדלפק שום תמונה של מה נמכר במשמרת.
 *
 * מכירה שעדיין ממתינה לטיפול אינה כאן: אדם אחד, מקום אחד. קישור תשלום פתוח
 * שמופיע גם ברשימת המשימות וגם במכירות נראה כמו שתי עסקאות.
 *
 * @param openSaleIds מזהי מכירות שנמצאות עכשיו ברשימת הממתינים
 */
export function shiftSales({
  sales = [], today, dateOf, studentOf, parentOf, openSaleIds = new Set(), dismissedIds = [],
}) {
  // שורה שהוסרה ביד לא חוזרת דרך הדלת האחורית: קישור שנשלח בסכום שגוי נמחק
  // מהרשימה, ואם הוא היה מופיע כאן ההסרה הייתה חסרת ערך.
  const dismissed = new Set(dismissedIds || []);
  return (Array.isArray(sales) ? sales : [])
    .filter((sale) => {
      const at = sale?.created_at || sale?.updated_at;
      if (!at || dateOf(at) !== today || sale?.status === 'cancelled') return false;
      if (dismissed.has(`payment:${sale.id}`)) return false;
      return !openSaleIds.has(String(sale.id));
    })
    .map((sale) => {
      const student = sale.student_id && studentOf ? studentOf(sale.student_id) : null;
      const parent = sale.parent_id && parentOf ? parentOf(sale.parent_id) : null;
      return {
        id: `sale:${sale.id}`,
        sale_id: sale.id,
        student_id: sale.student_id || null,
        name: student?.name || sale.customer_name || 'לקוח',
        payer_name: sale.customer_name || '',
        at: sale.created_at || sale.updated_at,
        method: sale.payment_method || '',
        paid: sale.status === 'paid',
        total: Number(sale.total) || 0,
        grants_entry: saleGrantsEntry(sale),
        seller_name: sale.employee_name || sale.seller_name || '',
        status: sale.status || '',
        parent_id: sale.parent_id || null,
        doc_number: sale.icount_doc_number || null,
        // תיק הלקוח ב-iCount — קיים רק למי שכבר הופקה לו שם חשבונית.
        icount_client_id: parent?.icount_client_id || null,
        refunded: sale.status === 'refunded' || !!sale.refund_doc_number,
        items: (Array.isArray(sale.items) ? sale.items : [])
          .map((line) => line?.name)
          .filter(Boolean)
          .join(', '),
      };
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

export function buildCounterQueues(parts) {
  const pending = buildPendingQueue(parts);
  const pendingStudents = new Set(pending.map((row) => row.student_id).filter(Boolean));
  const dismissed = new Set(parts?.dismissedIds || []);
  const active = entryRows({ ...parts, includeSettled: true })
    .filter((row) => !row.needs_safety
      && !pendingStudents.has(row.student_id)
      && !dismissed.has(row.id))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const openSaleIds = new Set(pending.map((row) => row.sale_id).filter(Boolean).map(String));
  return { pending, active, sales: shiftSales({ ...parts, openSaleIds }) };
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

  return rows.sort((a, b) => {
    if (!!b.paid !== !!a.paid) return b.paid ? 1 : -1;
    return String(a.at || '').localeCompare(String(b.at || ''));
  });
}
