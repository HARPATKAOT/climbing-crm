/**
 * A child can belong to two households: mum registers for a trip, dad buys the
 * punch card. Before this existed, the second parent's form created a second
 * copy of the child, and the pass, the declaration and the attendance ended up
 * split across two records that nobody could see were the same kid.
 *
 * `students.parentId` stays exactly what it was — the primary guardian, and the
 * field ~400 call sites already read. Extra parents live in `student_guardians`
 * alongside it, the same way `enrollments` sits alongside `students.groupId`.
 */

/** Stable id, so linking the same pair twice is a no-op rather than a duplicate. */
export function guardianLinkId(studentId, parentId) {
  return `sg-${studentId}-${parentId}`;
}

export function normalizedChildName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('he');
}

/** Only the first name is ever shown on a public form — see findChildMatches. */
export function guardianFirstName(parent) {
  return String(parent?.name || '').trim().split(/\s+/)[0] || '';
}

export function guardianRows(db) {
  return db.get('student_guardians') || [];
}

/** Every parent attached to a student: the primary one first, then the links. */
export function guardianParentIds(db, student) {
  const record = typeof student === 'string' ? db.getOne('students', student) : student;
  if (!record?.id) return [];
  const ids = [];
  if (record.parentId) ids.push(String(record.parentId));
  for (const row of guardianRows(db)) {
    if (String(row.student_id) !== String(record.id)) continue;
    const parentId = String(row.parent_id || '');
    if (parentId && !ids.includes(parentId)) ids.push(parentId);
  }
  return ids;
}

/**
 * Which parent a link about this child is sent to.
 *
 * The primary guardian is the default and stays the fallback. But the customer
 * card shows one parent at a time — mum and dad each have their own phone and
 * their own conversation — and when the caller names the parent it is looking
 * at, the message follows that tab instead of always going to the primary. A
 * parent who is not on this child's file, or has no phone to receive it, never
 * wins the choice.
 */
export function chooseRecipientParent(parents = [], {
  guardianIds = [],
  primaryParentId = '',
  preferredParentId = '',
} = {}) {
  const wanted = String(preferredParentId || '');
  const allowed = (guardianIds || []).map((id) => String(id));
  if (wanted && allowed.includes(wanted)) {
    const preferred = parents.find((p) => String(p?.id) === wanted && p?.phone);
    if (preferred) return preferred;
  }
  return parents.find((p) => String(p?.id) === String(primaryParentId || '')) || null;
}

export function studentGuardianIds(student, guardians = []) {
  const ids = [];
  if (student?.parentId) ids.push(String(student.parentId));
  for (const row of guardians) {
    if (String(row.student_id) !== String(student?.id)) continue;
    const parentId = String(row.parent_id || '');
    if (parentId && !ids.includes(parentId)) ids.push(parentId);
  }
  return ids;
}

/** Adds `guardianIds` next to `groupIds` so every read path carries both. */
export function enrichStudentsWithGuardians(students = [], guardians = []) {
  return (students || []).map((student) => ({
    ...student,
    guardianIds: studentGuardianIds(student, guardians),
  }));
}

export function isChildOfParent(student, parentId) {
  const wanted = String(parentId || '');
  if (!wanted || !student) return false;
  if (String(student.parentId || '') === wanted) return true;
  return (student.guardianIds || []).some((id) => String(id) === wanted);
}

export function studentsForParent(students = [], parentId) {
  return (students || []).filter((student) => isChildOfParent(student, parentId));
}

/** Link a parent to a child. Returns the new row, or null when already linked. */
export function linkGuardian(db, { studentId, parentId, source = 'form' } = {}) {
  if (!studentId || !parentId) return null;
  const student = db.getOne('students', studentId);
  if (!student) return null;
  if (String(student.parentId || '') === String(parentId)) return null;
  const id = guardianLinkId(studentId, parentId);
  if (guardianRows(db).some((row) => String(row.id) === id)) return null;
  return db.insert('student_guardians', {
    id,
    student_id: String(studentId),
    parent_id: String(parentId),
    source,
    created_at: new Date().toISOString(),
  });
}

/**
 * Move the "primary" badge to another parent already on the file.
 *
 * Primary is `students.parentId` — the parent the CRM addresses by default and
 * the one ~400 call sites read. The swap therefore rewrites that field and
 * keeps the previous holder attached as a link, so nobody drops off the file.
 */
