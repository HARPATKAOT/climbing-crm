// Server-side attendance helpers (mirror client scheduleUtils for ensure logic)

import { studentInGroup } from './studentGroups.js';

const HEB_DAY_IDX = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };

export function getGroupDays(group) {
  const m = (group?.name || '').match(/([א-ו])['׳’]?\s*\+\s*([א-ו])['׳’]?/);
  if (m) {
    const days = [HEB_DAY_IDX[m[1]], HEB_DAY_IDX[m[2]]].filter((d) => d != null);
    if (days.length) return [...new Set([group.day, ...days])].filter((d) => d != null);
  }
  return [group?.day].filter((d) => d != null);
}

/** YYYY-MM-DD in Asia/Jerusalem. */
export function israelDateStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function dateToWeekday(dateStr) {
  if (!dateStr) return new Date().getDay();
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

export function normalizeAttStatus(status) {
  if (status === 'present' || status === 'late') return 'attended';
  if (status === 'alternate' || status === 'makeup_attended' || status === 'arrived_makeup') return 'makeup';
  if (status === 'חג' || status === 'holiday_day') return 'holiday';
  const known = [
    'pending',
    'attended',
    'absent',
    'makeup',
    'holiday',
    'cancelled',
    'saturday_makeup',
    'intro_pending',
    'intro_attended',
    'intro_absent',
  ];
  if (known.includes(status)) return status;
  return 'pending';
}

// ─── אימון הכירות ────────────────────────────────────────────────────────────
// היות השורה „אימון הכירות” נקבעת פעם אחת, כשהשורה נוצרת, ונשמרת עליה.
// היא לא נגזרת מהסטטוס של הילד — אחרת שינוי סטטוס בדיעבד היה משכתב
// היסטוריה, וקיזוז דמי הנעליים נשען עליה.

/** סטטוס של מתאמן שעדיין באימון הכירות. */
export const INTRO_STUDENT_STATUSES = new Set(['intro_scheduled', 'intro_paid']);

/** סטטוסי נוכחות שמסמנים אימון הכירות. */
export const INTRO_ATT_STATUSES = new Set(['intro_pending', 'intro_attended', 'intro_absent']);

export function isIntroStudent(student) {
  return INTRO_STUDENT_STATUSES.has(student?.status);
}

export function isIntroAttStatus(status) {
  return INTRO_ATT_STATUSES.has(normalizeAttStatus(status));
}

/** המקבילה של סטטוס רגיל בשורת הכירות. */
const INTRO_EQUIVALENT = {
  pending: 'intro_pending',
  attended: 'intro_attended',
  makeup: 'intro_attended',
  saturday_makeup: 'intro_attended',
  absent: 'intro_absent',
};

/**
 * שומר על שורת הכירות גם כשמגיע עדכון עם סטטוס רגיל — למשל מלקוח ישן
 * או ממסך שלא יודע על ההכירות. „חג” ו„בוטל” עוברים כמו שהם, כי הם
 * מתארים את היום ולא את הילד.
 */
export function keepIntroStatus(existingStatus, nextStatus) {
  const next = normalizeAttStatus(nextStatus);
  if (!isIntroAttStatus(existingStatus)) return next;
  if (isIntroAttStatus(next)) return next;
  return INTRO_EQUIVALENT[next] || next;
}

// ─── Training-vacation automation ────────────────────────────────────────────
// A «חופשה מאימונים» activity in the calendar turns every training day it
// covers into "יום חג" attendance. Rows written by the automation carry this
// marker so a deleted / moved vacation can be rolled back without touching
// anything a trainer marked by hand.
export const VACATION_ACTIVITY_TYPE = 'training_vacation';
export const VACATION_MARKER = 'auto:training_vacation';
export const VACATION_ATT_STATUS = 'holiday';

function dayKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

/** The training-vacation activity covering `date`, or null. */
export function findTrainingVacation(activities, date) {
  const day = dayKey(date);
  if (!day) return null;
  return (activities || []).find((a) => {
    if (a?.type !== VACATION_ACTIVITY_TYPE) return null;
    if (a.status === 'cancelled') return null;
    const start = dayKey(a.date);
    if (!start) return null;
    const rawEnd = dayKey(a.end_date);
    const end = rawEnd && rawEnd > start ? rawEnd : start;
    return day >= start && day <= end;
  }) || null;
}

export function isTrainingVacationDate(activities, date) {
  return Boolean(findTrainingVacation(activities, date));
}

/** Every YYYY-MM-DD an activity spans (inclusive). Capped so a typo can't blow up. */
export function activityDateRange(activity, { maxDays = 120 } = {}) {
  const start = dayKey(activity?.date);
  if (!start) return [];
  const rawEnd = dayKey(activity?.end_date);
  const end = rawEnd && rawEnd > start ? rawEnd : start;
  const out = [];
  // UTC arithmetic keeps the walk exact regardless of the server's timezone.
  const cursor = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return [];
  while (out.length < maxDays) {
    const day = cursor.toISOString().slice(0, 10);
    out.push(day);
    if (day >= end) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function matchesDates(dates, day) {
  return !dates || dates.has(day);
}

function toDateSet(dates) {
  if (!dates) return null;
  const list = Array.isArray(dates) ? dates : [dates];
  return new Set(list.map(dayKey).filter(Boolean));
}

/** Pending rows on vacation days — these become "יום חג". */
export function planVacationAttendanceUpdates({ activities, attendance, dates = null }) {
  const wanted = toDateSet(dates);
  return (attendance || []).filter((row) => {
    const day = dayKey(row?.date);
    if (!day || !matchesDates(wanted, day)) return false;
    if (normalizeAttStatus(row.status) !== 'pending') return false;
    return isTrainingVacationDate(activities, day);
  });
}

/** Auto-marked rows whose vacation was deleted or moved — back to "ממתין למילוי". */
export function planVacationAttendanceReverts({ activities, attendance, dates = null }) {
  const wanted = toDateSet(dates);
  return (attendance || []).filter((row) => {
    const day = dayKey(row?.date);
    if (!day || !matchesDates(wanted, day)) return false;
    if (row.marked_by !== VACATION_MARKER) return false;
    if (normalizeAttStatus(row.status) !== VACATION_ATT_STATUS) return false;
    return !isTrainingVacationDate(activities, day);
  });
}

/**
 * Ensure pending attendance rows exist for every enrolled student in groups
 * that meet on `date`. Never overwrites existing rows.
 * Rows created on a training-vacation day start as "יום חג" instead of pending.
 */
export function ensureAttendanceRows({ groups, students, attendance, date, groupId, activities }) {
  const weekday = dateToWeekday(date);
  // שורות נוכחות נוצרות רק ביום שבו הקבוצה מתאמנת. פתיחת הגיליון
  // בתאריך אחר היא צפייה בלבד — קודם היא יצרה שורות „ממתין למילוי”
  // ליום שלא היה בו אימון.
  let targetGroups = (groups || []).filter((g) => {
    if (g.active === false) return false;
    return getGroupDays(g).includes(weekday);
  });
  if (groupId) targetGroups = targetGroups.filter((g) => g.id === groupId);

  const requestedGroup = groupId ? (groups || []).find((g) => g.id === groupId) : null;
  const skippedNotTrainingDay = Boolean(groupId && requestedGroup && !targetGroups.length);

  const existing = attendance || [];
  const keySet = new Set(
    existing.map((r) => `${r.student_id}|${r.group_id}|${r.date}`)
  );

  const vacation = findTrainingVacation(activities, date);
  const created = [];
  for (const g of targetGroups) {
    const members = (students || []).filter(
      (s) => studentInGroup(s, g.id) && s.status !== 'archived'
    );
    for (const s of members) {
      const key = `${s.id}|${g.id}|${date}`;
      if (keySet.has(key)) continue;
      const row = {
        id: `att-${g.id}-${date}-${s.id}`,
        student_id: s.id,
        group_id: g.id,
        date,
        status: vacation
          ? VACATION_ATT_STATUS
          : isIntroStudent(s)
            ? 'intro_pending'
            : 'pending',
        marked_by: vacation ? VACATION_MARKER : null,
        notes: '',
      };
      created.push(row);
      keySet.add(key);
    }
  }

  return {
    created,
    existing: existing.length,
    groups: targetGroups.map((g) => g.id),
    date,
    vacation: vacation ? { id: vacation.id, name: vacation.name || '' } : null,
    // הקבוצה קיימת אבל לא מתאמנת בתאריך הזה — הגיליון לצפייה בלבד.
    notTrainingDay: skippedNotTrainingDay,
  };
}

/** Hour (0-23) in Asia/Jerusalem for cron scheduling. */
export function israelHour(d = new Date()) {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: 'numeric',
    hour12: false,
  }).format(d);
  return parseInt(h, 10);
}
