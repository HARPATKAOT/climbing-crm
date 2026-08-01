import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAgeYears,
  gradeLettersFromAge,
  resolveAudienceFilter,
  groupMatchesGradeLetter,
  isBareAudienceAnswer,
  askWhichChildReply,
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

test('the bot asking "באיזו כיתה הילד/ה" is not itself a grade', () => {
  // The full ask also spells out «בן 7» as an example, so only the customer's
  // own lines are scanned for an audience — see resolveAudienceWithMemory.
  assert.deepEqual(resolveAudienceFilter('באיזו כיתה הילד/ה?', []).letters, []);
  assert.deepEqual(resolveAudienceFilter('כיתה ה׳', []).letters, ['ה']);
  assert.deepEqual(resolveAudienceFilter('כיתה ה', []).letters, ['ה']);
});

test('a toddler on the family card resolves to no grade at all', () => {
  assert.deepEqual(gradeLettersFromAge(1), []);
  assert.deepEqual(gradeLettersFromAge(5), []);
  assert.deepEqual(gradeLettersFromAge(6), ['א', 'ב']);
  // A baby's birth date on the card must not answer "יש לכם חוג לילדים?"
  const babyCard = [{ name: 'שקד', birthDate: new Date(Date.now() - 640 * 864e5).toISOString().slice(0, 10) }];
  assert.deepEqual(resolveAudienceFilter('יש לכם חוג לילדים?', babyCard).letters, []);
});

test('naming a child on the card answers for that child only', () => {
  const kids = [
    { name: 'שקד איל', birthDate: '2024-10-15' },
    { name: 'עומרי איל', ageCategory: "ג'-ד'" },
  ];
  assert.deepEqual(resolveAudienceFilter('בשביל עומרי', kids).letters, ['ג', 'ד']);
  // The toddler has no band, and that is not the same as "no child named".
  const baby = resolveAudienceFilter('בשביל שקד', kids);
  assert.equal(baby.source, 'child');
  assert.deepEqual(baby.letters, []);
  // A name that is not on the card is not a child answer.
  assert.equal(resolveAudienceFilter('בשביל יונתן', kids).source !== 'child', true);
});

test('with kids on the card the bot asks which child, not which grade', () => {
  assert.match(askWhichChildReply([{ name: 'שקד איל' }]), /בשביל שקד/);
  const two = askWhichChildReply([{ name: 'שקד איל' }, { name: 'עומרי איל' }]);
  assert.match(two, /שקד/);
  assert.match(two, /עומרי/);
  assert.equal(askWhichChildReply([]), '');
  // Placeholder children created when the name is unknown are not offered back.
  assert.equal(askWhichChildReply([{ name: 'ילד/ה של לקוח וואטסאפ' }]), '');
});

test('a bare grade answer inherits the previous question', () => {
  assert.equal(isBareAudienceAnswer('כיתה ג'), true);
  assert.equal(isBareAudienceAnswer('בן 8'), true);
  assert.equal(isBareAudienceAnswer('כיתה ג, יש מקום?'), false);
  assert.equal(isBareAudienceAnswer('מתי אתם פתוחים?'), false);
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
