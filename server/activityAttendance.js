/**
 * נוכחות בפעילויות — רשימת נוכחות לכל אירוע ביומן.
 *
 * הרשימה אף פעם לא נבנית מראש: היא נגזרת בכל קריאה מהמשתתפים הרשומים
 * כפול ימי האירוע, ורק סימון של הצוות נשמר. כך משתתף שנוסף אחרי שהרשימה
 * כבר נפתחה מופיע מיד, ואירוע שהתאריכים שלו זזו לא משאיר שורות יתומות.
 *
 * הסימונים נשמרים באוסף הכללי `activity_attendance` (kv_collections) — אותה
 * דרך כמו `activity_interest`, בלי מיגרציית SQL על המסד הנעול.
 */

import { activityDateRange } from './attendanceUtils.js';
import { registrationDays, registrationCoversDate } from './activityDays.js';

export const ACTIVITY_ATTENDANCE_COLLECTION = 'activity_attendance';

/** רק שלושה מצבים: אירוע חד-פעמי לא צריך חליפי / חג כמו חוג שבועי. */
export const ACTIVITY_ATT_STATUSES = ['pending', 'attended', 'absent'];

/** הרשמות שכבר לא תופסות מקום — לא מופיעות ברשימת הנוכחות. */
const CLOSED_REGISTRATION_STATUSES = new Set(['cancelled', 'canceled', 'refunded', 'expired']);

function dayKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

export function normalizeActivityAttStatus(value) {
  const key = String(value ?? '').trim();
  if (key === 'present' || key === 'late' || key === 'הגיע') return 'attended';
  if (key === 'no_show' || key === 'missed' || key === 'לא הגיע') return 'absent';
  return ACTIVITY_ATT_STATUSES.includes(key) ? key : 'pending';
}

/** מזהה יציב — אותו משתתף באותו יום תמיד אותה שורה, גם בלי לקרוא קודם מהמסד. */
export function activityAttendanceId(registrationId, date) {
  return `aatt-${registrationId}-${dayKey(date)}`;
}

export function registrationCountsForAttendance(registration) {
  const status = String(registration?.status || 'active').toLowerCase();
  return !CLOSED_REGISTRATION_STATUSES.has(status);
}

export function activityAttendanceRows(db) {
  const rows = db.get(ACTIVITY_ATTENDANCE_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

/** אינדוקס לפי מזהה השורה, כדי לשטח את הסימונים על הרשימה הנגזרת. */
export function indexSavedAttendance(saved = []) {
  const byId = new Map();
  for (const row of saved || []) {
    const id = row?.id || activityAttendanceId(row?.registration_id, row?.date);
    if (id) byId.set(String(id), row);
  }
  return byId;
}

/** ימי האירוע (כולל אירוע רב-יומי) עם הסטטוס של משתתף אחד. */
export function attendanceDaysFor({ activity, registration, savedById }) {
  const index = savedById instanceof Map ? savedById : indexSavedAttendance(savedById);
  // רק הימים שההרשמה מכסה. ילד שנרשם ליומיים מתוך חמישה כבר לא מייצר שלושה
  // תאים ריקים שאיש לא אמור לסמן.
  return registrationDays(activity, registration).map((date) => {
    const id = activityAttendanceId(registration?.id, date);
    const row = index.get(id) || null;
    return {
      id,
      date,
      status: normalizeActivityAttStatus(row?.status),
      marked_at: row?.marked_at || null,
      marked_by: row?.marked_by || null,
      notes: row?.notes || '',
    };
  });
}

/**
 * רשימת הנוכחות המלאה של אירוע: משתתפים × ימים + סיכום לכל יום.
 * `registrations` מגיע כבר מסונן על ידי הקורא (אותה רשימה שהפאנל מציג).
 */
export function buildActivityAttendance({ activity, registrations = [], saved = [] } = {}) {
  const dates = activityDateRange(activity);
  const savedById = indexSavedAttendance(saved);
  const active = (registrations || []).filter(registrationCountsForAttendance);

  const participants = active.map((registration) => ({
    registration_id: registration.id,
    student_id: registration.student_id || null,
    parent_id: registration.parent_id || null,
    parent_name: registration.parent_name || '',
    participant_name: registration.participant_name || '',
    participant_type: registration.participant_type === 'adult' ? 'adult' : 'child',
    // אילו ימים הוא רשום אליהם. הלקוח מסנן לפי זה, ולכן זה נשלח במפורש ולא
    // נגזר מאורך `days` — הרשמה חלקית ורשימה מלאה נראות אחרת.
    attending_dates: registrationDays(activity, registration),
    days: attendanceDaysFor({ activity, registration, savedById }),
  }));

  // `days` כבר אינו באורך אחיד בין משתתפים, ולכן הסטטוס נמצא לפי תאריך ולא
  // לפי אינדקס. גם הסכום הכולל סופר רק את מי שרשום לאותו יום — אחרת
  // „2 מתוך 12” היה משקר על יום שרשומים אליו ארבעה.
  const totals = dates.map((date) => {
    const summary = { date, attended: 0, absent: 0, pending: 0, total: 0 };
    for (const participant of participants) {
      const day = participant.days.find((entry) => entry.date === date);
      if (!day) continue;
      summary.total += 1;
      summary[day.status || 'pending'] += 1;
    }
    return summary;
  });

  return {
    activity_id: activity?.id || null,
    activity_name: activity?.name || '',
    dates,
    multi_day: dates.length > 1,
    participants,
    totals,
  };
}

/**
 * מה שסימון בודד עושה למסד. סטטוס „ממתין” הוא ברירת המחדל הנגזרת, ולכן
 * חזרה אליו מוחקת את השורה במקום לשמור אותה — האוסף נשאר רזה.
 */
export function planAttendanceMark({
  activity,
  registration,
  date,
  status,
  existing = null,
  markedBy = null,
  now = new Date().toISOString(),
} = {}) {
  const day = dayKey(date);
  if (!registration?.id) {
    return { action: 'invalid', error: 'המשתתף לא נמצא באירוע' };
  }
  if (!day || !activityDateRange(activity).includes(day)) {
    return { action: 'invalid', error: 'התאריך לא נכלל בימי הפעילות' };
  }
  // יום שההרשמה אינה מכסה. הודעה נפרדת, כי זו טעות אחרת לגמרי מתאריך שאינו
  // של האירוע — כאן היום קיים, פשוט לא נרשמו אליו.
  if (!registrationCoversDate(activity, registration, day)) {
    return { action: 'invalid', error: 'המשתתף לא נרשם ליום הזה' };
  }
  const normalized = normalizeActivityAttStatus(status);
  const id = activityAttendanceId(registration.id, day);

  if (normalized === 'pending') {
    return existing ? { action: 'delete', id } : { action: 'none', id };
  }

  const row = {
    id,
    activity_id: activity?.id || null,
    registration_id: registration.id,
    student_id: registration.student_id || null,
    parent_id: registration.parent_id || null,
    date: day,
    status: normalized,
    marked_by: markedBy || existing?.marked_by || null,
    marked_at: now,
    notes: existing?.notes || '',
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  return { action: existing ? 'update' : 'insert', id, row };
}

/** סיכום קצר לתיק המתאמן: „הגיע ל־2 מתוך 5 ימים”. */
export function summarizeDays(days = []) {
  const attended = days.filter((day) => day.status === 'attended').length;
  const absent = days.filter((day) => day.status === 'absent').length;
  return { total: days.length, attended, absent, pending: days.length - attended - absent };
}