export function setPrimaryGuardian(db, { studentId, parentId } = {}) {
  const student = db.getOne('students', studentId);
  if (!student) return null;
  const next = String(parentId || '');
  const previous = String(student.parentId || '');
  if (!next || !db.getOne('parents', next)) return null;
  if (previous === next) return { student, added: null, removed: false, changed: false };
  if (!guardianParentIds(db, student).includes(next)) return null;

  const updated = db.update('students', studentId, { parentId: next }) || { ...student, parentId: next };
  const removed = unlinkGuardian(db, { studentId, parentId: next });
  const added = previous
    ? linkGuardian(db, { studentId, parentId: previous, source: 'primary-swap' })
    : null;
  return { student: updated, added, removed, changed: true, previousParentId: previous };
}

/**
 * A child added to one parent card belongs to the whole household.
 *
 * Two parents become one family by sharing children — every parent is linked to
 * every child at the moment of the merge. A child registered *after* that merge
 * knows only the parent whose form created it, so the other parents' cards
 * never showed them: the family looked like it had lost a kid. Linking the
 * household at creation keeps the file whole, and a wrong link is undone the
 * usual way — "פיצול משפחה".
 *
 * Parents whose card was since deleted are skipped, so a stale link from an old
 * merge does not resurrect them.
 */
export function linkHouseholdGuardians(db, { studentId, source = 'household' } = {}) {
  const student = db.getOne('students', studentId);
  if (!student?.parentId) return [];
  const links = [];
  for (const parentId of expandHousehold(db, student.parentId).parentIds) {
    if (!db.getOne('parents', parentId)) continue;
    const link = linkGuardian(db, { studentId: student.id, parentId, source });
    if (link) links.push(link);
  }
  return links;
}

export function unlinkGuardian(db, { studentId, parentId } = {}) {
  const id = guardianLinkId(studentId, parentId);
  if (!guardianRows(db).some((row) => String(row.id) === id)) return false;
  return !!db.delete('student_guardians', id);
}

/**
 * Children already on file that look like the one being registered right now.
 *
 * Both the name and the date of birth must match: a name alone is not evidence
 * (two children really can share one), and a wrong guess here would hand one
 * family's child to another. A form that does not collect a birth date
 * therefore gets no matches rather than a risky one.
 *
 * `excludeParentId` drops children the person filling the form already has —
 * those are handled by the ordinary household lookup.
 */
/** Digits only — an ID typed with dashes or spaces is the same ID. */
export function normalizedIdNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

export function findChildMatches(db, {
  name,
  birthDate,
  idNumber = '',
  excludeParentId = null,
} = {}) {
  const wantedName = normalizedChildName(name);
  const wantedBirth = String(birthDate || '').trim();
  const wantedId = normalizedIdNumber(idNumber);

  const notAlreadyMine = (student) => {
    if (!excludeParentId) return true;
    return !isChildOfParent(
      { ...student, guardianIds: guardianParentIds(db, student) },
      excludeParentId
    );
  };
  const withGuardians = (student) => ({
    student,
    guardians: guardianParentIds(db, student)
      .map((id) => db.getOne('parents', id))
      .filter(Boolean),
  });

  const students = db.get('students') || [];

  // An ID number identifies one person, which name and birth date do not: two
  // children of the same age can share a name. When one was given, it decides —
  // and a match on it is never ambiguous.
  if (wantedId) {
    const byId = students.filter(
      (student) => normalizedIdNumber(student.idNumber) === wantedId && notAlreadyMine(student)
    );
    if (byId.length) return byId.map(withGuardians);
  }

  if (!wantedName || !wantedBirth) return [];

  // Falling back to name and birth date is the common case, not the exception:
  // almost no student on file carries an ID yet, so a parent who supplies one
  // still has to be matched by name. What the fallback must not do is match a
  // child whose stored ID says outright that this is somebody else.
  return students
    .filter((student) => {
      if (normalizedChildName(student.name) !== wantedName) return false;
      if (String(student.birthDate || '').trim() !== wantedBirth) return false;
      const storedId = normalizedIdNumber(student.idNumber);
      if (wantedId && storedId && storedId !== wantedId) return false;
      return notAlreadyMine(student);
    })
    .map(withGuardians);
}

/**
 * What a public form is allowed to learn: that the child is known, and the
 * first name of the parent holding the file — enough for "אתה ההורה השני?" and
 * nothing that identifies or reaches that household.
 */
