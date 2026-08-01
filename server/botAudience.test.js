import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAgeYears, gradeLettersFromAge, resolveAudienceFilter, ASK_GRADE_REPLY } from './whatsapp.js';

test('extractAgeYears reads בן/בת/גיל', () => {
  assert.equal(extractAgeYears('לילד בן 7 כמה עולה'), 7);
  assert.equal(extractAgeYears('בת 9'), 9);
  assert.equal(extractAgeYears('גיל 6'), 6);
  assert.equal(extractAgeYears('שלום'), null);
});

test('gradeLettersFromAge bands', () => {
  assert.deepEqual(gradeLettersFromAge(7), ['א', 'ב']);
  assert.deepEqual(gradeLettersFromAge(8), ['ג', 'ד']);
  assert.deepEqual(gradeLettersFromAge(11), ['ה', 'ו']);
});

test('resolveAudienceFilter prefers explicit grade then age', () => {
  assert.deepEqual(resolveAudienceFilter('כיתה ג׳ יש מקום?').letters, ['ג']);
  assert.deepEqual(resolveAudienceFilter('בן 7 כמה עולה').letters, ['א', 'ב']);
  assert.deepEqual(resolveAudienceFilter('יש מקום בחוג?').letters, []);
});

test('grade carries from an earlier turn in the same conversation blob', () => {
  const history = [
    'לקוח: האם יש לכם חוגים לילד בכיתה ג׳ ?',
    'בוט: כן, בטח! לכיתה ג׳ יש מקום ביום א׳',
    'לקוח: מה העלות ?',
  ].join('\n');
  assert.deepEqual(resolveAudienceFilter(history, []).letters, ['ג']);
  assert.deepEqual(resolveAudienceFilter('מה העלות ?', []).letters, []);
});

test('ask-grade reply is ready for customers', () => {
  assert.match(ASK_GRADE_REPLY, /כיתה/);
  assert.match(ASK_GRADE_REPLY, /בן 7/);
});
