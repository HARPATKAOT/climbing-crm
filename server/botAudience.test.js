import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAgeYears,
  gradeLettersFromAge,
  resolveAudienceFilter,
  groupMatchesGradeLetter,
  ASK_GRADE_REPLY,
} from './whatsapp.js';

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

test('כיתה ב matches א׳-ב׳ only — not Thursday ב׳+ה׳ names or בוגרת', () => {
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: "א'-ב'", name: "הורים וילדים — יום ג׳ 17:10" }, 'ב'),
    true
  );
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: "ה'-ו'", name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30" }, 'ב'),
    false
  );
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: 'חטיבה', name: 'נבחרת צעירה — ב׳+ה׳ 17:00' }, 'ב'),
    false
  );
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: 'תיכון', name: 'נבחרת בוגרת — ב׳+ה׳ 19:10' }, 'ב'),
    false
  );
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: 'בוגרים', name: "בוגרים — יום א׳ 20:10" }, 'ב'),
    false
  );
});

test('name fallback still strips weekday pairs when ageCategory is empty', () => {
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: '', name: "כיתות א'-ב' — יום ג׳" }, 'ב'),
    true
  );
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: '', name: 'נבחרת בוגרת — ב׳+ה׳ 19:10' }, 'ב'),
    false
  );
});
