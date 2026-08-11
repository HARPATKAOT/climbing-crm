/**
 * מתי המתאמן היה כאן בפעם האחרונה.
 *
 * לדלפקיסט זה המידע שמחליף היכרות אישית: מי שלא היה חצי שנה צריך ריענון
 * תדריך, ומי שהיה אתמול לא צריך שישאלו אותו כלום. התשובה מורכבת משני מקורות
 * שאף אחד מהם אינו שלם לבדו — נוכחות בחוג היא הכניסה של מי שמתאמן בקבוצה,
 * ויומן הכניסות הוא הכניסה של מי שבא לטפס חופשי — ולכן נלקח המאוחר מביניהם.
 *
 * נוכחות עתידית לא נספרת: שורות נוכחות נוצרות מראש לכל מפגש מתוכנן, וסטטוס
 * `pending` של מחר אינו ביקור.
 */

import { normalizeAttStatus } from './attendanceUtils.js';

/** סטטוסי נוכחות שמשמעם שהמתאמן אכן הגיע. */
const PRESENT_STATUSES = new Set(['attended', 'makeup', 'saturday_makeup', 'intro_attended']);

/**
 * מספר הימים שחלפו, בלוח השנה ולא בשעון.
 *
 * חישוב לפי הפרש שעות אמר „היה כאן היום” על מי שנכנס אתמול בערב, כי לא עברו
 * 24 שעות. הדלפקיסט קורא את המשפט הזה כדי להחליט אם צריך ריענון תדריך —
 * ולכן הגבול הוא חצות, בדיוק כמו שהוא חושב על זה.
 */
function calendarDaysBetween(fromMs, toMs) {
  const midnight = (ms) => {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  return Math.max(0, Math.round((midnight(toMs) - midnight(fromMs)) / 86400000));
}

const toTime = (value) => {
  if (!value) return NaN;
  const raw = String(value);
  // תאריך בלבד (שורת נוכחות) נחשב לצהריים, כדי שלא ייפול ליום הקודם באזור זמן אחר.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);
  return d.getTime();
};

/** הכניסה האחרונה מיומן הכניסות לקיר. */
export function lastWallEntry(checkIns = [], studentId) {
  let best = null;
  for (const row of Array.isArray(checkIns) ? checkIns : []) {
    if (String(row?.climber_id || '') !== String(studentId)) continue;
    const time = toTime(row.timestamp || row.created_at);
    if (!Number.isFinite(time)) continue;
    if (!best || time > best.time) best = { time, at: row.timestamp || row.created_at };
  }
  return best;
}

/** המפגש האחרון בחוג שהמתאמן נכח בו. */
export function lastClassAttendance(attendance = [], studentId, now = new Date()) {
  const ceiling = (now instanceof Date ? now : new Date(now)).getTime();
  let best = null;
  for (const row of Array.isArray(attendance) ? attendance : []) {
    if (String(row?.student_id || '') !== String(studentId)) continue;
    if (!PRESENT_STATUSES.has(normalizeAttStatus(row.status))) continue;
    const time = toTime(row.date);
    if (!Number.isFinite(time) || time > ceiling) continue;
    if (!best || time > best.time) best = { time, at: row.date };
  }
  return best;
}

/**
 * הביקור האחרון, מכל מקור.
 *
 * @returns {{last_at:string|null, source:'wall'|'class'|null, days_ago:number|null}}
 */
export function lastVisit({ checkIns = [], attendance = [], studentId } = {}, now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  const wall = lastWallEntry(checkIns, studentId);
  const cls = lastClassAttendance(attendance, studentId, at);
  const best = !wall ? cls : !cls ? wall : (wall.time >= cls.time ? wall : cls);
  if (!best) return { last_at: null, source: null, days_ago: null };
  return {
    last_at: best.at,
    source: best === wall ? 'wall' : 'class',
    days_ago: calendarDaysBetween(best.time, at.getTime()),
  };
}

/** התווית שמוצגת בדלפק. */
export function lastVisitLabel(visit) {
  if (!visit?.last_at) return 'לא נרשמה כניסה קודמת';
  const where = visit.source === 'class' ? 'חוג' : 'קיר';
  if (visit.days_ago === 0) return `היה כאן היום (${where})`;
  if (visit.days_ago === 1) return `היה כאן אתמול (${where})`;
  if (visit.days_ago < 30) return `כניסה אחרונה לפני ${visit.days_ago} ימים (${where})`;
  const months = Math.round(visit.days_ago / 30);
  if (months < 12) return `כניסה אחרונה לפני ${months} חודשים (${where})`;
  const years = Math.floor(visit.days_ago / 365);
  return `כניסה אחרונה לפני יותר מ-${years === 1 ? 'שנה' : `${years} שנים`} (${where})`;
}
