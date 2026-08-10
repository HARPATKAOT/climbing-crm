export function isWallStaff(employee) {
  if (!employee || employee.is_active === false) return false;
  if (typeof employee.is_wall_staff === 'boolean') return employee.is_wall_staff;
  const roles = Array.isArray(employee.certifications)
    ? employee.certifications.map((role) => String(role || '').trim()).filter(Boolean)
    : [];
  // מעבר לרשומות הוותיקות: מי שמסומן רק להדרכת סנפלינג הוא עובד חיצוני.
  return !(roles.length > 0 && roles.every((role) => role.includes('סנפלינג')));
}