export function publicChildMatchPayload(matches = [], { healthValid = false } = {}) {
  if (!matches.length) return { match: false };
  const first = matches[0];
  return {
    match: true,
    student_id: String(first.student.id),
    guardian_first_name: guardianFirstName(first.guardians[0]),
    guardian_count: first.guardians.length,
    // Lets the second parent skip a declaration the first one already signed.
    health_valid: !!healthValid,
    // More than one child shares this name and birth date — staff must decide,
    // so the form offers no link at all.
    ambiguous: matches.length > 1,
  };
}

/** Surname as the CRM knows it: the stored field, else the last word of the name. */
export function parentLastName(parent) {
  const explicit = String(parent?.lastName || parent?.last_name || '').trim();
  if (explicit) return explicit;
  const parts = String(parent?.name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/** Children on a parent's file — their own plus any they were linked to. */
export function childrenOfParent(db, parentId) {
  const wanted = String(parentId || '');
  if (!wanted) return [];
  return (db.get('students') || []).filter((student) => {
    if (String(student.parentId || '') === wanted) return true;
    return guardianRows(db).some(
      (row) => String(row.student_id) === String(student.id) && String(row.parent_id) === wanted
    );
  });
}

/**
 * Families already on file under the same surname.
 *
 * This is the answer to "mum registered one child, dad later registers another"
 * — nothing about the two submissions overlaps except the family name, so the
 * only way to join them is to ask a human who recognises the household.
 *
 * The names come back with the answer on purpose: "אבנר כהן עם הילד ראם" is
 * something a parent can confirm or reject at a glance, which is what makes a
 * wrong "yes" unlikely.
 */
export function familyCandidates(db, { lastName, excludeParentId = null, limit = 6 } = {}) {
  const wanted = normalizedChildName(lastName);
  if (!wanted || wanted.length < 2) return [];
  const exclude = String(excludeParentId || '');

  const matches = (db.get('parents') || []).filter((parent) => {
    if (exclude && String(parent.id) === exclude) return false;
    return normalizedChildName(parentLastName(parent)) === wanted;
  });

  // Parents who already share a child are one household, not three options.
  const households = [];
  const seen = new Set();
  for (const parent of matches) {
    if (seen.has(String(parent.id))) continue;
    const household = expandHousehold(db, parent.id);
    for (const id of household.parentIds) seen.add(id);
    const children = household.students.filter((child) => child.isAdult !== true);
    // A card with no children is not a family anyone can recognise.
    if (!children.length) continue;
    const parents = household.parentIds
      .map((id) => db.getOne('parents', id))
      .filter(Boolean);
    households.push({
      // Merge against the parent holding the most of the household's children,
      // so the joining parent inherits the whole family in one step.
      parent: [...parents].sort(
        (a, b) => childrenOfParent(db, b.id).length - childrenOfParent(db, a.id).length
      )[0] || parent,
      parents,
      // Naming only the parents whose surname was searched: the rest of the
      // household is not something the question needs to reveal.
      namedParents: parents.filter(
        (item) => normalizedChildName(parentLastName(item)) === wanted
      ),
      children,
    });
    if (households.length >= limit) break;
  }
  return households;
}

/** Everyone reachable from one parent through the children they share. */
export function expandHousehold(db, parentId) {
  const parentIds = [String(parentId)];
  const studentIds = new Set();
  const students = [];
  for (let index = 0; index < parentIds.length; index += 1) {
    for (const child of childrenOfParent(db, parentIds[index])) {
      if (studentIds.has(String(child.id))) continue;
      studentIds.add(String(child.id));
      students.push(child);
      for (const id of guardianParentIds(db, child)) {
        if (!parentIds.includes(String(id))) parentIds.push(String(id));
      }
    }
  }
  return { parentIds, students };
}

/**
 * Parents + children of one household — what the desk shows when splitting a
 * bad merge. Adult self-registrations stay out: they are not "kids to assign".
 */
export function householdSnapshot(db, parentId) {
  if (!db.getOne('parents', parentId)) return null;
  const household = expandHousehold(db, parentId);
  const parents = household.parentIds
    .map((id) => db.getOne('parents', id))
    .filter(Boolean)
    .map((parent) => ({
      id: String(parent.id),
      name: parent.name || '',
    }));
  const children = household.students
    .filter((student) => student.isAdult !== true)
    .map((student) => ({
      id: String(student.id),
      name: student.name || '',
      parentId: String(student.parentId || ''),
      guardianIds: guardianParentIds(db, student),
    }));
  return { parents, children };
}

/** Short enough to read at a glance, specific enough to recognise. */
function joinNames(names, limit) {
  const shown = names.slice(0, limit);
  const rest = names.length - shown.length;
  return `${shown.join(' ו')}${rest > 0 ? ` ועוד ${rest}` : ''}`;
}

export function publicFamilyCandidatesPayload(candidates = []) {
  return {
    families: candidates.map(({ parent, namedParents = [], children }) => {
      const parentNames = (namedParents.length ? namedParents : [parent])
        .map((item) => String(item.name || '').trim())
        .filter(Boolean);
      const childNames = children
        .map((child) => String(child.name || '').trim())
        .filter(Boolean);
      return {
        parent_id: String(parent.id),
        parent_name: joinNames(parentNames, 2),
        children: childNames.slice(0, 3),
        more_children: Math.max(0, childNames.length - 3),
      };
    }),
  };
}

/**
 * Undo a family merge by giving every child exactly one parent.
 *
 * Each assignment sets that parent as primary and drops every other guardian
 * link for the child. Parent cards and the children themselves are untouched.
 */
export function splitFamily(db, { assignments = [] } = {}) {
  const changes = [];
  for (const row of assignments) {
    const studentId = String(row?.studentId || '').trim();
    const parentId = String(row?.parentId || '').trim();
    const student = db.getOne('students', studentId);
    if (!student || !parentId) {
      return { ok: false, error: 'חסר ילד או הורה בשיוך' };
    }
    if (!db.getOne('parents', parentId)) {
      return { ok: false, error: 'כרטיס ההורה לא נמצא' };
    }
    if (!guardianParentIds(db, student).includes(parentId)) {
      return { ok: false, error: `לא ניתן לשייך את ${student.name || 'הילד'} להורה שאינו מקושר אליו` };
    }

    const previousPrimary = String(student.parentId || '');
    const updated = previousPrimary === parentId
      ? student
      : (db.update('students', studentId, { parentId }) || { ...student, parentId });

    const removed = [];
    for (const link of [...guardianRows(db)]) {
      if (String(link.student_id) !== studentId) continue;
      if (db.delete('student_guardians', link.id)) removed.push(link);
    }

    changes.push({
      student: updated,
      previousPrimary,
      parentId,
      removed,
    });
  }
  return { ok: true, changes };
}

/**
 * Join two parent cards into one household: each parent becomes a guardian of
 * the other's children, so the file shows both parents and every child once.
 *
 * Deliberately reversible — a blended family can be corrected by unlinking a
 * single parent from a single child, and each row records that a human on a
 * public form confirmed it.
 */
export function mergeFamily(db, { parentId, familyParentId, extraStudentIds = [] } = {}) {
  const joining = db.getOne('parents', parentId);
  const existing = db.getOne('parents', familyParentId);
  if (!joining || !existing || String(joining.id) === String(existing.id)) return [];

  const theirChildren = childrenOfParent(db, existing.id);
  const ourChildren = [
    ...childrenOfParent(db, joining.id),
    ...extraStudentIds.map((id) => db.getOne('students', id)).filter(Boolean),
  ];

  const links = [];
  for (const child of theirChildren) {
    const link = linkGuardian(db, { studentId: child.id, parentId: joining.id, source: 'family-merge' });
    if (link) links.push(link);
  }
  for (const child of ourChildren) {
    const link = linkGuardian(db, { studentId: child.id, parentId: existing.id, source: 'family-merge' });
    if (link) links.push(link);
  }
  return links;
}

/** Digits that identify a phone, whether it was typed 05… or 9725… */
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '').replace(/^972/, '').replace(/^0/, '');
}

