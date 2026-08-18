/**
 * יומן המשמרות של עובד יחיד — כל מה שהוא עבד וכל מה שמחכה לו, ברשימה אחת.
 *
 * המשמרות של עובד לא יושבות במקום אחד: משמרת שנסגרה בשעון והפכה לשורת עבודה,
 * חוג שסומנה בו נוכחות צוות, אירוע ששובץ אליו — כולם נכתבים ל־work_assignments.
 * מה שעוד לא קרה כלל אינו כתוב בשום מקום: חוג שבועי קבוע קיים רק בהגדרת
 * הקבוצה (יום בשבוע + שעה), ולכן את המשמרות העתידיות שלו צריך לגזור.
 *
 * הפונקציה כאן מאחדת את ארבעת המקורות ומחזירה רשימה אחת ממוינת לפי תאריך:
 *   - work_assignments  → משמרת שנרשמה (status: 'logged')
 *   - staff_attendance  → היעדרות מחוג (status: 'absent'), וגם שעות עוזר מדריך
 *                         שאין להן שורת שכר
 *   - הגדרת הקבוצות     → חוגים עתידיים קבועים (status: 'planned')
 *   - shift_hours פתוח  → משמרת שרצה עכשיו (status: 'open')
 *
 * העתיד נגזר רק עד אופק מוגדר (ברירת מחדל 60 יום) — חוג שבועי הוא אינסופי
 * מטבעו, ורשימה אינסופית אינה יומן.
 */

import {
  getGroupDays,
  israelDateStr,
  findTrainingVacation,
} from './attendanceUtils.js';

/** התפקידים בחוג שמשולם עליהם. עוזר מדריך מתנדב — שעותיו נספרות, לא משולמות. */
const PAID_CLASS_ROLES = new Set(['trainer']);

const CLASS_ROLE_LABEL = {
  trainer: 'הדרכת חוג',
  assistant: 'עוזר מדריך',
};

/** שורות ותיקות נשמרו בלי תפקיד — סוג העבודה הוא הכותרת הכי טובה שיש להן. */
const WORK_TYPE_LABEL = {
  counter_shift: 'דלפק',
  class_shift: 'חוג',
  private_shift: 'אימון פרטי',
  route_building_shift: 'בניית מסלולים',
};

