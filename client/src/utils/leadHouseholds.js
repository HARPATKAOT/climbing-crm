/**
 * The leads table lists customers, and a customer is a household — not a parent
 * card. Mum and dad each have their own card, phone and conversation, so before
 * this the same family appeared twice: once under each parent, each row showing
 * a slice of the children.
 */
import { isParentOnlyLead, normalizePhone } from './leadUtils.js';
import { studentGuardianIds } from './studentGuardians.js';

/**
 * Which parent cards belong together: same phone (one person, two cards), or a
 * child both parents appear on.
 *
 * Links are read from every student on file, never from the filtered subset —
 * a status filter must not tear a household in two.
 */
export function buildHouseholdIndex(students, parents) {
  const root = new Map();
  const add = (value) => {
    const id = String(value);
    if (!root.has(id)) root.set(id, id);
    return id;
  };
  const find = (value) => {
    let id = add(value);
    while (root.get(id) !== id) id = root.get(id);
    return id;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root.set(rb, ra);
  };

  const byPhone = new Map();
  for (const parent of parents || []) {
    if (parent?.id == null) continue;
    add(parent.id);
    const phone = normalizePhone(parent.phone);
    if (!phone) continue;
    if (byPhone.has(phone)) union(byPhone.get(phone), parent.id);
    else byPhone.set(phone, parent.id);
  }
  for (const student of students || []) {
    const ids = studentGuardianIds(student);
    for (let i = 1; i < ids.length; i += 1) union(ids[0], ids[i]);
  }

  return { find, has: (id) => root.has(String(id)) };
}

export function scoreParentForDisplay(parent) {
  if (!parent) return 0;
  let score = 0;
  if (parent.name && parent.name !== 'לקוח וואטסאפ' && parent.name !== 'ליד מאינסטגרם') score += 4;
  if (parent.email) score += 2;
  if (parent.city) score += 1;
  if (String(parent.phone || '').startsWith('972')) score += 1;
  return score;
}

/**
 * Every trainee on the same household as this parent — both parents' children,
 * including adults on their own cards. Status filters must not hide a sibling
 * that still belongs on the customer file.
 */
export function householdStudentsForParent(parentId, students, parents) {
  const wanted = String(parentId || '');
  if (!wanted) return [];
  const list = students || [];
  const household = buildHouseholdIndex(list, parents);
  if (!household.has(wanted)) {
    return list.filter((student) => studentGuardianIds(student).includes(wanted));
  }
  const root = household.find(wanted);
  return list.filter((student) => {
    const ids = studentGuardianIds(student);
    return ids.some((id) => household.has(id) && household.find(id) === root);
  });
}

function cleanPersonName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('he');
}

function fullParentName(parent) {
  const name = String(parent?.name || '').replace(/\s+/g, ' ').trim();
  const lastName = String(parent?.lastName || '').replace(/\s+/g, ' ').trim();
  if (!lastName || name.endsWith(lastName)) return name;
  return [name, lastName].filter(Boolean).join(' ');
}

function adultMatchesParent(student, parent) {
  if (!student?.isAdult || !parent?.id) return false;
  if (!studentGuardianIds(student).includes(String(parent.id))) return false;

  const studentIdNumber = String(student.idNumber || student.id_number || '').replace(/\D/g, '');
  const parentIdNumber = String(parent.idNumber || parent.id_number || '').replace(/\D/g, '');
  if (studentIdNumber && parentIdNumber && studentIdNumber === parentIdNumber) return true;

  const studentPhone = normalizePhone(student.phone);
  const parentPhone = normalizePhone(parent.phone);
  if (studentPhone && parentPhone && studentPhone === parentPhone) return true;

  const studentName = cleanPersonName(student.name);
  const parentName = cleanPersonName(fullParentName(parent));
  return !!studentName && studentName === parentName;
}

/**
 * כרטיס כפול שאוחד ונשאר בארכיון — אותו שם ואותו תאריך לידה כמו כרטיס חי
 * באותו תיק — הוא שריד טכני של האיחוד, לא אדם נוסף במשפחה. מסמכים חתומים
 * ממשיכים להצביע עליו ולכן הוא לא נמחק, אבל בסרגל בני הבית מציגים רק את
 * הכרטיס החי, אחרת אותו ילד מופיע פעמיים.
 */
function isMergedAwayDuplicate(student, students) {
  if (String(student?.status || '') !== 'archived') return false;
  const name = cleanPersonName(student.name);
  if (!name) return false;
  const birth = String(student.birthDate || '');
  return (students || []).some((other) => other !== student
    && String(other?.status || '') !== 'archived'
    && cleanPersonName(other?.name) === name
    && String(other?.birthDate || '') === birth);
}

/**
 * One navigation tab per person in the household.
 *
 * Adult self-registrations have both a payer/contact row and a trainee row.
 * Those are two records in storage, but one person on screen, so the records
 * are paired into a single `combined` tab. A parent who does not train keeps a
 * parent-only tab, and every child keeps a trainee tab.
 */