/**
 * Households the desk may merge this one into, matched on a parent's name or
 * phone or on a child's name — the three things a person at the counter knows.
 *
 * Whole households, deduped: two parents who already share a child are one
 * candidate, and the children come back with the answer so the desk confirms a
 * family it recognises rather than a name that merely repeats.
 */
export function householdMergeCandidates(db, { parentId, query = '', limit = 8 } = {}) {
  const anchor = db.getOne('parents', parentId);
  if (!anchor) return [];
  const wantedName = normalizedChildName(query);
  const wantedPhone = phoneDigits(query);
  if (wantedName.length < 2 && wantedPhone.length < 3) return [];

  const matchesParent = (parent) => {
    if (wantedPhone.length >= 3 && phoneDigits(parent.phone).includes(wantedPhone)) return true;
    if (wantedName.length < 2) return false;
    return normalizedChildName(parent.name).includes(wantedName)
      || normalizedChildName(parentLastName(parent)).includes(wantedName);
  };

  // Our own household is never a candidate: merging it with itself is a no-op.
  const seen = new Set(expandHousehold(db, anchor.id).parentIds.map(String));
  const households = [];

  for (const parent of db.get('parents') || []) {
    if (parent?.id == null || seen.has(String(parent.id))) continue;
    const household = expandHousehold(db, parent.id);
    for (const id of household.parentIds) seen.add(String(id));
    const parents = household.parentIds
      .map((id) => db.getOne('parents', id))
      .filter(Boolean);
    // An archived card is off the working lists; it is not a merge target.
    if (parents.every((item) => String(item.status || '') === 'archived')) continue;
    const children = household.students.filter((child) => child.isAdult !== true);
    const hit = parents.some(matchesParent)
      || (wantedName.length >= 2
        && children.some((child) => normalizedChildName(child.name).includes(wantedName)));
    if (!hit) continue;

    households.push({
      // Either card merges the same family; naming the one holding most of the
      // children keeps the answer recognisable.
      parent: [...parents].sort(
        (a, b) => childrenOfParent(db, b.id).length - childrenOfParent(db, a.id).length
      )[0] || parent,
      parents,
      children,
    });
    if (households.length >= limit) break;
  }
  return households;
}

