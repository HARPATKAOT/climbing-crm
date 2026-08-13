/**
 * „מנהל אישר לכם זכאות” — ההודעה שיוצאת ברגע שמסמנים זכאות למתקדמים.
 *
 * הסימון בתיק המתאמן היה עד היום החלטה שנשארה אצלנו: המנהל אישר, ואיש לא
 * סיפר להורה. עכשיו הסימון עצמו פותח את השיחה, וההמשך — איזו קבוצה, איזו
 * תדירות, הקישורים — הוא בדיוק מה שהבוט כבר יודע לעשות ברגע שההורה עונה.
 *
 * שולחים פעם אחת בלבד: שמירה חוזרת של הכרטיס אינה אירוע חדש, וזכאות שבוטלה
 * ונדלקה שוב היא כן — לכן החותמת יושבת על שורת הזכאות ולא על המתאמן.
 *
 * מחוץ לחלון 24 השעות אין טקסט חופשי ואין לזה תבנית מאושרת, ולכן ההודעה
 * עוברת לצוות במקום להיעלם. זה אותו כלל של המעקבים: כישלון שקט הוא הדבר
 * היחיד שאסור כאן.
 */

export const ELIGIBILITY_NOTICE_COLLECTION = 'program_eligibility';

function approvalWord(gender = '') {
  const normalized = String(gender || '').toLowerCase();
  if (/נקבה|female|בת/u.test(normalized)) return 'מאושרת';
  if (/זכר|male|בן/u.test(normalized)) return 'מאושר';
  return 'מאושר/ת';
}

/** קצר, אישי, ומציין את הקבוצה שבאמת אושרה. */
export function eligibilityNoticeMessage({ studentName = 'המתאמן', groupName = 'קבוצת מתקדמים', gender = '' } = {}) {
  return [
    `${studentName} ${approvalWord(gender)} להרשמה ל${groupName}.`,
    'האם תרצו להמשיך בהרשמה?',
  ].join('\n');
}

/** מה הצוות צריך לדעת כשהחלון סגור ואי אפשר לכתוב ללקוח. */
export function eligibilityStaffNotice({ studentName = '', groupName = '', parentName = '', phone = '' } = {}) {
  return [
    '🎯 אושרה זכאות — צריך להודיע ללקוח',
    `${studentName || 'מתאמן'} · ${groupName || 'מתקדמים/נבחרת'} · ${parentName || '—'} · ${phone || ''}`,
    '← חלון 24 השעות סגור, הבוט לא יכול לפתוח שיחה',
  ].join('\n');
}

/**
 * @param {object} deps
 * @param {object} deps.row שורת הזכאות שנוצרה/עודכנה — עליה נחתמת השליחה
 * @param {function} deps.sendReply (phone, text) => Promise
 * @param {function} deps.notifyStaff (text) => Promise
 */
export async function announceProgramEligibility({
  db,
  persist,
  student,
  parent,
  row,
  windowOpen = false,
  sendReply,
  notifyStaff,
  now = new Date(),
} = {}) {
  if (!row?.id) return { ok: false, reason: 'no_eligibility_row' };
  if (row.notified_at || row.staff_notified_at) return { ok: true, skipped: 'already_announced' };
  const phone = String(parent?.phone || '').trim();
  if (!parent || !phone) return { ok: false, reason: 'no_phone' };

  const stamp = new Date(now).toISOString();
  const group = db?.getOne?.('groups', row.group_id) || null;
  const groupName = String(group?.name || '').trim() || 'קבוצת מתקדמים או נבחרת';
  const mark = async (patch) => {
    const updated = db?.update?.(ELIGIBILITY_NOTICE_COLLECTION, row.id, { ...patch, updated_at: stamp });
    if (updated && typeof persist === 'function') await persist(ELIGIBILITY_NOTICE_COLLECTION, updated);
    return updated;
  };

  if (!windowOpen) {
    await notifyStaff?.(eligibilityStaffNotice({
      studentName: student?.name || '',
      groupName,
      parentName: parent?.name || '',
      phone,
    }));
    await mark({ staff_notified_at: stamp });
    return { ok: true, sent: false, handedToStaff: true };
  }

  const result = await sendReply?.(phone, eligibilityNoticeMessage({
    studentName: student?.name || 'המתאמן',
    groupName,
    gender: student?.gender || '',
  }));
  if (!result?.success) return { ok: false, reason: 'send_failed', error: result?.error || '' };
  await mark({ notified_at: stamp });
  return { ok: true, sent: true };
}
