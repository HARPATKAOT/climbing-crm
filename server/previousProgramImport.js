import {
  currentSeason,
  ELIGIBILITY_COLLECTION,
  isRestrictedGroup,
  programForGroup,
  PROGRAMS,
} from './placementEligibility.js';

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('he');
}
function programFromRow(row = {}) {
  const explicit = String(row.program || '').trim();
  if (Object.values(PROGRAMS).includes(explicit)) return explicit;
  const text = `${row.group_name || row.groupName || ''} ${row.group || ''}`;
  if (/נבחרת/.test(text)) return /בוגרת|תיכון/.test(text) ? PROGRAMS.ADULT_SQUAD : PROGRAMS.YOUNG_SQUAD;
  if (/מתקדמ/.test(text)) return PROGRAMS.ADVANCED;
  return '';
}

function groupFromRow(db, row, program) {
  const groups = (db.get('groups') || []).filter(isRestrictedGroup);
  const explicitId = String(row.group_id || row.groupId || '').trim();
  if (explicitId) return groups.find((group) => String(group.id) === explicitId) || null;
  const sourceName = normalizedName(row.group_name || row.groupName || row.group || '');
  const byProgram = groups.filter((group) => programForGroup(group) === program);
  const byName = sourceName
    ? byProgram.filter((group) => {
      const current = normalizedName(group.name);
      return current === sourceName || current.includes(sourceName) || sourceName.includes(current);
    })
    : [];
  if (byName.length === 1) return byName[0];
  return byProgram.length === 1 ? byProgram[0] : null;
}

export function buildPreviousProgramImportReport(db, sourceRows = [], { season = currentSeason() } = {}) {
  const students = db.get('students') || [];
  const byName = new Map();
  for (const student of students) {
    const key = normalizedName(student.name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(student);
  }

  const report = { season, exact: [], missing: [], ambiguous: [], invalid: [] };
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const name = String(row.student_name || row.studentName || row.name || '').trim();
    const program = programFromRow(row);
    const group = program ? groupFromRow(db, row, program) : null;
    if (!name || !program || !group) {
      report.invalid.push({
        source: row,
        reason: !name ? 'missing_name' : (!program ? 'unknown_program' : 'group_not_found'),
      });
      continue;
    }
    const matches = byName.get(normalizedName(name)) || [];
    if (matches.length === 0) {
      report.missing.push({ name, program, group_id: group.id, group_name: group.name || '' });
    } else if (matches.length > 1) {
      report.ambiguous.push({
        name,
        program,
        student_ids: matches.map((student) => student.id),
        group_id: group.id,
        group_name: group.name || '',
      });
    } else {
      report.exact.push({
        name,
        student_id: matches[0].id,
        parent_id: matches[0].parentId || null,
        program,
        group_id: group.id,
        group_name: group.name || '',
      });
    }
  }
  return report;
}

export async function applyPreviousProgramImport(db, persist, report) {
  const saved = [];
  const desiredByStudent = new Map();
  for (const match of report?.exact || []) {
    if (!desiredByStudent.has(String(match.student_id))) desiredByStudent.set(String(match.student_id), new Set());
    desiredByStudent.get(String(match.student_id)).add(String(match.group_id));
  }
  for (const match of report?.exact || []) {
    const id = `pe-${report.season}-${match.student_id}-group-${match.group_id}`;
    const existing = db.getOne(ELIGIBILITY_COLLECTION, id);
    const now = new Date().toISOString();
    const row = {
      id,
      student_id: match.student_id,
      parent_id: match.parent_id,
      program: match.program,
      group_id: match.group_id,
      group_ids: [match.group_id],
      season: report.season,
      status: 'returning',
      source: 'notion_previous_season',
      requestedAt: existing?.requestedAt || now,
      reviewedAt: existing?.reviewedAt || now,
      reviewedBy: existing?.reviewedBy || 'notion-import',
      note: existing?.note || '',
      updated_at: now,
    };
    const result = existing
      ? db.update(ELIGIBILITY_COLLECTION, id, row)
      : db.insert(ELIGIBILITY_COLLECTION, row);
    if (result && typeof persist === 'function') await persist(ELIGIBILITY_COLLECTION, result);
    if (result) saved.push(result);
  }

  // The imported roster is the exact answer for these trainees. Retire any
  // old programme-wide or different-group permission so the bot cannot offer
  // a group that was not present in the supplied lists. Multiple listed
  // groups for the same trainee are retained.
  const now = new Date().toISOString();
  for (const [studentId, desiredGroupIds] of desiredByStudent) {
    for (const oldRow of (db.get(ELIGIBILITY_COLLECTION) || []).filter((item) => (
      String(item.student_id) === studentId
      && String(item.season) === String(report.season)
      && ['returning', 'approved', 'pending'].includes(String(item.status || ''))
      && !desiredGroupIds.has(String(item.group_id || ''))
    ))) {
      const retired = db.update(ELIGIBILITY_COLLECTION, oldRow.id, {
        status: 'rejected',
        reviewedAt: now,
        reviewedBy: 'group-specific-import',
        updated_at: now,
      });
      if (retired && typeof persist === 'function') await persist(ELIGIBILITY_COLLECTION, retired);
    }
  }
  return saved;
}