export function buildFamilyMemberTabs(students, parents) {
  const realStudents = (students || [])
    .filter((student) => !isParentOnlyLead(student))
    .filter((student, _index, list) => !isMergedAwayDuplicate(student, list))
    .slice()
    .sort((a, b) => {
      const adultDiff = (a?.isAdult ? 0 : 1) - (b?.isAdult ? 0 : 1);
      if (adultDiff) return adultDiff;
      const nameDiff = String(a?.name || '').localeCompare(String(b?.name || ''), 'he');
      if (nameDiff) return nameDiff;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  const householdParents = (parents || []).filter((parent) => parent?.id != null);
  const pairedParentIds = new Set();

  const traineeTabs = realStudents.map((student) => {
    const linkedParent = householdParents.find((parent) => adultMatchesParent(student, parent)) || null;
    if (linkedParent) pairedParentIds.add(String(linkedParent.id));
    return {
      key: `student:${student.id}`,
      kind: linkedParent ? 'combined' : 'student',
      student,
      parent: linkedParent,
    };
  });

  const parentTabs = householdParents
    .filter((parent) => !pairedParentIds.has(String(parent.id)))
    .map((parent) => ({
      key: `parent:${parent.id}`,
      kind: 'parent',
      student: null,
      parent,
    }));

  return [...traineeTabs, ...parentTabs];
}

function expandRowStudents(row, studentsByFamilyKey) {
  const expanded = studentsByFamilyKey.get(row.key);
  if (!expanded?.length) return row.students;
  // Keep any synthetic parent-only entry that the filter brought in — it has
  // no real student row, so the household scan would drop it.
  const byId = new Map(expanded.map((student) => [String(student.id), student]));
  for (const student of row.students) {
    if (!byId.has(String(student.id))) byId.set(String(student.id), student);
  }
  return [...byId.values()];
}

function familyKeyForStudent(student, parentById, household) {
  const parent = parentById.get(String(student?.parentId)) || null;
  const phoneKey = normalizePhone(parent?.phone) || '';
  return parent?.id && household.has(parent.id)
    ? `household:${household.find(parent.id)}`
    : (phoneKey
      ? `phone:${phoneKey}`
      : (parent?.id ? `parent:${parent.id}` : `student:${student?.id}`));
}

/**
 * One row per household. `parent` is the card the row is named after, `parents`
 * is everyone on the household — the second parent is shown, not hidden, so the
 * desk can still see whose phone number it is looking at.
 *
 * `students` decides which households appear (status / queue filter).
 * `allStudents` supplies household links and fills each row with every trainee
 * on that household — a filter must not hide a sibling from the customer file.
 */
export function buildFamilyRows(students, parents, allStudents) {
  const parentById = new Map((parents || []).map((p) => [String(p.id), p]));
  const completeStudents = allStudents || students || [];
  const household = buildHouseholdIndex(completeStudents, parents);
  const groups = new Map();

  // Index the complete roster once. The previous implementation filtered the
  // full student list separately for every family row, turning a screen with
  // 1,000+ customers into millions of repeated comparisons per status count.
  const studentsByFamilyKey = new Map();
  for (const student of completeStudents) {
    const key = familyKeyForStudent(student, parentById, household);
    const bucket = studentsByFamilyKey.get(key);
    if (bucket) bucket.push(student);
    else studentsByFamilyKey.set(key, [student]);
  }

  const parentsByHouseholdRoot = new Map();
  for (const parent of parents || []) {
    if (parent?.id == null || !household.has(parent.id)) continue;
    const rootId = household.find(parent.id);
    const bucket = parentsByHouseholdRoot.get(rootId);
    if (bucket) bucket.push(parent);
    else parentsByHouseholdRoot.set(rootId, [parent]);
  }

  for (const student of students || []) {
    const parent = parentById.get(String(student.parentId)) || null;
    const groupKey = familyKeyForStudent(student, parentById, household);

    let row = groups.get(groupKey);
    if (!row) {
      row = {
        key: groupKey,
        parent,
        parents: [],
        students: [],
      };
      groups.set(groupKey, row);
    } else if (!row.parent && parent) {
      row.parent = parent;
    } else if (parent && row.parent && scoreParentForDisplay(parent) > scoreParentForDisplay(row.parent)) {
      row.parent = parent;
    }
    if (parent && !row.parents.some((p) => String(p.id) === String(parent.id))) {
      row.parents.push(parent);
    }
    row.students.push(student);
  }

  // A parent whose own children all sit under the other parent still belongs on
  // the row: the household is the customer, and either parent may be the one
  // the desk needs to call.
  for (const row of groups.values()) {
    if (!row.key.startsWith('household:')) continue;
    const rootId = row.key.slice('household:'.length);
    for (const parent of parentsByHouseholdRoot.get(rootId) || []) {
      if (row.parents.some((p) => String(p.id) === String(parent.id))) continue;
      row.parents.push(parent);
    }
  }

  return [...groups.values()].map((row) => {
    const expanded = expandRowStudents(row, studentsByFamilyKey);
    const sorted = [...expanded].sort((a, b) => {
      const adultDiff = Number(!!b.isAdult) - Number(!!a.isAdult);
      if (adultDiff) return adultDiff;
      const da = a.created_at || a.created || '';
      const db = b.created_at || b.created || '';
      return String(da).localeCompare(String(db));
    });
    const statuses = [...new Set(sorted.map((s) => s.status).filter(Boolean))];
    const created = sorted.map((s) => s.created || (s.created_at ? String(s.created_at).split('T')[0] : '')).filter(Boolean).sort()[0] || '';
    const primaryStudent = sorted.find((s) => !isParentOnlyLead(s) && !s.isAdult)
      || sorted.find((s) => !isParentOnlyLead(s))
      || sorted[0];
    // The main parent shown in the leads table is the selected trainee's actual
    // primary guardian. A completeness score is useful only as a fallback; it
    // must never contradict the primary star shown in the family file.
    const primaryParent = parentById.get(String(primaryStudent?.parentId || '')) || row.parent;
    const orderedParents = [...row.parents].sort((a, b) => {
      if (String(a.id) === String(primaryParent?.id)) return -1;
      if (String(b.id) === String(primaryParent?.id)) return 1;
      return 0;
    });
    return {
      ...row,
      parent: primaryParent,
      parents: orderedParents,
      students: sorted,
      primaryStudent,
      statuses,
      created,
    };
  });
}
