export function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/[^\d]/g, '');
  if (digits.startsWith('0') && digits.length >= 9) {
    digits = `972${digits.slice(1)}`;
  }
  return digits;
}

export function isParentOnlyLead(record) {
  return Boolean(record?._parentOnly) || String(record?.id || '').startsWith('parent:');
}

export function parentLeadId(parentId) {
  return `parent:${parentId}`;
}

/**
 * Produces one safe, uniform entry per student and one synthetic entry for
 * each parent who has no student record. Synthetic records are UI-only.
 */
export function buildLeadEntries(students = [], parents = []) {
  const safeStudents = Array.isArray(students) ? students.filter(Boolean) : [];
  const safeParents = Array.isArray(parents) ? parents.filter(Boolean) : [];
  const parentById = new Map(safeParents.map((parent) => [String(parent.id), parent]));

  const entries = safeStudents
    .filter((student) => student.id != null)
    .map((student) => ({
      key: String(student.id),
      student,
      parent: parentById.get(String(student.parentId)) || null,
    }));

  const parentIdsWithStudents = new Set(
    safeStudents.map((student) => student.parentId).filter(Boolean).map(String)
  );

  for (const parent of safeParents) {
    if (parent.id == null || parentIdsWithStudents.has(String(parent.id))) continue;
    const status = parent.status || 'lead_new';
    if (status === 'archived') continue;

    const id = parentLeadId(parent.id);
    entries.push({
      key: id,
      parent,
      student: {
        id,
        name: '',
        parentId: parent.id,
        groupId: null,
        status,
        birthDate: '',
        notes: parent.notes || '',
        levelGrade: null,
        source: parent.source || 'unknown',
        nextFollowup: parent.nextFollowup || null,
        created: parent.created_at ? String(parent.created_at).split('T')[0] : '',
        created_at: parent.created_at || null,
        _parentOnly: true,
      },
    });
  }

  return entries;
}
