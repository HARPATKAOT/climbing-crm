import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearanceTriggers,
  declarationGap,
  isChildOnlyQuestion,
  isScreeningQuestion,
  needsMedicalClearance,
  questionLabel,
  questionsForSigner,
  requiresClearance,
} from './healthQuestions.js';

test('markers are read from the label in any order', () => {
  const screen = { label: '?האם יש אסתמה?' };
  const parentOnly = { label: '@אין להשאיר ילד עד גיל 11' };
  const both = { label: '?!האם רופא הגביל פעילות גופנית?' };
  const reversed = { label: '!?האם רופא הגביל פעילות גופנית?' };

  assert.equal(isScreeningQuestion(screen), true);
  assert.equal(isChildOnlyQuestion(parentOnly), true);
  assert.equal(requiresClearance(both), true);
  assert.equal(isScreeningQuestion(both), true);
  assert.equal(requiresClearance(reversed), true);
  assert.equal(questionLabel(both), 'האם רופא הגביל פעילות גופנית?');
  assert.equal(questionLabel(parentOnly), 'אין להשאיר ילד עד גיל 11');
});

test('explicit fields win over the label markers', () => {
  const stored = { kind: 'confirm', audience: 'child', requiresClearance: false, label: 'אין להשאיר ילד' };
  assert.equal(isChildOnlyQuestion(stored), true);
  assert.equal(isScreeningQuestion(stored), false);
  assert.equal(requiresClearance(stored), false);
});

test('an adult signing for themselves is not asked about a child', () => {
  const questions = [
    { id: 'a', kind: 'confirm', requireYes: true, label: 'יש להישמע להוראות המדריכים' },
    { id: 'b', kind: 'confirm', requireYes: true, audience: 'child', label: 'אין להשאיר ילד עד גיל 11' },
  ];

  assert.deepEqual(questionsForSigner(questions, { isAdultSelf: true }).map((q) => q.id), ['a']);
  assert.deepEqual(questionsForSigner(questions, { isAdultSelf: false }).map((q) => q.id), ['a', 'b']);
});

test('a parent-only clause is not demanded from an adult', () => {
  const questions = [
    { id: 'a', kind: 'confirm', requireYes: true, label: 'יש להישמע להוראות המדריכים' },
    { id: 'b', kind: 'confirm', requireYes: true, audience: 'child', label: 'אין להשאיר ילד עד גיל 11' },
  ];
  const answers = { a: true };

  assert.equal(declarationGap(questions, answers, 'דנה'), 'יש לסמן את כל סעיפי ההצהרה עבור דנה');
  assert.equal(
    declarationGap(questionsForSigner(questions, { isAdultSelf: true }), answers, 'דנה'),
    ''
  );
});

test('only a "yes" on a marked question calls for a doctor\'s approval', () => {
  const questions = [
    { id: 'm7', kind: 'screen', label: 'האם יש אלרגיה?' },
    { id: 'm8', kind: 'screen', requiresClearance: true, label: 'האם רופא הגביל פעילות גופנית?' },
  ];

  assert.equal(needsMedicalClearance(questions, { m7: true, m8: false }), false);
  assert.equal(needsMedicalClearance(questions, { m7: true, m8: true }), true);
  assert.deepEqual(clearanceTriggers(questions, { m8: true }).map((q) => q.id), ['m8']);
});

test('an unanswered screening question is never filed as "no"', () => {
  const questions = [{ id: 'm1', kind: 'screen', label: 'האם יש אסתמה?' }];
  assert.equal(declarationGap(questions, {}, 'יואב'), 'יש לענות על כל שאלות הבריאות עבור יואב');
  assert.equal(declarationGap(questions, { m1: false }, 'יואב'), '');
});
