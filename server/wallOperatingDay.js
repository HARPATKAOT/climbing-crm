/**
 * When the climbing wall is "open for business" — used by daily safety checks
 * so closed days (weekends without events, training vacations) are not treated
 * as missed inspections.
 *
 * Sun–Thu: open unless a training_vacation covers the day.
 * Fri–Sat: open only with opening_hours or a wall event (birthday / school / company / category wall).
 * Any day: also open if a wall shift was clocked in that day (פתיחת משמרת),
 * even when the calendar says closed.
 */

import {
  activityDateRange,
  israelDateStr,
  isTrainingVacationDate,
} from './attendanceUtils.js';
import { isEventType } from './eventKinds.js';

/**
 * `isEventType` covers the merged `event` and the three types that preceded it,
 * so a Friday booked before the merge still reads as a day the wall was open.
 * A personal training is one instructor and one climber, but the wall is in use
 * and someone has to have checked it — so it counts too.
 */
const WALL_EVENT_TYPES = new Set(['personal_training']);
const isWallEventType = (type) => isEventType(type) || WALL_EVENT_TYPES.has(String(type || '').toLowerCase());

/** 0 = Sunday … 6 = Saturday, from a YYYY-MM-DD civil date. */
export function weekdayFromDateStr(dateStr) {
  const day = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Noon UTC is always the same calendar date in Israel (UTC+2/+3).
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

function dayKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

function isCancelled(activity) {
  if (!activity) return true;
  if (activity.cancelled) return true;
  const status = String(activity.status || '').toLowerCase();
  return status === 'cancelled' || status === 'canceled';
}

function activityCoversDate(activity, dateStr) {
  const day = dayKey(dateStr);
  if (!day || isCancelled(activity)) return false;
  return activityDateRange(activity).includes(day);
}

/** Public opening hours entry for this date. */
export function hasOpeningHoursOn(activities, dateStr) {
  return (activities || []).some(
    (a) => a?.type === 'opening_hours' && activityCoversDate(a, dateStr),
  );
}

/** In-gym event that means the wall is open (Fri/Sat rule). */
export function hasWallEventOn(activities, dateStr) {
  return (activities || []).some((a) => {
    if (!activityCoversDate(a, dateStr)) return false;
    if (a.type === 'opening_hours' || a.type === 'training_vacation') return false;
    if (a.type === 'trip' || a.type === 'route_building') return false;
    if (isWallEventType(a.type)) return true;
    return String(a.category || '').toLowerCase() === 'wall';
  });
}

/**
 * True when a wall shift was opened on this Israel calendar day
 * (open or already closed — פתיחת משמרת happened).
 */
export function hasWallShiftOn(dateStr, shifts = []) {
  const day = dayKey(dateStr);
  if (!day) return false;
  return (shifts || []).some((s) => {
    if (!s?.clock_in) return false;
    const cin = new Date(s.clock_in);
    if (Number.isNaN(cin.getTime())) return false;
    return israelDateStr(cin) === day;
  });
}

/**
 * Calendar-only rule (ignores shifts). Prefer isWallOpenForSafety when shifts are known.
 * @param {string} dateStr YYYY-MM-DD
 * @param {object[]} activities calendar activities
 * @returns {boolean}
 */
export function isWallOperatingDay(dateStr, activities = []) {
  const dow = weekdayFromDateStr(dateStr);
  if (dow == null) return false;

  // Friday (5) or Saturday (6): only with opening hours or a wall event.
  if (dow === 5 || dow === 6) {
    return hasOpeningHoursOn(activities, dateStr) || hasWallEventOn(activities, dateStr);
  }

  // Sunday–Thursday: open unless training vacation / holiday.
  return !isTrainingVacationDate(activities, dateStr);
}

/**
 * Operating day for safety: calendar rule OR a wall shift opened that day.
 */
export function isWallOpenForSafety(dateStr, activities = [], shifts = []) {
  if (hasWallShiftOn(dateStr, shifts)) return true;
  return isWallOperatingDay(dateStr, activities);
}

/**
 * Most recent operating day on or before `dateStr` (inclusive).
 * Walks back up to `lookbackDays` calendar days.
 */
export function lastOperatingDayOnOrBefore(dateStr, activities = [], { lookbackDays = 60, shifts = [] } = {}) {
  const start = dayKey(dateStr);
  if (!start) return null;
  const cursor = new Date(`${start}T12:00:00Z`);
  if (Number.isNaN(cursor.getTime())) return null;

  for (let i = 0; i < lookbackDays; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    if (isWallOpenForSafety(day, activities, shifts)) return day;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return null;
}

export function isDailySafetyCheck(type) {
  if (!type) return false;
  if (String(type.frequency || '').trim() === 'יומי') return true;
  return Number(type.interval_days) === 1;
}

/**
 * Daily check is overdue when the last required operating day was not signed.
 * Closed days between signatures do not create overdue by themselves.
 */
export function isDailySafetyOverdue(lastPerformedDate, asOfDate, activities = [], shifts = []) {
  const required = lastOperatingDayOnOrBefore(asOfDate, activities, { shifts });
  if (!required) return false;
  const last = dayKey(lastPerformedDate);
  if (!last) return true;
  return last < required;
}
