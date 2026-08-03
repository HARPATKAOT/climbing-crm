/**
 * תזכורות שהבוט קובע לעצמו.
 *
 * לקוח שאומר „תבדוק איתי מחר” קיבל עד היום תשובה מנומסת ותו לא — לבוט לא היה
 * שום מקום לרשום בו שהוא הבטיח משהו, ולמחרת אף אחד לא חזר. אותו חור בדיוק
 * נפער אחרי שיבוץ „ממתין להרשמה”: הקישור נשלח, ואם ההורה לא נרשם — איש לא ידע.
 *
 * הרשומות נשמרות באוסף הכללי `bot_followups` (kv_collections), באותו דפוס של
 * `activity_interest`, כדי שלא תידרש מיגרציה על מסד נעול.
 *
 * מה שנשמר הוא *מה הובטח*, לא נוסח ההודעה: את הניסוח עושים ברגע השליחה, כדי
 * שהודעת המעקב תישמע כמו המשך שיחה ולא כמו הדבקה של טקסט מלפני יום.
 */

import { israelDateStr } from './attendanceUtils.js';

export const FOLLOWUP_COLLECTION = 'bot_followups';

export const FOLLOWUP_OPEN = 'open';
export const FOLLOWUP_SENT = 'sent';
export const FOLLOWUP_CANCELLED = 'cancelled';

/** Why the bot is coming back. The reason decides the wording, not the model. */
export const FOLLOWUP_REASONS = new Set([
  'customer_asked',   // "תבדוק איתי מחר"
  'pending_signup',   // נשלח קישור הרשמה — לבדוק אם נרשמו
  'general',
]);

/** Never more than a fortnight out: past that it is a task, not a follow-up. */
const MAX_DAYS_AHEAD = 14;

function clean(value) {
  return String(value ?? '').trim();
}

/**
 * The generic id is the table prefix plus a millisecond, so two follow-ups born
 * in the same tick — a placement and a "check with me tomorrow" in one turn —
 * came out sharing an id, and only one of them was ever sent. A random suffix
 * is what keeps them apart.
 */
export function newFollowUpId() {
  return `bf${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export function followUpRows(db) {
  const rows = db.get(FOLLOWUP_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

/**
 * `days` beats an explicit date: the model is far better at "מחר" than at
 * working out today's date, and a date it invents lands in the past.
 */
export function resolveDueDate({ days = null, dueDate = '', today = israelDateStr() } = {}) {
  // Number(null) is 0, so a missing `days` used to read as "today" — a promise
  // to come back tomorrow would have gone out the same afternoon.
  const given = days !== null && days !== undefined && days !== '';
  const requested = given ? Number(days) : NaN;
  if (Number.isFinite(requested) && requested >= 0) {
    const base = new Date(`${today}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + Math.min(MAX_DAYS_AHEAD, Math.round(requested)));
    return base.toISOString().slice(0, 10);
  }
  const explicit = clean(dueDate).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit) && explicit >= today) {
    const limit = new Date(`${today}T12:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + MAX_DAYS_AHEAD);
    return explicit <= limit.toISOString().slice(0, 10) ? explicit : limit.toISOString().slice(0, 10);
  }
  return null;
}

/** One open follow-up per customer per reason — a chat that circles back to the
 *  same promise must not turn into three messages the next morning. */
export function findOpenFollowUp(db, { parentId, reason }) {
  return followUpRows(db).find(
    (row) => String(row.parent_id || '') === String(parentId)
      && String(row.reason || '') === String(reason)
      && String(row.status || FOLLOWUP_OPEN) === FOLLOWUP_OPEN
  ) || null;
}

export function dueFollowUps(db, { today = israelDateStr() } = {}) {
  return followUpRows(db)
    .filter((row) => String(row.status || FOLLOWUP_OPEN) === FOLLOWUP_OPEN)
    .filter((row) => clean(row.due_date) && clean(row.due_date) <= today)
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')));
}

/**
 * The message the customer gets. Built from what was promised, so "תבדוק איתי
 * מחר" comes back as that subject and a placement comes back asking about the
 * registration — never as a generic "just checking in".
 */
export function followUpMessage(row, { firstName = '' } = {}) {
  const hello = firstName ? `היי ${firstName},` : 'היי,';
  const note = clean(row?.note);
  if (String(row?.reason) === 'pending_signup') {
    const child = clean(row?.subject);
    return [
      `${hello} רק בודק מה קורה 🙂`,
      child
        ? `הספקתם להשלים את ההרשמה של ${child} במתנ״ס?`
        : 'הספקתם להשלים את ההרשמה במתנ״ס?',
      'אם נתקלתם במשהו — כתבו לי ואשמח לעזור.',
    ].join('\n');
  }
  return [
    `${hello} חוזר אליכם כמו שסיכמנו 🙂`,
    note ? `לגבי ${note} — יש התקדמות?` : 'יש התקדמות בעניין שדיברנו עליו?',
  ].join('\n');
}
