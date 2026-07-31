/**
 * A child can be attached to more than one parent card (mum and dad each have
 * their own card, phone and conversation). `student.parentId` is the primary
 * one; `guardianIds` — added by the server on every student read — lists all of
 * them. Mirrors server/studentGuardians.js.
 */

export function studentGuardianIds(student) {
  const ids = [];
  if (student?.parentId) ids.push(String(student.parentId));
  for (const id of student?.guardianIds || []) {
    const value = String(id || '');
    if (value && !ids.includes(value)) ids.push(value);
  }
  return ids;
}

export function isChildOfParent(student, parentId) {
  const wanted = String(parentId || '');
  if (!wanted || !student) return false;
  return studentGuardianIds(student).includes(wanted);
}

export function studentsForParent(students, parentId) {
  return (students || []).filter((student) => isChildOfParent(student, parentId));
}

/** The other parents on a child's file — who to offer switching to. */
export function otherGuardians(student, parents = [], currentParentId) {
  const current = String(currentParentId || '');
  return studentGuardianIds(student)
    .filter((id) => id !== current)
    .map((id) => (parents || []).find((parent) => String(parent.id) === id))
    .filter(Boolean);
}
