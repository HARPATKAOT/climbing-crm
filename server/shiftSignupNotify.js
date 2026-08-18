/**
 * שתי ההודעות שמסביב לטופס המשמרות: „תמלא” בהתחלה, „זה השיבוץ שלך” בסוף.
 *
 * שתיהן יוצאות בוואטסאפ לעובד עצמו, ושתיהן נתקלות באותה מגבלה — אפשר לשלוח
 * טקסט חופשי רק למי שכתב לנו ב-24 השעות האחרונות. עובד שלא כתב חודש הוא בדיוק
 * המקרה הרגיל, ולכן כל שליחה כאן היא שני ניסיונות: קודם הטקסט המלא, ואם Meta
 * דוחה אותו — התבנית המאושרת שהעובד בחר בכרטיס שלו, אם בחר.
 *
 * מה שנכשל אינו נבלע: הפונקציות מחזירות שורה לכל עובד עם הסיבה, והמסך מציג
 * למי לא הגיע כדי שאפשר יהיה לשלוח לו את הקישור ידנית. הודעה שנעלמה בשקט היא
 * הדבר היחיד שגרוע יותר מהודעה שלא נשלחה.
 */

import { whatsappService } from './whatsapp.js';
import { chosenTemplateName } from './staffNotify.js';
import { assignmentMessageText, whenText } from './shiftSignup.js';

/** הזמנה למלא את הטופס. הקישור בשורה נפרדת — כך וואטסאפ הופך אותו ללחיץ. */
export function inviteText(windowRow, link) {
  const head = [
    '🗓️ פתחנו הרשמה למשמרות',
    windowRow?.title || '',
    windowRow?.note || '',
    windowRow?.deadline ? `אפשר לענות עד ${whenText({ date: windowRow.deadline })}` : '',
  ].filter(Boolean).join('\n');
  // הקישור בשורה משלו, אחרי שורה ריקה — כך וואטסאפ מזהה אותו ולא בולע אליו
  // את המילה שלפניו.
  return [head, 'סמנו מה מתאים לכם:', link].join('\n\n');
}

/**
 * שליחה אחת עם נפילה לתבנית.
 * @returns {{ ok: boolean, via?: 'text'|'template', reason?: string }}
 */
async function sendWithTemplateFallback(employee, text, { templateKind, variables = [], source }) {
  const phone = String(employee?.phone || '').trim();
  if (!phone) return { ok: false, reason: 'no_phone' };

  const direct = await whatsappService.sendTextMessage(phone, text, false, { source, clip: false });
  if (direct?.success) return { ok: true, via: 'text' };

  const templateName = templateKind ? chosenTemplateName(employee, templateKind) : null;
  if (!templateName) return { ok: false, reason: direct?.error || 'send_failed' };

  const viaTemplate = await whatsappService.sendTemplateMessage(phone, templateName, variables, {
    fallbackName: employee?.name || '',
  });
  return viaTemplate?.success
    ? { ok: true, via: 'template' }
    : { ok: false, reason: viaTemplate?.error || direct?.error || 'send_failed' };
}

const REASON_TEXT = {
  no_phone: 'אין טלפון בכרטיס העובד',
  send_failed: 'וואטסאפ דחה את ההודעה — כנראה מחוץ לחלון 24 השעות',
};

export function reasonLabel(reason) {
  return REASON_TEXT[reason] || reason || 'השליחה נכשלה';
}

/**
 * שליחת הקישור לרשימת עובדים.
 * @returns {Promise<{ sent: number, results: Array<{employee_id, name, ok, reason?}> }>}
 */
export async function sendSignupInvites({ windowRow, employees = [], link, linkFor = null } = {}) {
  const results = [];
  for (const employee of employees) {
    // קישור אישי כשיש כזה: הטופס נפתח על השם של מי שקיבל אותו, בלי לבחור מרשימה.
    const text = inviteText(windowRow, linkFor ? linkFor(employee) : link);
    // אין כאן `shift_signup_invite` ברשימת ההתראות, ולכן אין תבנית ליפול אליה:
    // ההזמנה נשלחת כטקסט או לא נשלחת, והמסך אומר את זה במפורש.
    const result = await sendWithTemplateFallback(employee, text, {
      templateKind: null,
      source: 'shift_signup',
    });
    results.push({
      employee_id: employee.id,
      name: employee.name || 'עובד/ת',
      ok: result.ok,
      ...(result.ok ? {} : { reason: reasonLabel(result.reason) }),
    });
  }
  return { sent: results.filter((r) => r.ok).length, results };
}

/**
 * הודעת השיבוץ — אחת לכל עובד, עם כל המשמרות שקיבל.
 *
 * @param {object} args `byEmployee` — מפה של employee_id למשמרות שאושרו לו
 */
export async function sendAssignmentSummaries({
  windowRow,
  byEmployee = new Map(),
  employees = [],
  // נוסח חלופי, לטופס שאין למשמרות שלו תאריך. הנפילה לתבנית משותפת בכוונה:
  // חלון 24 השעות של וואטסאפ הוא אותו חלון בשני סוגי הטפסים.
  textFor = null,
} = {}) {
  const employeeById = new Map((employees || []).map((e) => [String(e.id), e]));
  const results = [];
  for (const [employeeId, seats] of byEmployee) {
    const employee = employeeById.get(String(employeeId));
    if (!employee) continue;
    const first = seats[0]?.slot || {};
    const body = textFor ? textFor(seats) : assignmentMessageText(windowRow, seats);
    const result = await sendWithTemplateFallback(employee, body, {
      // התבנית מדברת על אירוע אחד, ולכן היא נושאת את הראשון בלבד. זו נפילה
      // מכוונת: עדיף שהעובד יידע על משמרת אחת ויתקשר, מאשר שלא יידע כלום.
      templateKind: 'shift_assigned',
      variables: [
        employee.name || '',
        first.label || windowRow?.title || 'משמרת',
        first.date || '',
        first.start_time || '',
      ],
      source: 'shift_signup',
    });
    results.push({
      employee_id: employeeId,
      name: employee.name || 'עובד/ת',
      shifts: seats.length,
      ok: result.ok,
      ...(result.ok ? {} : { reason: reasonLabel(result.reason) }),
    });
  }
  return { sent: results.filter((r) => r.ok).length, results };
}
