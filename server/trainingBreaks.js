/**
 * החופשות מהחוגים, כפי שהן כבר יושבות ביומן.
 *
 * „מתי חופשת פסח מהחוגים?” היא שאלה שהתשובה לה קיימת במערכת מאז שהעונה
 * נבנתה: כל חופשה היא פעילות מסוג «חופשה מאימונים» עם תאריך התחלה וסיום,
 * ואותן רשומות הן שהופכות כל יום אימון שהן מכסות ל„יום חג” בנוכחות. לבוט
 * פשוט לא הייתה דרך להגיע אליהן, אז הוא העביר לצוות שאלה שהוא ידע לענות עליה.
 *
 * חופשה מהחוגים אינה אומרת שהקיר סגור — משמרת או שעות פתיחה ביומן פותחות
 * אותו גם בתוכה. שתי השאלות נפרדות, וכאן עונים רק על הראשונה.
 */

import { israelDateStr } from './attendanceUtils.js';
import { VACATION_ACTIVITY_TYPE } from './attendanceUtils.js';

function dayKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

/** מספר הימים שהחופשה מכסה, כולל היום הראשון והאחרון. */
export function breakLengthDays(from, to) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.round((end - start) / 86400000) + 1;
}

/**
 * החופשות שעוד לא הסתיימו, לפי סדר. חופשה שכבר עברה אינה תשובה לאף שאלה,
 * וחופשה שהתחילה אתמול ונמשכת עוד שבוע היא בהחלט כן.
 */
export function upcomingTrainingBreaks(db, { today = israelDateStr(), limit = 12 } = {}) {
  return (db.get('activities') || [])
    .filter((activity) => {
      if (!activity || activity.type !== VACATION_ACTIVITY_TYPE) return false;
      if (activity.cancelled || activity.status === 'cancelled') return false;
      const from = dayKey(activity.date);
      if (!from) return false;
      const to = dayKey(activity.end_date) || from;
      return (to >= from ? to : from) >= today;
    })
    .map((activity) => {
      const from = dayKey(activity.date);
      const rawTo = dayKey(activity.end_date);
      const to = rawTo && rawTo > from ? rawTo : from;
      return {
        name: String(activity.name || '').trim() || 'חופשה מהחוגים',
        from,
        to,
        days: breakLengthDays(from, to),
      };
    })
    .sort((a, b) => a.from.localeCompare(b.from))
    .slice(0, limit);
}
