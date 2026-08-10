/**
 * מחזור המשמרת במסוף הכניסה.
 *
 * פתיחת הקיר היא תהליך ולא לחיצה אחת: קודם העובד נכנס למשמרת, אחר כך נפתחת
 * הקופה, ואז נחתמות בדיקות החבלים והמכשירים. רק כששלושת אלה הושלמו הקיר פתוח
 * בפועל. **שעון השכר מתחיל בשלב הראשון** — מי שנתקע ארבעים דקות על בדיקת חבלים
 * עבד אותן, ולכן `clock_in` נחתם בלחיצה על „פתיחת משמרת” ולא בסוף התהליך.
 * `wall_opened_at` מתעד מתי התהליך הסתיים, והוא לתיעוד בלבד — השכר לא נוגע בו.
 *
 * המצב נגזר מהנתונים הקיימים ולא נשמר בשדה משלו: שורת `shift_hours` פתוחה,
 * משמרת קופה פתוחה, ובדיקות הבטיחות של היום. כך אין מצב שנשמר במקום אחד
 * ומכחיש את מה שכתוב במקום אחר.
 */

import { employeeIsWallStaff } from './employeeScope.js';
import { overlappingPaidMinutes, earlyArrivalNote } from './staffAttendanceSettings.js';
import { openWallShifts, employeeCanOperateWall } from './wallOperations.js';
import { roundHoursHalfUp } from './wageRates.js';

export const WALL_ACTIVITY_TYPE = 'counter_shift';
export const WALL_ROLE = Object.freeze({ OPENER: 'opener', STAFF: 'staff' });

/**
 * מי פתח את המשמרת.
 *
 * שורות ישנות נפתחו לפני שהיה `wall_role`, ולכן בהיעדר סימון מפורש הפותח הוא
 * הראשון שנכנס — אחרת משמרת שנפתחה לפני העדכון תיראה כאילו לא נפתחה מעולם.
 */
export function wallShiftOpener(shiftHours = []) {
  const open = openWallShifts(shiftHours);
  const marked = open.find((shift) => shift.wall_role === WALL_ROLE.OPENER);
  if (marked) return marked;
  const unmarked = open.filter((shift) => !shift.wall_role);
  if (unmarked.length === 0) return null;
  return [...unmarked].sort((a, b) => String(a.clock_in || '').localeCompare(String(b.clock_in || '')))[0];
}

/**
 * באיזה שלב התהליך.
 *
 * שלושת התנאים הם תנאי **פתיחה**, לא תנאי המשך. ברגע ש-`wall_opened_at` נחתם
 * היום כבר נפתח, והמצב לא חוזר אחורה — אחרת ספירת הקופה, שהיא שלב בסגירה,
 * הייתה מחזירה את המסוף לאשף הפתיחה בדיוק באמצע הסגירה ומשאירה את מי שסוגר
 * בלי כפתור לסגור בו.
 *
 * @returns {{stage:'closed'|'opening'|'open', step:1|2|3|0}}
 *   step הוא השלב שממתין לביצוע: 1 פתיחת משמרת, 2 קופה, 3 בדיקות. 0 = הכול הושלם.
 */
export function wallShiftStage({ opener = null, cashOpen = false, pendingSafety = [] } = {}) {
  if (!opener) return { stage: 'closed', step: 1 };
  if (opener.wall_opened_at) return { stage: 'open', step: 0 };
  if (!cashOpen) return { stage: 'opening', step: 2 };
  if ((pendingSafety || []).length > 0) return { stage: 'opening', step: 3 };
  return { stage: 'open', step: 0 };
}

/** האם העובד הזה הוא האחרון שנשאר במשמרת. */
export function isLastOnShift(openShifts = [], employeeId) {
  const open = openWallShifts(openShifts);
  return open.some((shift) => shift.employee_id === employeeId)
    && open.every((shift) => shift.employee_id === employeeId);
}

/**
 * האם מותר לעובד לצאת בדיווח יציאה רגיל.
 *
 * האחרון במשמרת לא יוצא — הוא סוגר. אחרת הקיר נשאר פתוח בלי איש, והקופה
 * והחבלים נשארים פתוחים עד למחרת.
 *
 * @returns {{ok:boolean, code:string|null, error:string|null}}
 */
export function canClockOut(openShifts = [], employeeId) {
  const open = openWallShifts(openShifts);
  if (!open.some((shift) => shift.employee_id === employeeId)) {
    return { ok: false, code: 'NOT_ON_SHIFT', error: 'אין משמרת פתוחה לעובד הזה' };
  }
  if (isLastOnShift(open, employeeId)) {
    return {
      ok: false,
      code: 'MUST_CLOSE_SHIFT',
      error: 'זה העובד האחרון במשמרת — היציאה נעשית דרך סגירת משמרת',
    };
  }
  return { ok: true, code: null, error: null };
}

/** מי מהעובדים שנמצאים עכשיו במשמרת מורשה לסגור את הקיר. */
export function qualifiedClosersOnShift(openShifts = [], employees = []) {
  const open = openWallShifts(openShifts);
  const byId = new Map((Array.isArray(employees) ? employees : []).map((emp) => [emp?.id, emp]));
  return open
    .map((shift) => byId.get(shift.employee_id))
    .filter((emp) => emp && employeeCanOperateWall(emp));
}

/** האם העובד רשאי בכלל להיכנס למשמרת קיר מהמסוף. */
export function canJoinShift(employee) {
  if (!employee) return { ok: false, error: 'העובד לא נמצא' };
  if (!employeeIsWallStaff(employee)) {
    return { ok: false, error: 'רק עובד קיר פעיל יכול להיכנס למשמרת מהמסוף' };
  }
  return { ok: true, error: null };
}

/**
 * שורת השכר של משמרת קיר שנסגרה: חלון המשמרת פחות דקות שיבוצים שעתיים חופפים,
 * כדי שלא לשלם פעמיים על אותה שעה.
 *
 * מחזירה את השדות בלבד — הקורא אחראי להקפאת התעריף ולשמירה.
 *
 * @returns {object|null} null כשאין זמני כניסה ויציאה תקינים.
 */
export function buildWallPayrollRow({
  shift,
  cin,
  cout,
  dayAssignments = [],
  roleLabel = '',
  minutesBeforeShiftOk = 15,
  closerNote = '',
} = {}) {
  if (!shift || !cin || !cout) return null;
  const totalMinutes = Math.max(0, (new Date(shift.clock_out) - new Date(shift.clock_in)) / 60000);
  const carved = overlappingPaidMinutes(dayAssignments, cin.date, cin.minutes, cout.minutes);
  const wallMinutes = Math.max(0, totalMinutes - carved);
  const exception = earlyArrivalNote(dayAssignments, cin.date, cin.minutes, minutesBeforeShiftOk);
  const noteParts = [closerNote, exception].filter(Boolean);
  return {
    employee_id: shift.employee_id,
    activity_id: null,
    group_id: null,
    date: cin.date,
    work_type: WALL_ACTIVITY_TYPE,
    role: roleLabel,
    start_time: cin.hm,
    end_time: cout.hm,
    hours: roundHoursHalfUp(wallMinutes / 60),
    pay_mode: 'hourly',
    flat_amount: null,
    source: 'wall_shift',
    shift_id: shift.id,
    approved: false,
    notes: noteParts.join(' · '),
    exception_notes: exception || '',
  };
}
