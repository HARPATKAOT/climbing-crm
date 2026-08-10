import { employeeCanOpenWall } from './staffAttendanceSettings.js';
import { employeeIsWallStaff } from './employeeScope.js';

export const WALL_OPENING_SAFETY_CHECK_ID = 'sct-ropes-autobelay';

export function wallOpeningSafetyChecks(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    row?.id === WALL_OPENING_SAFETY_CHECK_ID ||
    String(row?.name || '').trim() === 'בדיקת חבלים וטרובלואים'
  ));
}

export function wallStationEmployee(employee = {}) {
  return {
    id: employee.id,
    name: employee.name || '',
    role: employee.role || 'trainer',
    is_active: employee.is_active !== false && employee.active !== false,
    is_wall_staff: employeeIsWallStaff(employee),
    staff_category: employee.staff_category || null,
    can_open_wall: employee.can_open_wall === true,
    can_sign_daily_safety: employee.can_sign_daily_safety === true,
    can_operate_cash: employee.can_operate_cash === true,
    certifications: Array.isArray(employee.certifications) ? employee.certifications : [],
  };
}

export function pendingWallSafetyChecks(rows = []) {
  return wallOpeningSafetyChecks(rows).filter((row) => row?.is_due && !row?.signed_today);
}

export function openWallShifts(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((shift) => (
    shift?.status === 'open' && shift?.activity_type === 'counter_shift'
  ));
}

export function employeeCanOperateWall(employee) {
  return employee?.active !== false && employeeIsWallStaff(employee) && employeeCanOpenWall(employee);
}

export function requireWallSafetyComplete(rows = []) {
  const pending = pendingWallSafetyChecks(rows);
  if (!pending.length) return [];
  const error = new Error('יש להשלים את בדיקות הבטיחות לפני פתיחת הקיר');
  error.code = 'SAFETY_PENDING';
  error.status = 409;
  error.pending = pending;
  throw error;
}

export function requireQualifiedWallCloser(employees = [], closerId) {
  const closer = (Array.isArray(employees) ? employees : [])
    .find((employee) => String(employee?.id) === String(closerId || ''));
  if (!closer) {
    const error = new Error('יש לבחור עובד שסוגר את הקיר');
    error.status = 400;
    throw error;
  }
  if (!employeeCanOperateWall(closer)) {
    const error = new Error('העובד שנבחר אינו מורשה לפתוח ולסגור את הקיר');
    error.status = 403;
    throw error;
  }
  return closer;
}
