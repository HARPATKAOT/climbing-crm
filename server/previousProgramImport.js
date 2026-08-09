import { currentSeason, ELIGIBILITY_COLLECTION, PROGRAMS } from './placementEligibility.js';

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
    if (!name || !program) {
      report.invalid.push({ source: row, reason: !name ? 'missing_name' : 'unknown_program' });
      continue;
    }
    const matches = byName.get(normalizedName(name)) || [];
    if (matches.length === 0) {
      report.missing.push({ name, program, group_name: row.group_name || row.groupName || '' });
    } else if (matches.length > 1) {
      report.ambiguous.push({
        name,
        program,
        student_ids: matches.map((student) => student.id),
        group_name: row.group_name || row.groupName || '',
      });
    } else {
      report.exact.push({
        name,
        student_id: matches[0].id,
        parent_id: matches[0].parentId || null,
        program,
        group_name: row.group_name || row.groupName || '',
      });
    }
  }
  return report;
}

export async function applyPreviousProgramImport(db, persist, report) {
  const saved = [];
  for (const match of report?.exact || []) {
    const id = `pe-${report.season}-${match.student_id}-${match.program}`;
    const existing = db.getOne(ELIGIBILITY_COLLECTION, id);
    const now = new Date().toISOString();
    const row = {
      id,
      student_id: match.student_id,
      parent_id: match.parent_id,
      program: match.program,
      season: report.season,
      status: 'returning',
      source: 'notion_previous_season',
      // Eligibility is deliberately independent of placement. If the same
      // row previously came from an approval request, remove that stale group
      // choice while keeping brand-new eligibility rows free of group data.
      ...(existing?.group_id ? { group_id: null } : {}),
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
  return saved;
}
