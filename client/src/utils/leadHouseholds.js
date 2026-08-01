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
 * One row per household. `parent` is the card the row is named after, `parents`
 * is everyone on the household — the second parent is shown, not hidden, so the
 * desk can still see whose phone number it is looking at.
 *
 * `allStudents` supplies the household links; `students` is what the row shows.
 */
export function buildFamilyRows(students, parents, allStudents) {
  const parentById = new Map((parents || []).map((p) => [p.id, p]));
  const household = buildHouseholdIndex(allStudents || students, parents);
  const groups = new Map();

  for (const student of students || []) {
    const parent = parentById.get(student.parentId) || null;
    const phoneKey = normalizePhone(parent?.phone) || '';
    const groupKey = parent?.id && household.has(parent.id)
      ? `household:${household.find(parent.id)}`
      : (phoneKey
        ? `phone:${phoneKey}`
        : (parent?.id ? `parent:${parent.id}` : `student:${student.id}`));

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
    for (const parent of parents || []) {
      if (parent?.id == null) continue;
      if (household.find(parent.id) !== rootId) continue;
      if (row.parents.some((p) => String(p.id) === String(parent.id))) continue;
      row.parents.push(parent);
    }
  }

  return [...groups.values()].map((row) => {
    const sorted = [...row.students].sort((a, b) => {
      const adultDiff = Number(!!b.isAdult) - Number(!!a.isAdult);
      if (adultDiff) return adultDiff;
      const da = a.created_at || a.created || '';
      const db = b.created_at || b.created || '';
      return String(da).localeCompare(String(db));
    });
    const statuses = [...new Set(sorted.map((s) => s.status).filter(Boolean))];
    const created = sorted.map((s) => s.created || (s.created_at ? String(s.created_at).split('T')[0] : '')).filter(Boolean).sort()[0] || '';
    return {
      ...row,
      students: sorted,
      primaryStudent: sorted.find((s) => !isParentOnlyLead(s) && !s.isAdult)
        || sorted.find((s) => !isParentOnlyLead(s))
        || sorted[0],
      statuses,
      created,
    };
  });
}
