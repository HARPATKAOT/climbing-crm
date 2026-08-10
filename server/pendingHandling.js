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
 * שורות הכניסות של היום.
 *
 * כאן נמצאת **כל** מי שנכנס, ולא רק מי שחסר לו משהו: יומן הכניסות ורשימת
 * הממתינים היו שתי טבלאות שהציגו את אותם אנשים בזו אחר זו, וקריאת שתיהן
 * דרשה להצליב ביניהן. מי שחסר לו תדריך ומבחן מסומן ב-`pending`, וזה כל ההבדל.
 *
 * @param safetyOf (studentId) => {state, expires_at, test_date}
 */
export function entryRows({ checkIns = [], today, dateOf, studentOf, safetyOf, lastCheckInOf }) {
  const rows = [];
  for (const [studentId, at] of todaysEntrants(checkIns, today, dateOf)) {
    const student = studentOf(studentId);
    if (!student) continue;
    const safety = safetyOf(studentId) || { state: 'missing' };
    const entry = lastCheckInOf ? lastCheckInOf(studentId) : null;
    rows.push({
      id: `entry:${studentId}`,
      kind: PENDING_KIND.SAFETY,
      student_id: studentId,
      name: student.name,
      at,
      pending: safety.state !== 'valid',
      state: safety.state,
      expires_at: safety.expires_at || null,
      group_name: entry?.group_name || '',
      documents_state: entry?.documents_state
        || (entry?.medical_approved ? 'valid' : 'missing'),
      documents_label: entry?.documents_label
        || (entry?.medical_approved ? 'תקין' : 'חסרה הצהרה'),
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
 * כל היום בדלפק בטבלה אחת: כניסות וקישורי תשלום.
 *
 * הסדר הוא סדר הדחיפות ולא סדר השעה — מי שכבר שילם וממתין ללחיצה בראש,
 * אחריו כל השאר שדורש טיפול, ומי שהכול אצלו סגור יורד למטה. כך העין נופלת
 * ראשונה על מה שדורש פעולה, בלי לוותר על התמונה המלאה של היום.
 */
export function buildPendingQueue(parts) {
  const rows = [...entryRows(parts), ...paymentRows(parts)];
  const rank = (row) => (row.paid ? 0 : row.pending ? 1 : 2);
  return rows.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return String(b.at || '').localeCompare(String(a.at || ''));
  });
}
