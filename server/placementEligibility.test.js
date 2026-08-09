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
