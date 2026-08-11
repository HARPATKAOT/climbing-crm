import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAMS,
  canPlaceInRestrictedGroup,
  evaluateProgramCandidate,
  isStrongLevelCandidate,
  programForGroup,
  programMatchesGrade,
  reviewProgramApproval,
  setSharedProgramEligibility,
} from './placementEligibility.js';

test('a returning eligibility flag lets the bot continue without staff approval', () => {
  const student = { id: 'returning-student' };
  const group = { id: 'young-squad', name: 'נבחרת צעירה', ageCategory: 'חטיבה', skillLevel: 'נבחרת' };
  const db = {
    get: (table) => (table === 'program_eligibility' ? [{
      id: 'returning-row',
      student_id: student.id,
      program: PROGRAMS.YOUNG_SQUAD,
      season: '2026-27',
      status: 'returning',
    }] : []),
  };

  const result = canPlaceInRestrictedGroup(db, student, group, { season: '2026-27' });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'returning');
});

test('one returning eligibility permits moving between every advanced and squad group', () => {
  const student = { id: 'returning-student' };
  const rows = [{
    id: 'returning-row',
    student_id: student.id,
    program: PROGRAMS.YOUNG_SQUAD,
    season: '2026-27',
    status: 'returning',
  }];
  const db = { get: (table) => (table === 'program_eligibility' ? rows : []) };
  const adultSquad = { id: 'adult', name: 'נבחרת בוגרת', ageCategory: 'תיכון', skillLevel: 'נבחרת' };
  const advanced = { id: 'advanced', name: 'מתקדמים ד-ו', ageCategory: 'ד-ו', skillLevel: 'מתקדמים' };

  assert.equal(canPlaceInRestrictedGroup(db, student, adultSquad, { season: '2026-27' }).allowed, true);
  assert.equal(canPlaceInRestrictedGroup(db, student, advanced, { season: '2026-27' }).allowed, true);
});

test('one approved eligibility permits another restricted programme without a second approval', () => {
  const student = { id: 'approved-student' };
  const db = {
    get: (table) => (table === 'program_eligibility' ? [{
      id: 'approved-row', student_id: student.id, program: PROGRAMS.ADVANCED,
      season: '2026-27', status: 'approved',
    }] : []),
  };
  const youngSquad = { id: 'young', name: 'נבחרת צעירה', ageCategory: 'חטיבה', skillLevel: 'נבחרת' };

  const result = canPlaceInRestrictedGroup(db, student, youngSquad, { season: '2026-27' });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'approved');
});

test('staff can grant and revoke the shared eligibility from the student card', async () => {
  const tables = {
    students: [{ id: 'student', parentId: 'parent' }],
    program_eligibility: [],
    placement_requests: [{ id: 'pending', student_id: 'student', season: '2026-27', status: 'pending' }],
  };
  const db = {
    get: (table) => tables[table] || [],
    getOne: (table, id) => (tables[table] || []).find((row) => row.id === id),
    insert: (table, row) => { (tables[table] ||= []).push(row); return row; },
    update: (table, id, patch) => {
      const row = (tables[table] || []).find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };

  const granted = await setSharedProgramEligibility(db, async () => {}, {
    studentId: 'student', eligible: true, season: '2026-27', actor: 'owner',
  });
  assert.equal(granted.eligible, true);
  assert.equal(granted.rows[0].program, PROGRAMS.SHARED);
  assert.equal(granted.rows[0].status, 'approved');

  const revoked = await setSharedProgramEligibility(db, async () => {}, {
    studentId: 'student', eligible: false, season: '2026-27', actor: 'owner',
  });
  assert.equal(revoked.eligible, false);
  assert.equal(revoked.rows[0].status, 'rejected');
  assert.equal(tables.placement_requests[0].status, 'rejected');
});

test('6B in middle school is a strong young-squad candidate but still needs approval', () => {
  const group = { name: 'נבחרת צעירה', ageCategory: 'חטיבה', skillLevel: 'נבחרת' };
  const result = evaluateProgramCandidate({
    student: { id: 'ethan', levelGrade: '6B' },
    group,
    gradeOrBand: 'חטיבה',
  });
  assert.equal(programForGroup(group), PROGRAMS.YOUNG_SQUAD);
  assert.equal(result.candidate, true);
  assert.equal(result.strength, 'strong');
  assert.equal(result.requiresApproval, true);
  assert.equal(result.allowed, false);
});

test('5B is possible and below 5A is not proactively offered', () => {
  const group = { name: 'מתקדמים ד-ו', ageCategory: 'ד׳-ו׳', skillLevel: 'מתקדמים' };
  const possible = evaluateProgramCandidate({ student: { levelGrade: '5B' }, group, gradeOrBand: 'כיתה ה' });
  const below = evaluateProgramCandidate({ student: { levelGrade: '4C' }, group, gradeOrBand: 'כיתה ה' });
  assert.equal(possible.candidate, true);
  assert.equal(possible.strength, 'possible');
  assert.equal(below.candidate, false);
  assert.equal(below.reason, 'level_below_5a');
});

test('רמה שלא נמדדה אינה רמה נמוכה — הבקשה מגיעה לצוות במקום להידחות', () => {
  // מהשיחה של יערה: שתי בנות חדשות, בקשה לנבחרת, ואיש לא ראה אותה.
  const group = { name: 'נבחרת צעירה', ageCategory: 'חטיבה', skillLevel: 'נבחרת' };
  const unknown = evaluateProgramCandidate({ student: { id: 's-new' }, group, gradeOrBand: 'חטיבה' });
  assert.equal(unknown.candidate, true);
  assert.equal(unknown.strength, 'unknown');
  assert.equal(unknown.reason, 'level_unknown_requires_staff_approval');

  // רמה שנמדדה ונמצאה נמוכה ממשיכה להיענות בקבוצה רגילה, לא בבקשה.
  const measured = evaluateProgramCandidate({ student: { levelGrade: '4C' }, group, gradeOrBand: 'חטיבה' });
  assert.equal(measured.candidate, false);
  assert.equal(measured.reason, 'level_below_5a');
});

test('grade bands are matched without treating arbitrary Hebrew letters as a grade', () => {
  assert.equal(programMatchesGrade(PROGRAMS.ADVANCED, 'כיתה ד׳'), true);
  assert.equal(programMatchesGrade(PROGRAMS.YOUNG_SQUAD, 'חטיבה'), true);
  assert.equal(programMatchesGrade(PROGRAMS.ADULT_SQUAD, 'תיכון'), true);
  assert.equal(programMatchesGrade(PROGRAMS.ADVANCED, 'חטיבה'), false);
  assert.equal(isStrongLevelCandidate('6A'), true);
});

test('retrying the same approval returns the group so its unfinished continuation can recover', async () => {
  const request = {
    id: 'request',
    status: 'approved',
    group_id: 'adult-squad',
    eligibility_id: 'eligibility',
  };
  const group = { id: 'adult-squad', name: 'נבחרת בוגרת' };
  const eligibility = { id: 'eligibility', status: 'approved' };
  const tables = {
    placement_requests: [request],
    groups: [group],
    program_eligibility: [eligibility],
  };
  const db = {
    getOne: (table, id) => (tables[table] || []).find((row) => row.id === id),
  };
  const result = await reviewProgramApproval(db, async () => {}, request.id, { decision: 'approved' });
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.group, group);
  assert.equal(result.eligibility, eligibility);

  const conflict = await reviewProgramApproval(db, async () => {}, request.id, { decision: 'rejected' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, 'request_already_reviewed');
});
