/**
 * Multi-group membership helpers.
 * Source of truth: enrollments rows (+ groupIds on the student object in memory).
 * students.group_id stays as a primary/legacy pointer (first active group).
 */

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

export function activeEnrollmentGroupIds(enrollments = [], studentId) {
  const sid = String(studentId || '');
  if (!sid) return [];
  const ids = [];
  for (const row of enrollments || []) {
    if (String(row.student_id || row.studentId || '') !== sid) continue;
    if (row.end_date) continue;
    const status = String(row.status || 'active').toLowerCase();
    if (status === 'ended' || status === 'cancelled' || status === 'inactive') continue;
    const gid = row.group_id || row.groupId;
    if (gid) ids.push(String(gid));
  }
  return [...new Set(ids)];
}

/** Attach groupIds from enrollments (falls back to students.group_id). */
export function enrichStudentWithGroupIds(student, enrollments = []) {
  if (!student) return student;
  const fromEnroll = activeEnrollmentGroupIds(enrollments, student.id);
  const groupIds = fromEnroll.length
    ? fromEnroll
    : studentGroupIds(student);
  const primary = groupIds.includes(String(student.groupId || ''))
    ? String(student.groupId)
    : (groupIds[0] || null);
  return {
    ...student,
    groupIds,
    groupId: primary,
  };
}

export function enrichStudentsWithGroupIds(students = [], enrollments = []) {
  return (students || []).map((s) => enrichStudentWithGroupIds(s, enrollments));
}

export function enrollmentId(studentId, groupId) {
  return `enr-${studentId}-${groupId}`;
}
