import { isWallStaff } from './employeeScope.js';

/**
 * כללי הסינון של חלונות החתימה התפעוליים.
 *
 * חשוב שהחלון לא ינחש לפי שם התפקיד: ההרשאה נקבעת במפורש בתיק העובד,
 * ובכל פעולה מוצגים רק עובדים פעילים ששייכים לצוות הקיר והוסמכו לה.
 */
export function isActiveWallEmployee(employee) {
  return employee?.is_active !== false
    && employee?.active !== false
    && isWallStaff(employee);
}

function hasOperationalPermission(employee, permission) {
  return isActiveWallEmployee(employee) && employee?.[permission] === true;
}

export function canOpenWall(employee) {
  return hasOperationalPermission(employee, 'can_open_wall');
}

export function canSignSafetyChecks(employee) {
  return hasOperationalPermission(employee, 'can_sign_daily_safety');
}

export function canOperateCash(employee) {
  return hasOperationalPermission(employee, 'can_operate_cash');
}

export function canConductSafetyTest(employee) {
  return hasOperationalPermission(employee, 'can_test_safety');
}

export function employeesFor(employees, predicate) {
  return (Array.isArray(employees) ? employees : []).filter(predicate);
}
