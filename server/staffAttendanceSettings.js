/**
 * הגדרות שעון נוכחות / פתיחת קיר — נשמרות ב-app_settings.
 */
import { getOpenSession } from './cashRegister.js';
import { employeeIsWallStaff } from './employeeScope.js';

export { employeeIsWallStaff } from './employeeScope.js';

export const STAFF_ATTENDANCE_SETTINGS_KEY = 'staff_attendance';

export const DEFAULT_STAFF_ATTENDANCE_SETTINGS = {
  minutes_before_shift_ok: 15,
  wall_open_confirm_message: 'המקום מסודר ונקי?',
  // צ׳ק-ליסט הסגירה — כל שורה תיבת סימון נפרדת במסוף. משפט אחד ארוך נקרא
  // כמו אישור טכני ומסומן בלי לקרוא; פריטים נפרדים מחייבים מעבר על כל אחד.
  wall_close_checklist: [
    'אוטומטיים למעלה',
    'שמשיות סגורות',
    'פח רוקן',
    'דלפק נקי ומסודר',
  ],
};

export function normalizeStaffAttendanceSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const minutes = Number(src.minutes_before_shift_ok);
  const checklist = (Array.isArray(src.wall_close_checklist) ? src.wall_close_checklist : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return {
    minutes_before_shift_ok:
      Number.isFinite(minutes) && minutes >= 0 ? Math.min(180, Math.floor(minutes)) : 15,
    wall_open_confirm_message:
      String(src.wall_open_confirm_message || '').trim()
      || DEFAULT_STAFF_ATTENDANCE_SETTINGS.wall_open_confirm_message,
    wall_close_checklist:
      checklist.length > 0
        ? checklist
        : [...DEFAULT_STAFF_ATTENDANCE_SETTINGS.wall_close_checklist],
  };
}

export async function readStaffAttendanceSettings(db, supa) {
  const local = db.getAppSettingLocal?.(STAFF_ATTENDANCE_SETTINGS_KEY);
  if (local) return normalizeStaffAttendanceSettings(local);
  try {
    const remote = await supa.getAppSetting?.(STAFF_ATTENDANCE_SETTINGS_KEY);
    if (remote) {
      const normalized = normalizeStaffAttendanceSettings(remote);
      db.setAppSettingLocal?.(STAFF_ATTENDANCE_SETTINGS_KEY, normalized);
      return normalized;
    }
  } catch { /* ברירת מחדל */ }
  return { ...DEFAULT_STAFF_ATTENDANCE_SETTINGS };
}

export async function writeStaffAttendanceSettings(db, supa, patch) {
  const current = await readStaffAttendanceSettings(db, supa);
  const next = normalizeStaffAttendanceSettings({ ...current, ...patch });
  db.setAppSettingLocal?.(STAFF_ATTENDANCE_SETTINGS_KEY, next);
  try { await supa.setAppSetting?.(STAFF_ATTENDANCE_SETTINGS_KEY, next); } catch { /* מקומי */ }
  return next;
}

export function employeeCanOpenWall(emp) {
  return employeeIsWallStaff(emp) && emp.can_open_wall === true;
}

export function employeeCanSignDailySafety(emp) {
  return employeeIsWallStaff(emp) && emp.can_sign_daily_safety === true;
}

export function requireOpenCashSession(db) {
  const open = getOpenSession(db);
  if (!open) {
    const err = new Error('יש לפתוח קופה קודם');
    err.code = 'CASH_CLOSED';
    throw err;
  }
  return open;
}

/**
 * דקות של שיבוצים שעתיים באותו יום שחופפים לחלון המשמרת — כדי לא לשלם כפל.
 */
export function overlappingPaidMinutes(assignments, dateStr, windowStartMin, windowEndMin) {
  let total = 0;
  for (const row of assignments || []) {
    if (row.date !== dateStr) continue;
    if (row.source === 'wall_shift') continue;
    if (row.pay_mode === 'flat') continue;
    const start = parseHm(row.start_time);
    const end = parseHm(row.end_time);
    if (start == null || end == null || end <= start) continue;
    const overlapStart = Math.max(windowStartMin, start);
    const overlapEnd = Math.min(windowEndMin, end);
    if (overlapEnd > overlapStart) total += overlapEnd - overlapStart;
  }
  return total;
}

function parseHm(hm) {
  if (!hm || typeof hm !== 'string') return null;
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  return h * 60 + min;
}

/**
 * הערת חריגה אם נפתח מוקדם מדי לפני השיבוץ הראשון של היום.
 */
export function earlyArrivalNote(assignments, dateStr, clockInMin, minutesOk) {
  const starts = (assignments || [])
    .filter((r) => r.date === dateStr && r.source !== 'wall_shift' && r.pay_mode !== 'flat')
    .map((r) => parseHm(r.start_time))
    .filter((m) => m != null)
    .sort((a, b) => a - b);
  if (!starts.length || clockInMin == null) return '';
  const first = starts[0];
  const earlyBy = first - clockInMin;
  if (earlyBy <= minutesOk) return '';
  return `הגעה מוקדמת: ${earlyBy} דקות לפני השיבוץ (מותר עד ${minutesOk})`;
}
