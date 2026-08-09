import { enrichGroupWithBotMeta } from './groupMetadata.js';

export const ELIGIBILITY_COLLECTION = 'program_eligibility';
export const PLACEMENT_REQUEST_COLLECTION = 'placement_requests';

export const PROGRAMS = Object.freeze({
  ADVANCED: 'advanced',
  YOUNG_SQUAD: 'young_squad',
  ADULT_SQUAD: 'adult_squad',
});

export const ELIGIBILITY_STATUSES = new Set(['returning', 'pending', 'approved', 'rejected']);

const LEVEL_RANK = Object.freeze({
  '5A': 1, '5B': 2, '5C': 3,
  '6A': 4, '6B': 5, '6C': 6,
  '7A': 7, '7B': 8, '7C': 9,
  '8A': 10, '8B': 11, '8C': 12,
});

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeLevel(value) {
  const match = clean(value).toUpperCase().match(/\b([5-8][ABC])\b/);
  return match?.[1] || '';
}

export function levelRank(value) {
  return LEVEL_RANK[normalizeLevel(value)] || 0;
}

export function isLevelCandidate(value) {
  return levelRank(value) >= LEVEL_RANK['5A'];
}

export function isStrongLevelCandidate(value) {
  return levelRank(value) >= LEVEL_RANK['6A'];
}

