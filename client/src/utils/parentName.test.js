import test from 'node:test';
import assert from 'node:assert/strict';
import { joinParentName, splitParentName } from './parentName.js';

test('שם משפחה של מילה אחת יורד מהזנב', () => {
  assert.deepEqual(
    splitParentName({ name: 'דנה כהן', lastName: 'כהן' }),
    { first: 'דנה', lastName: 'כהן' }
  );
});

test('שם משפחה של שתי מילים יורד גם הוא — כאן נולדה הכפילות', () => {
  // „יערה שינברג באדר”: הושוותה רק המילה האחרונה, „באדר”, אז שם המשפחה לא
  // ירד, תיבת השם הפרטי הכילה את השם המלא, והשמירה הוסיפה אותו שוב.
  assert.deepEqual(
    splitParentName({ name: 'יערה שינברג באדר', lastName: 'שינברג באדר' }),
    { first: 'יערה', lastName: 'שינברג באדר' }
  );
});

test('עריכה ושמירה חוזרות על עצמן בלי לצבור שם', () => {
  const stored = { name: 'יערה שינברג באדר', lastName: 'שינברג באדר' };
  const shown = splitParentName(stored);
  const saved = joinParentName(shown.first, shown.lastName);
  assert.equal(saved, 'יערה שינברג באדר');
  // וסיבוב נוסף מאותו מצב מחזיר בדיוק את אותו דבר.
  assert.equal(joinParentName(...Object.values(splitParentName({ name: saved, lastName: stored.lastName }))), saved);
});

test('כרטיס שכבר נכפל מוצג נכון ומתרפא בשמירה הבאה', () => {
  assert.deepEqual(
    splitParentName({ name: 'יערה שינברג באדר שינברג באדר', lastName: 'שינברג באדר' }),
    { first: 'יערה', lastName: 'שינברג באדר' }
  );
});

test('שם שאינו מסתיים בשם המשפחה נשאר שלם', () => {
  assert.deepEqual(
    splitParentName({ name: 'יערה שינברג', lastName: 'באדר' }),
    { first: 'יערה שינברג', lastName: 'באדר' }
  );
});

test('בלי שם משפחה שמור — המילה האחרונה היא הניחוש היחיד', () => {
  assert.deepEqual(splitParentName({ name: 'דנה כהן' }), { first: 'דנה', lastName: 'כהן' });
  assert.deepEqual(splitParentName({ name: 'דנה' }), { first: 'דנה', lastName: '' });
  assert.deepEqual(splitParentName({}), { first: '', lastName: '' });
});
