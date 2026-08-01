/**
 * Which declarations a climber holds, resolved for a list row.
 *
 * The customer file already answers this for one student by matching the
 * declaration feed against the student and their parent's phone. The leads
 * table needs the same answer for every climber at once — a staff member
 * scanning the list must see "signed / not signed" per activity without
 * opening each file — so the matching lives here and both sides use it.
 */

import { declarationKind } from './declarationKinds.js';
import { isHealthDeclarationValid } from './healthValidity.js';
import { normalizePhone } from './leadUtils.js';

const tailMatch = (a, b) => {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  return na === nb || na.slice(-9) === nb.slice(-9);
};

/**
 * A declaration belongs to a student when it carries their id, names them, or
 * came from the household phone without naming a different climber.
 */
export function declarationMatchesStudent(decl, student, parentPhone) {
  if (!decl || !student) return false;
  if (decl.studentId && String(decl.studentId) === String(student.id)) return true;

  const studentName = String(student.name || '').trim();
  const studentFirst = studentName.split(/\s+/)[0] || '';
  const climber = String(decl.climberName || decl.studentName || '').trim();
  const climberFirst = climber.split(/\s+/)[0] || '';

  if (parentPhone && tailMatch(decl.phone, parentPhone)) {
    if (!climber || climber === studentName || (studentFirst && climberFirst === studentFirst)) return true;
  }
  return !!climber && climber === studentName;
}

function isSigned(decl) {
  return !!(decl.signed || decl.status === 'approved' || decl.waiverAccepted);
}

/**
 * @returns {{ [kindKey: string]: { signed: boolean, expired: boolean, date: string|null } }}
 *          one entry per activity the student has a declaration for.
 */
export function studentDeclarationStatus(declarations, student, parentPhone, now = new Date()) {
  const byKind = {};
  for (const decl of declarations || []) {
    if (!declarationMatchesStudent(decl, student, parentPhone)) continue;
    if (!isSigned(decl)) continue;
    const key = declarationKind(decl).key;
    const date = decl.signedDate || decl.date || null;
    const current = byKind[key];
    // Newest signature per activity wins — an old expired one must not mask it.
    if (current && String(current.date || '') >= String(date || '')) continue;
    byKind[key] = { signed: true, expired: !isHealthDeclarationValid(date, now), date };
  }

  // The customer file also trusts these student-level marks for the wall form,
  // set when a declaration was signed before the feed carried student ids.
  if (!byKind.wall) {
    const fallback = student?.healthSignedAt || student?.waiverSignedAt || null;
    if (fallback || student?.status === 'health_signed') {
      byKind.wall = { signed: true, expired: !isHealthDeclarationValid(fallback, now), date: fallback };
    }
  }
  return byKind;
}
