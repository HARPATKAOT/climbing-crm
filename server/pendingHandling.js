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
export function entryRows({ checkIns = [], today, dateOf, studentOf, safetyOf }) {
  const rows = [];
  for (const [studentId, at] of todaysEntrants(checkIns, today, dateOf)) {
    const student = studentOf(studentId);
    if (!student) continue;
    const safety = safetyOf(studentId) || { state: 'missing' };
    if (safety.state === 'valid') continue;
    rows.push({
      id: `entry:${studentId}`,
      kind: PENDING_KIND.SAFETY,
      student_id: studentId,
      name: student.name,
      at,
      pending: true,
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
export function paymentRows({ sales = [], today, dateOf }) {
  return (Array.isArray(sales) ? sales : [])
    .filter((sale) => {
      if (sale?.payment_method !== 'online') return false;
      if (sale?.handled_at) return false;
      if (sale?.status !== 'pending_payment' && sale?.status !== 'paid') return false;
      const at = sale.created_at || sale.updated_at;
      return !!at && dateOf(at) === today;
    })
    .map((sale) => ({
      id: `payment:${sale.id}`,
      kind: PENDING_KIND.PAYMENT,
      sale_id: sale.id,
      student_id: sale.student_id || null,
      name: sale.customer_name || 'לקוח',
      at: sale.created_at || sale.updated_at,
      pending: true,
      paid: sale.status === 'paid',
      paid_at: sale.status === 'paid' ? (sale.updated_at || null) : null,
      total: Number(sale.total) || 0,
      items: (Array.isArray(sale.items) ? sale.items : [])
        .map((line) => line?.name)
        .filter(Boolean)
        .join(', '),
    }));
}

/**
 * טבלה אחת של כל מי שממתין למשהו: תשלום בקישור, או תדריך ומבחן אבטחה.
 * מי שהכול אצלו סגור אינו כאן.
 *
 * הסדר הוא סדר הדחיפות ולא סדר השעה — מי שכבר שילם וממתין רק ללחיצה בראש,
 * ואחריו השאר לפי סדר ההגעה.
 */
export function buildPendingQueue(parts) {
  const rows = [...entryRows(parts), ...paymentRows(parts)];
  return rows.sort((a, b) => {
    if (!!b.paid !== !!a.paid) return b.paid ? 1 : -1;
    return String(a.at || '').localeCompare(String(b.at || ''));
  });
}
