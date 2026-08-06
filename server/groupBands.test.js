/**
 * Matching a group to a grade letter.
 *
 * These two cases outlived the keyword layer they were written for: the tools
 * path filters groups by the same function, so «כיתה ב׳» must still never match
 * a Thursday «ב׳+ה׳» in a group name, or the ב inside «בוגרת».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMatchesGradeLetter } from './groupBands.js';

test('כיתה ב matches א׳-ב׳ only — not Thursday ב׳+ה׳ names or בוגרת', () => {
  assert.equal(
    groupMatchesGradeLetter({ ageCategory: "א'-ב'", name: 'הורים וילדים — יום ג׳ 17:10' }, 'ב'),
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
    groupMatchesGradeLetter({ ageCategory: 'בוגרים', name: 'בוגרים — יום א׳ 20:10' }, 'ב'),
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
