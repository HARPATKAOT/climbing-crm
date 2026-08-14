const STUDENT_CUSTOMER_EDIT_FIELDS = new Set([
  'name', 'lastName', 'birthDate', 'idNumber', 'phone', 'email', 'gender',
  'notes', 'segment', 'nextFollowup', 'source',
]);

export function unsupportedStudentEditFields(patch = {}) {
  return Object.keys(patch).filter((key) => !STUDENT_CUSTOMER_EDIT_FIELDS.has(key));
}
