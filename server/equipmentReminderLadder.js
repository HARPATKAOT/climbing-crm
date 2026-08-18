/**
 * כמה פעמים מזכירים על ציוד, ומתי מפסיקים.
 *
 * ההרשמה במתנ״ס היא מועד אחרון: שלושה ימים, ואז המקום באמת מתבטל — ולכן שם
 * תזכורת אחת חדה ביום האחרון. ציוד אינו כזה. הילד יתאמן גם בלי שהערכה
 * הוסדרה, והנעליים הן השכרה ולא תנאי כניסה. לכן מעט תזכורות, רחוקות זו מזו,
 * ובסוף עצירה.
 *
 * ## הסולם
 *
 * שלוש פניות: אחרי שלושה ימים, אחרי עשרה, ואחרי עשרים וארבעה. הרווח גדל כי
 * כל תזכורת שלא הניבה תגובה מלמדת שההורה לא במצב לטפל בזה עכשיו, ולא שהוא לא
 * שמע. אחרי השלישית לא נשלחת רביעית — נפתחת שורה במשימות הצוות, ומישהו מרים
 * טלפון או מדבר איתו באימון.
 *
 * ## ולא לפני שיש בזה טעם
 *
 * לפני תחילת העונה אין מה להסדיר בדחיפות. הרגע המועיל הוא כשבוע לפני האימון
 * הראשון של הילד, ולפניו כל תזכורת היא רעש.
 */

import { israelDateStr } from './attendanceUtils.js';
import { israelTimeToEpoch } from './shiftAlerts.js';

/** בכמה ימים מהשליחה יוצאת כל פנייה. */
export const LADDER_DAYS = Object.freeze([3, 10, 24]);

/** כמה זמן לפני האימון הראשון מתחילים בכלל להזכיר. */
export const LEAD_DAYS_BEFORE_FIRST_SESSION = 7;

export const EQUIPMENT_REASON = 'equipment_unpaid';

/** הפנייה הבאה בסולם, או null כשהסולם מוצה. */
export function nextLadderDelay(attempt = 0) {
  const next = Number(attempt) || 0;
  return next < LADDER_DAYS.length ? LADDER_DAYS[next] : null;
}

export function ladderExhausted(attempt = 0) {
  return (Number(attempt) || 0) >= LADDER_DAYS.length;
}

function addDays(fromIso, days) {
  const base = new Date(`${String(fromIso).slice(0, 10)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * מתי הפנייה הבאה יוצאת: המרווח מהסולם, אבל אף פעם לא לפני שבוע לפני האימון
 * הראשון.
 *
 * @returns {{ due_at: string, due_date: string, needs_template: true }|null}
 */
export function ladderPlan({
  attempt = 0,
  now = new Date(),
  firstSessionDate = '',
} = {}) {
  const delay = nextLadderDelay(attempt);
  if (delay === null) return null;

  const today = israelDateStr(new Date(now));
  let date = addDays(today, delay);
  const opening = String(firstSessionDate || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(opening)) {
    const earliest = addDays(opening, -LEAD_DAYS_BEFORE_FIRST_SESSION);
    if (date < earliest) date = earliest;
  }
  return {
    due_at: new Date(israelTimeToEpoch(date, '09:00')).toISOString(),
    due_date: date,
    needs_template: true,
  };
}

/**
 * The trainee's first training day of the season — the same calculation the
 * centre report uses, so a parent is never chased before there is anything to
 * be ready for.
 */
export function firstSessionForGroups(groups = [], { seasonStart = '', weekdays = [] } = {}) {
  const start = String(seasonStart || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return '';
  const days = new Set((weekdays.length ? weekdays : (groups || []).flatMap((g) => g?.trainingDays || []))
    .map(Number).filter(Number.isInteger));
  if (!days.size) return '';
  const cursor = new Date(`${start}T12:00:00Z`);
  for (let step = 0; step < 7; step += 1) {
    if (days.has(cursor.getUTCDay())) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return '';
}