export function householdMergeCandidatesPayload(candidates = []) {
  return {
    families: candidates.map(({ parent, parents, children }) => ({
      parent_id: String(parent.id),
      parent_name: parent.name || '',
      phone: parent.phone || '',
      parents: parents.map((item) => item.name || '').filter(Boolean),
      children: children.map((child) => child.name || '').filter(Boolean),
    })),
  };
}

/**
 * Join two households the desk recognises as one family — the mirror image of
 * splitFamily. Every parent becomes a guardian of every child, so the leads
 * table shows one row with both parents and all the children on it.
 *
 * Whole households merge, not only the two cards that were picked: a parent who
 * shares a child with either of them is already part of that family, and
 * leaving them out would tear the row in two again on the next read.
 *
 * Nothing is deleted or overwritten — each child keeps its primary parent — so
 * the split dialog can undo this in full.
 */
export function mergeHouseholds(db, { parentId, otherParentId } = {}) {
  const ours = db.getOne('parents', parentId);
  const theirs = db.getOne('parents', otherParentId);
  if (!ours) return { ok: false, error: 'כרטיס הלקוח לא נמצא' };
  if (!theirs) return { ok: false, error: 'כרטיס הלקוח למיזוג לא נמצא' };
  if (String(ours.id) === String(theirs.id)) {
    return { ok: false, error: 'אי אפשר למזג לקוח עם עצמו' };
  }

  const here = expandHousehold(db, ours.id);
  const there = expandHousehold(db, theirs.id);
  if (here.parentIds.includes(String(theirs.id))) {
    return { ok: false, error: 'שני הלקוחות כבר באותה משפחה' };
  }

  const parentIds = [...new Set([...here.parentIds, ...there.parentIds].map(String))];
  const childIds = new Set();
  const children = [];
  for (const child of [...here.students, ...there.students]) {
    if (child.isAdult === true || childIds.has(String(child.id))) continue;
    childIds.add(String(child.id));
    children.push(child);
  }
  // With no child on either side there is nothing that ties the cards together:
  // the household is derived from shared children, so the merge would not hold.
  if (!children.length) {
    return { ok: false, error: 'אין ילדים באף אחד מהכרטיסים — אין מה לאחד' };
  }

  const links = [];
  for (const child of children) {
    for (const id of parentIds) {
      const link = linkGuardian(db, { studentId: child.id, parentId: id, source: 'staff-merge' });
      if (link) links.push(link);
    }
  }
  return { ok: true, links, parentIds, childIds: [...childIds] };
}

// No backfill and no row for the primary parent: `students.parentId` already
// states it, and every reader here derives the full list from both. The link
// table stays small and holds only what nothing else records.
