import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRAMS,
  evaluateProgramCandidate,
  isStrongLevelCandidate,
  programForGroup,
  programMatchesGrade,
} from './placementEligibility.js';

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
