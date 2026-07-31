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

/**
 * Archiving is a customer-level decision, so it lives on the payer: an archived
 * parent takes the whole family off the working lists, trainees included.
 */
export function isArchivedParent(parent) {
  return String(parent?.status || '') === 'archived';
}

export function parentLeadId(parentId) {
  return `parent:${parentId}`;
}

/**
 * Resolve deep-link targets like student ids or `parent:<id>` into the
 * selection id used by the leads screen.
 */
export function resolveLeadOpenTarget(openId, students = [], parents = []) {
  if (openId == null || openId === '') return null;
  const raw = String(openId);

  const byStudent = (students || []).find((student) => student && String(student.id) === raw);
  if (byStudent) return String(byStudent.id);

  if (raw.startsWith('parent:')) {
    const parentId = raw.slice('parent:'.length);
    if (!parentId) return null;
    const parent = (parents || []).find((row) => row && String(row.id) === parentId);
    if (!parent) return null;

    const children = (students || []).filter(
      (student) => student && String(student.parentId) === parentId
    );
    if (children.length) {
      const preferred =
        children.find((student) => student.name && !isParentOnlyLead(student) && !student.isAdult)
        || children.find((student) => student.name && !isParentOnlyLead(student))
        || children[0];
      return String(preferred.id);
    }
    return parentLeadId(parentId);
  }

  const entry = buildLeadEntries(students, parents).find((row) => String(row.key) === raw);
  return entry ? String(entry.key) : null;
}

/**
 * Produces one safe, uniform entry per student and one synthetic entry for
 * each parent who has no student record. Synthetic records are UI-only.
 * Archived customers are left out unless `includeArchived` asks for them.
 */
export function buildLeadEntries(students = [], parents = [], { includeArchived = false } = {}) {
  const safeStudents = Array.isArray(students) ? students.filter(Boolean) : [];
  const safeParents = Array.isArray(parents) ? parents.filter(Boolean) : [];
  const parentById = new Map(safeParents.map((parent) => [String(parent.id), parent]));

  const entries = safeStudents
    .filter((student) => student.id != null)
    .filter(
      (student) => includeArchived || !isArchivedParent(parentById.get(String(student.parentId)))
    )
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
    if (!includeArchived && status === 'archived') continue;

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