/** YYYY-MM-DD של היום ה־n אחרי תאריך נתון, בלי להיגרר לאזור זמן. */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0=ראשון … 6=שבת, מתוך תאריך אזרחי. חצות UTC היה מזיז יום בישראל. */
function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/** שעת הסיום של חוג לפי משכו, כדי שגם משמרת עתידית תציג טווח שעות. */
function endTimeOf(start, durationMinutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(start || ''));
  const minutes = Number(durationMinutes);
  if (!m || !Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function hoursOf(durationMinutes) {
  const minutes = Number(durationMinutes) || 50;
  // חוג של 50 דקות משולם כשעה — עיגול לחצי שעה כלפי מעלה, כמו במסך השכר.
  return Math.ceil((minutes / 60) * 2) / 2;
}

/** המפתח שמונע כפילות בין חוג שנגזר מהלוח לבין רישום אמיתי לאותו יום. */
const groupDayKey = (groupId, date) => `${groupId || ''}|${date || ''}`;

/**
 * @param {object} input
 * @param {string} input.employeeId
 * @param {Array}  input.workAssignments  כל שורות העבודה במערכת
 * @param {Array}  input.staffAttendance  כל נוכחויות הצוות בחוגים
 * @param {Array}  input.groups           הקבוצות, בשביל החוגים הקבועים העתידיים
 * @param {Array}  input.activities       בשביל שמות אירועים ובשביל חופשות
 * @param {Array}  input.shiftHours       רישומי שעון — רק הפתוחים נחוצים כאן
 * @param {string} [input.today]          YYYY-MM-DD; ברירת מחדל היום בישראל
 * @param {number} [input.horizonDays]    כמה ימים קדימה לגזור חוגים קבועים
 * @returns {{ today: string, horizon: string, entries: Array }}
 */
export function buildShiftJournal({
  employeeId,
  workAssignments = [],
  staffAttendance = [],
  groups = [],
  activities = [],
  shiftHours = [],
  today = null,
  horizonDays = 60,
} = {}) {
  const now = today || israelDateStr();
  const horizon = addDays(now, Math.max(0, Number(horizonDays) || 0));
  const entries = [];
  /** ימי חוג שכבר יש להם רישום — לא נגזור עליהם משמרת מתוכננת. */
  const covered = new Set();

  const activityName = (id) => (activities.find((a) => a.id === id)?.name) || '';

  // 1. שורות עבודה — משמרת שנרשמה, בעבר או בעתיד (אירוע ששובץ מראש).
  for (const row of workAssignments) {
    if (row.employee_id !== employeeId || !row.date) continue;
    if (row.group_id) covered.add(groupDayKey(row.group_id, row.date));
    entries.push({
      key: `work:${row.id}`,
      date: row.date,
      start_time: row.start_time || null,
      end_time: row.end_time || null,
      hours: Number(row.hours) || 0,
      title: row.role || WORK_TYPE_LABEL[row.work_type] || 'משמרת',
      subtitle: row.activity_id ? activityName(row.activity_id) : '',
      work_type: row.work_type || null,
      group_id: row.group_id || null,
      activity_id: row.activity_id || null,
      status: 'logged',
      paid: true,
      pay_amount: Number(row.pay_amount) || 0,
      approved: !!row.approved,
      source: row.source || 'manual',
      notes: row.notes || '',
    });
  }

  // 2. נוכחות צוות בחוג: היעדרות היא חלק מהיומן, ושעות עוזר מדריך אינן מייצרות
  //    שורת שכר — בלי השורות האלה חצי מהעבר של עוזר מדריך פשוט נעלם.
  for (const row of staffAttendance) {
    if (row.employee_id !== employeeId || !row.date) continue;
    // שורת נוכחות של אירוע ביומן — לאירוע כבר יש שורה משלו ביומן העבודה,
    // והיא זו שמופיעה כאן. בלי הדילוג `groupDayKey(undefined, date)` היה מפתח
    // אחד לכל אירועי אותו יום, וכל אחד מהם היה מכסה את השני.
    if (!row.group_id) continue;
    const key = groupDayKey(row.group_id, row.date);
    const group = groups.find((g) => g.id === row.group_id) || null;
    const label = CLASS_ROLE_LABEL[row.role] || CLASS_ROLE_LABEL.trainer;
    if (row.status === 'absent') {
      covered.add(key);
      entries.push({
        key: `att:${row.id}`,
        date: row.date,
        start_time: group?.time || null,
        end_time: endTimeOf(group?.time, group?.duration),
        hours: 0,
        title: label,
        subtitle: group?.name || '',
        work_type: 'class_shift',
        group_id: row.group_id || null,
        activity_id: null,
        status: 'absent',
        paid: false,
        pay_amount: 0,
        approved: false,
        source: 'class_attendance',
        notes: '',
      });
      continue;
    }
    // נוכח: אם כבר יש שורת עבודה לאותו חוג ותאריך, זו אותה משמרת.
    if (covered.has(key)) continue;
    covered.add(key);
    entries.push({
      key: `att:${row.id}`,
      date: row.date,
      start_time: group?.time || null,
      end_time: endTimeOf(group?.time, group?.duration),
      hours: Number(row.hours) || 0,
      title: label,
      subtitle: group?.name || '',
      work_type: 'class_shift',
      group_id: row.group_id || null,
      activity_id: null,
      status: 'logged',
      paid: PAID_CLASS_ROLES.has(row.role),
      pay_amount: 0,
      approved: false,
      source: 'class_attendance',
      notes: '',
    });
  }

  // 3. חוגים קבועים קדימה — קיימים רק כהגדרה (יום בשבוע + שעה), ולכן נגזרים.
  for (const group of groups) {
    const isTrainer = group.trainer === employeeId;
    const isAssistant = Array.isArray(group.assistants) && group.assistants.includes(employeeId);
    if (!isTrainer && !isAssistant) continue;
    const days = new Set(getGroupDays(group));
    if (!days.size) continue;
    const role = isTrainer ? 'trainer' : 'assistant';
    for (let date = now; date <= horizon; date = addDays(date, 1)) {
      if (!days.has(weekdayOf(date))) continue;
      if (covered.has(groupDayKey(group.id, date))) continue;
      // ביום חופשה מאימונים לא מתקיים חוג, ולכן אין משמרת.
      const vacation = findTrainingVacation(activities, date);
      entries.push({
        key: `plan:${group.id}:${date}`,
        date,
        start_time: group.time || null,
        end_time: endTimeOf(group.time, group.duration),
        hours: hoursOf(group.duration),
        title: CLASS_ROLE_LABEL[role],
        subtitle: group.name || '',
        work_type: 'class_shift',
        group_id: group.id,
        activity_id: null,
        status: vacation ? 'vacation' : 'planned',
        paid: PAID_CLASS_ROLES.has(role),
        pay_amount: 0,
        approved: false,
        source: 'group_schedule',
        notes: vacation ? (vacation.name || 'חופשה מאימונים') : '',
      });
    }
  }

  // 4. משמרת שרצה עכשיו — עוד אין לה שורת עבודה, היא נוצרת רק בסגירה.
  for (const shift of shiftHours) {
    if (shift.employee_id !== employeeId || shift.status !== 'open') continue;
    const date = String(shift.clock_in || '').slice(0, 10);
    entries.push({
      key: `open:${shift.id}`,
      date: date || now,
      start_time: null,
      end_time: null,
      hours: 0,
      title: 'משמרת פתוחה',
      subtitle: shift.notes || '',
      work_type: shift.activity_type || 'counter_shift',
      group_id: null,
      activity_id: null,
      status: 'open',
      paid: true,
      pay_amount: 0,
      approved: false,
      source: 'clock',
      notes: '',
    });
  }

  entries.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.start_time || '').localeCompare(String(b.start_time || '')));

  return { today: now, horizon, entries };
}

export default buildShiftJournal;
