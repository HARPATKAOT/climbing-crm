import test from 'node:test';
import assert from 'node:assert/strict';
import { introducedName } from './whatsappBot.js';

test('שם שנמסר באמצע משפט נקלט, וההמשך אינו נבלע לתוכו', () => {
  // מהשיחה של משה גבאי: הוא מסר שם מלא ובכל זאת נשאל עליו פעמיים.
  assert.deepEqual(
    introducedName('היי שמי משה גבאי קבעתי להגיע מחר ב 19 ואני רוצה לדחות ליום ראשון'),
    { firstName: 'משה', lastName: 'גבאי' }
  );
  assert.deepEqual(
    introducedName('קוראים לי דנה כהן, רציתי לשאול על החוג'),
    { firstName: 'דנה', lastName: 'כהן' }
  );
  assert.deepEqual(
    introducedName('שלום, אני רועי בן דוד'),
    { firstName: 'רועי', lastName: 'בן דוד' }
  );
});

test('«אני» נספר רק בפתיחת הודעה — אחרת חצי מההודעות הופכות לשם', () => {
  assert.equal(introducedName('היי, אני רוצה לרשום את תומר לקבוצת מתחילים'), null);
  assert.equal(introducedName('רציתי לשאול אם אני צריך להביא ציוד'), null);
});

test('שם פרטי בלבד אינו שם מלא', () => {
  assert.equal(introducedName('שמי משה'), null);
  assert.equal(introducedName('אני דנה'), null);
});

test('בלי הצגה עצמית אין ממה לגזור', () => {
  assert.equal(introducedName('מתי החוג מתחיל?'), null);
  assert.equal(introducedName(''), null);
  assert.equal(introducedName(null), null);
});

test('שתי מילים הן השם; השלישית שייכת למשפט', () => {
  assert.deepEqual(
    introducedName('שמי אורית לוי ורציתי לשאול על החוג'),
    { firstName: 'אורית', lastName: 'לוי' }
  );
  // מילית שם משפחה היא החריג היחיד לכלל שתי המילים.
  assert.deepEqual(
    introducedName('שמי נועה בן ארי ואני מחפשת חוג'),
    { firstName: 'נועה', lastName: 'בן ארי' }
  );
  assert.equal(introducedName('שמי מה זה'), null);
});
