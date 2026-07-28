/** Multi-group membership helpers (mirrors server/studentGroups.js). */

export function studentGroupIds(student) {
  if (!student) return [];
  if (Array.isArray(student.groupIds) && student.groupIds.length) {
    return [...new Set(student.groupIds.map((id) => String(id)).filter(Boolean))];
  }
  return student.groupId ? [String(student.groupId)] : [];
}

export function studentInGroup(student, groupId) {
  if (!student || groupId == null || groupId === '') return false;
  return studentGroupIds(student).includes(String(groupId));
}