export function normalizeGrade(value) {
  const source = clean(value)
    .replace(/["'׳״]/g, '')
    .replace(/^כיתה\s*/u, '');
  const found = source.match(/[א-יב]{1,2}/u)?.[0] || '';
  return found;
}

export function programForGroup(group) {
  const text = `${group?.skillLevel || ''} ${group?.name || ''} ${group?.ageCategory || ''}`;
  if (/נבחרת/u.test(text)) {
    return /בוגרת|תיכון/u.test(text) ? PROGRAMS.ADULT_SQUAD : PROGRAMS.YOUNG_SQUAD;
  }
  if (/מתקדמ/u.test(text)) return PROGRAMS.ADVANCED;
  return null;
}

export function isRestrictedGroup(group) {
  return Boolean(programForGroup(group));
}

export function programMatchesGrade(program, gradeOrBand) {
  const value = clean(gradeOrBand).replace(/[׳'״"]/g, '');
  const compact = value.replace(/\s+/g, '');
  if (program === PROGRAMS.ADVANCED) {
    return /כית(?:ה|ות)\s*[דהו]|(?:^|[^א-ת])[דהו](?:$|[^א-ת])|ד-ו/u.test(value);
  }
  if (program === PROGRAMS.YOUNG_SQUAD) {
    return /חטיבה|כית(?:ה|ות)\s*[זחט]|(?:^|[^א-ת])[זחט](?:$|[^א-ת])|ז-ט/u.test(value);
  }
  if (program === PROGRAMS.ADULT_SQUAD) {
    return /תיכון|בוגרים|כית(?:ה|ות)\s*(?:י|יא|יב)|(?:^|[^א-ת])(?:י|יא|יב)(?:$|[^א-ת])/u.test(compact);
  }
  return false;
}

export function currentSeason(now = new Date()) {
  const date = new Date(now);
  const startYear = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function eligibilityRows(db) {
  const rows = db?.get?.(ELIGIBILITY_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

export function placementRequestRows(db) {
  const rows = db?.get?.(PLACEMENT_REQUEST_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

export function eligibilityForStudent(db, studentId, { season = currentSeason() } = {}) {
  return eligibilityRows(db).filter((row) => (
    String(row.student_id) === String(studentId) && String(row.season) === String(season)
  ));
}

export function latestLevelTest(db, studentId) {
  const rows = (db?.get?.('level_tests') || [])
    .filter((row) => String(row.studentId || row.student_id) === String(studentId))
    .sort((a, b) => String(b.date || b.created_at || '').localeCompare(String(a.date || a.created_at || '')));
  const level = normalizeLevel(rows[0]?.level || db?.getOne?.('students', studentId)?.levelGrade);
  return { level, test: rows[0] || null };
}

export function evaluateProgramCandidate({ student, group, gradeOrBand = '', level = '' } = {}) {
  const program = programForGroup(group);
  if (!program) return { restricted: false, allowed: true, reason: 'regular_group' };
  const effectiveLevel = normalizeLevel(level || student?.levelGrade);
  const band = clean(gradeOrBand || group?.ageCategory);
  if (!programMatchesGrade(program, band)) {
    return { restricted: true, allowed: false, candidate: false, program, level: effectiveLevel, reason: 'age_or_grade_mismatch' };
  }
  if (!isLevelCandidate(effectiveLevel)) {
    return { restricted: true, allowed: false, candidate: false, program, level: effectiveLevel, reason: 'level_below_5a' };
  }
  return {
    restricted: true,
    allowed: false,
    candidate: true,
    requiresApproval: true,
    strength: isStrongLevelCandidate(effectiveLevel) ? 'strong' : 'possible',
    program,
    level: effectiveLevel,
    reason: 'new_candidate_requires_staff_approval',
  };
}

export function capacityAfterReturningPriority(db, group, { now = new Date(), season = currentSeason(now) } = {}) {
  const enriched = enrichGroupWithBotMeta(db, group);
  const max = Number(enriched?.maxSlots);
  if (!Number.isFinite(max)) return { available: null, reserved: 0, blockedByPriority: false };
  const active = (db?.get?.('enrollments') || []).filter((row) => (
    String(row.group_id) === String(group?.id)
      && !row.end_date
      && !['cancelled', 'rejected'].includes(String(row.status || ''))
  )).length;
  const priorityOpen = Boolean(enriched.returningPriorityUntil)
    && String(enriched.returningPriorityUntil) >= new Date(now).toISOString().slice(0, 10);
  const returningIds = new Set(eligibilityRows(db)
    .filter((row) => row.season === season && row.program === programForGroup(group) && row.status === 'returning')
    .map((row) => String(row.student_id)));
  const enrolledIds = new Set((db?.get?.('enrollments') || [])
    .filter((row) => String(row.group_id) === String(group?.id) && !row.end_date)
    .map((row) => String(row.student_id)));
  const reserved = priorityOpen
    ? [...returningIds].filter((studentId) => !enrolledIds.has(studentId)).length
    : 0;
  return {
    available: Math.max(0, max - active - reserved),
    reserved,
    blockedByPriority: reserved > 0,
  };
}

export async function requestProgramApproval(db, persist, {
  student,
  parent = null,
  group,
  gradeOrBand = '',
  source = 'level_candidate',
  note = '',
  season = currentSeason(),
} = {}) {
  if (!student?.id || !group?.id) return { ok: false, error: 'missing_student_or_group' };
  const latest = latestLevelTest(db, student.id);
  const evaluation = evaluateProgramCandidate({ student, group, gradeOrBand, level: latest.level });
  if (!evaluation.candidate) return { ok: false, evaluation, error: evaluation.reason };

  const program = evaluation.program;
  const id = `pe-${season}-${student.id}-${program}`;
  const requestId = `pr-${season}-${student.id}-${program}`;
  const existingEligibility = db.getOne(ELIGIBILITY_COLLECTION, id);
  if (existingEligibility?.status === 'approved' || existingEligibility?.status === 'returning') {
    return { ok: true, duplicate: true, eligibility: existingEligibility, evaluation };
  }
  const now = new Date().toISOString();
  const eligibility = {
    id,
    student_id: student.id,
    parent_id: parent?.id || student.parentId || null,
    group_id: group.id,
    program,
    season,
    status: 'pending',
    source,
    level: latest.level,
    strength: evaluation.strength,
    requestedAt: existingEligibility?.requestedAt || now,
    reviewedAt: null,
    reviewedBy: null,
    note: clean(note),
    updated_at: now,
  };
  const savedEligibility = existingEligibility
    ? db.update(ELIGIBILITY_COLLECTION, id, eligibility)
    : db.insert(ELIGIBILITY_COLLECTION, eligibility);
  if (savedEligibility && typeof persist === 'function') await persist(ELIGIBILITY_COLLECTION, savedEligibility);

  const existingRequest = db.getOne(PLACEMENT_REQUEST_COLLECTION, requestId);
  const request = {
    id: requestId,
    eligibility_id: id,
    student_id: student.id,
    student_name: student.name || '',
    parent_id: parent?.id || student.parentId || null,
    parent_name: parent?.name || '',
    group_id: group.id,
    group_name: group.name || '',
    program,
    season,
    status: 'pending',
    grade_or_band: clean(gradeOrBand),
    level: latest.level,
    strength: evaluation.strength,
    reason: evaluation.reason,
    created_at: existingRequest?.created_at || now,
    updated_at: now,
  };
  const savedRequest = existingRequest
    ? db.update(PLACEMENT_REQUEST_COLLECTION, requestId, request)
    : db.insert(PLACEMENT_REQUEST_COLLECTION, request);
  if (savedRequest && typeof persist === 'function') await persist(PLACEMENT_REQUEST_COLLECTION, savedRequest);
  return { ok: true, duplicate: Boolean(existingRequest), eligibility: savedEligibility, request: savedRequest, evaluation };
}

export async function reviewProgramApproval(db, persist, requestId, {
  decision,
  actor = '',
  note = '',
  now = new Date(),
} = {}) {
  const request = db.getOne(PLACEMENT_REQUEST_COLLECTION, requestId);
  if (!request) return { ok: false, status: 404, error: 'request_not_found' };
  if (!['approved', 'rejected'].includes(decision)) return { ok: false, status: 400, error: 'invalid_decision' };
  if (request.status !== 'pending') return { ok: true, duplicate: true, request };
  const group = db.getOne('groups', request.group_id);
  if (!group) return { ok: false, status: 409, error: 'group_not_found' };
  if (decision === 'approved') {
    const capacity = capacityAfterReturningPriority(db, group, { now, season: request.season });
    if (capacity.available !== null && capacity.available <= 0) {
      return { ok: false, status: 409, error: capacity.blockedByPriority ? 'returning_priority_reserved' : 'group_full', capacity };
    }
  }
  const reviewedAt = new Date(now).toISOString();
  const updatedRequest = db.update(PLACEMENT_REQUEST_COLLECTION, request.id, {
    status: decision,
    reviewed_at: reviewedAt,
    reviewed_by: actor || null,
    review_note: clean(note),
    updated_at: reviewedAt,
  });
  const eligibility = db.getOne(ELIGIBILITY_COLLECTION, request.eligibility_id);
  const updatedEligibility = eligibility && db.update(ELIGIBILITY_COLLECTION, eligibility.id, {
    status: decision,
    reviewedAt,
    reviewedBy: actor || null,
    note: clean(note) || eligibility.note || '',
    updated_at: reviewedAt,
  });
  if (typeof persist === 'function') {
    if (updatedRequest) await persist(PLACEMENT_REQUEST_COLLECTION, updatedRequest);
    if (updatedEligibility) await persist(ELIGIBILITY_COLLECTION, updatedEligibility);
  }
  return { ok: true, request: updatedRequest, eligibility: updatedEligibility, group };
}

export function canPlaceInRestrictedGroup(db, student, group, { season = currentSeason() } = {}) {
  const program = programForGroup(group);
  if (!program) return { allowed: true, reason: 'regular_group' };
  const row = eligibilityForStudent(db, student?.id, { season })
    .find((item) => item.program === program);
  if (!row || !['returning', 'approved'].includes(row.status)) {
    return { allowed: false, reason: 'staff_approval_required', eligibility: row || null };
  }
  const capacity = capacityAfterReturningPriority(db, group, { season });
  if (row.status !== 'returning' && capacity.available !== null && capacity.available <= 0) {
    return { allowed: false, reason: capacity.blockedByPriority ? 'returning_priority_reserved' : 'group_full', eligibility: row, capacity };
  }
  return { allowed: true, reason: row.status, eligibility: row, capacity };
}
