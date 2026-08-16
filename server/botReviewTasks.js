/**
 * משימת בדיקה לצוות על כל דבר שהבוט שינה.
 *
 * היומן (`botActivityLog`) עונה על „מה הבוט עשה היום” — אבל צריך מישהו שיפתח
 * אותו. כרמית כותבת שילד נרשם, הבוט מסמן אותו כרשום, וזה נכון ברוב המקרים;
 * המקרה שבו זה לא נכון נראה בדיוק אותו דבר מבפנים. לכן כל שינוי פותח שורה
 * ב„משימות” — התור שהצוות ממילא עובר עליו — עד שנראה שזה עובד טוב, ואז אפשר
 * לכבות את זה במתג אחד.
 *
 * שני חוקים שאסור לשבור כאן:
 * - לעולם לא לזרוק. שיבוץ שנופל כי לא נוצרה משימת בדיקה הוא גרוע מבלי בדיקה.
 * - לא מציפים. הרבה פעולות על אותו מתאמן באותו יום הן משימה אחת, לא חמש.
 */

import { TASKS_COLLECTION, TASK_OPEN } from './aiActions.js';
import { actionTypeMeta, ACTION_KIND } from './botActivityLog.js';
import { isCapabilityEnabled } from './botCapabilities.js';
import { israelDateStr } from './attendanceUtils.js';

export const REVIEW_TASK_SOURCE = 'bot_review';
export const REVIEW_TASK_CAPABILITY = 'review_tasks';

/** מתג יחיד בלוח היכולות, לכיבוי כשהבוט יוכיח את עצמו. ברירת המחדל: פתוח. */
export function reviewTasksEnabled(settings) {
  return isCapabilityEnabled(settings || {}, REVIEW_TASK_CAPABILITY);
}

function clean(value, max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * אותה פעולה, על אותו אדם, באותו יום — שורה אחת.
 *
 * תור בדיקה שמקבל חמש שורות על שיחה אחת נקרא כמו רעש, ואז לא קוראים אותו
 * בכלל; זו בדיוק התוצאה שהמשימות האלה נועדו למנוע.
 */
export function reviewTaskFingerprint(entry = {}, today = israelDateStr()) {
  const who = entry.studentId || entry.parentId || entry.phone || 'unknown';
  return `${REVIEW_TASK_SOURCE}:${entry.type || 'other'}:${who}:${today}`;
}

export function openReviewTaskFor(db, fingerprint) {
  return (db.get(TASKS_COLLECTION) || []).find((row) => (
    String(row.fingerprint || '') === String(fingerprint)
    && String(row.status || TASK_OPEN) === TASK_OPEN
  )) || null;
}

export function reviewTaskTitle(entry = {}) {
  const meta = actionTypeMeta(entry.type);
  const who = clean(entry.studentName || entry.parentName, 60);
  return clean(`${meta.icon} לבדוק: ${meta.label}${who ? ` — ${who}` : ''}`, 120);
}

/**
 * Open one review task for a journal entry. Best-effort in every direction:
 * a disabled switch, a message-kind entry, a duplicate, or a failed write all
 * return null rather than raising into the caller's action.
 */
export function openBotReviewTask(db, persist, entry = {}, { today = israelDateStr() } = {}) {
  try {
    const meta = actionTypeMeta(entry.type);
    if (meta.kind !== ACTION_KIND) return null;
    if (!reviewTasksEnabled(db.getSettings?.() || {})) return null;

    const fingerprint = reviewTaskFingerprint(entry, today);
    const existing = openReviewTaskFor(db, fingerprint);
    if (existing) return existing;

    const task = db.insert(TASKS_COLLECTION, {
      title: reviewTaskTitle(entry),
      status: TASK_OPEN,
      priority: 'normal',
      due_date: today,
      parent_id: entry.parentId || null,
      student_id: entry.studentId || null,
      // The summary is what the journal already wrote, so the person reading
      // the task sees the sentence rather than having to go looking for it.
      notes: clean(entry.summary, 300),
      source: REVIEW_TASK_SOURCE,
      suggestion_id: null,
      fingerprint,
      completed_at: null,
      created_by: 'bot',
    });
    if (persist && task?.id) {
      Promise.resolve(persist(TASKS_COLLECTION, task)).catch((err) =>
        console.error('bot review task persist failed:', err?.message || err));
    }
    return task;
  } catch (err) {
    console.error('bot review task failed:', err?.message || err);
    return null;
  }
}
