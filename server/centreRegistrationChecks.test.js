/**
 * המעקב מול כרמית: שאלה אחת בשבוע, ואף ילד לא נופל בין הכיסאות.
 *
 * המקרה: יעל כתבה „ההרשמה מעודכנת במתנס”, הבוט אמר תודה, והכרטיס של רני נשאר
 * „ממתין להרשמה” עד שמישהו שם לב — שבוע אחרי.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENTRE_CHECK_COLLECTION,
  buildDigestMessage,
  dueForDigest,
  dueForParentRecheck,
  isDigestTime,
  markAsked,
  markConfirmed,
  markParentAsked,
  recordParentReport,
  studentsStillAwaitingRegistration,
} from './centreRegistrationChecks.js';

function testDb(seed = []) {
  const store = { [CENTRE_CHECK_COLLECTION]: [...seed] };
  return {
    store,
    get: (table) => store[table] || [],
    insert: (table, row) => {
      store[table] ||= [];
      store[table].push(row);
      return row;
    },
    update: (table, id, patch) => {
      const list = store[table] || [];
      const index = list.findIndex((row) => String(row.id) === String(id));
      if (index < 0) return null;
      const next = { ...list[index], ...patch };
      store[table] = list.map((row, i) => (i === index ? next : row));
      return next;
    },
  };
}

const SUNDAY_8 = new Date('2026-08-09T08:05:00+03:00');
const SUNDAY_10 = new Date('2026-08-09T10:05:00+03:00');
const TUESDAY_8 = new Date('2026-08-11T08:05:00+03:00');
const MONDAY_8 = new Date('2026-08-10T08:05:00+03:00');

const RANI = { id: 'st-rani', name: 'רני חורב', status: 'pending_signup' };
const MOTHER = { id: 'p-yael', name: 'יעל חורב', phone: '972528310928' };

test('השאלה נשלחת ביום ראשון בבוקר, ושוב בשלישי — לא בכל שעה', () => {
  assert.equal(isDigestTime(SUNDAY_8), true);
  assert.equal(isDigestTime(TUESDAY_8), true);
  assert.equal(isDigestTime(SUNDAY_10), false, 'לא כל שעה ביום ראשון');
  assert.equal(isDigestTime(MONDAY_8), false, 'לא כל יום ב-08:00');
});

test('דיווח של הורה נאסף פעם אחת, גם אם הוא חוזר עליו', async () => {
  const db = testDb();
  const first = await recordParentReport({ db, student: RANI, parent: MOTHER, now: SUNDAY_8 });
  const again = await recordParentReport({ db, student: RANI, parent: MOTHER, now: SUNDAY_8 });

  assert.equal(first.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(db.get(CENTRE_CHECK_COLLECTION).length, 1);
  assert.equal(first.row.status, 'reported');
});

test('הודעה אחת לכרמית עם כל השמות, ולא הודעה לכל ילד', async () => {
  const db = testDb();
  await recordParentReport({ db, student: RANI, parent: MOTHER, now: SUNDAY_8 });
  await recordParentReport({ db, student: { id: 'st-omer', name: 'עומר בזר', status: 'pending_signup' }, parent: MOTHER, now: SUNDAY_8 });

  const due = dueForDigest(db, SUNDAY_8);
  assert.equal(due.length, 2);

  const message = buildDigestMessage(due);
  assert.match(message, /רני חורב/);
  assert.match(message, /עומר בזר/);
  assert.match(message, /כרמית/);

  await markAsked({ db, list: due, now: SUNDAY_8 });
  // הפעלה חוזרת באותו יום — למשל אחרי פריסה — לא מעירה אותה שוב.
  assert.deepEqual(dueForDigest(db, SUNDAY_8), []);
  assert.equal(db.get(CENTRE_CHECK_COLLECTION)[0].rounds, 1);
});

test('ילד שכרמית אישרה יוצא מהמעקב', async () => {
  const db = testDb();
  await recordParentReport({ db, student: RANI, parent: MOTHER, now: SUNDAY_8 });
  await markAsked({ db, list: dueForDigest(db, SUNDAY_8), now: SUNDAY_8 });

  const confirmed = await markConfirmed({ db, studentId: RANI.id, now: SUNDAY_10 });
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(dueForDigest(db, TUESDAY_8), [], 'לא נשאל עליו שוב בשלישי');
  assert.deepEqual(dueForParentRecheck(db, MONDAY_8), []);
});

test('ילד שלא חזר בתשובה — קודם שואלים את ההורה, ואז שוב את כרמית בשלישי', async () => {
  const db = testDb();
  await recordParentReport({ db, student: RANI, parent: MOTHER, now: SUNDAY_8 });
  await markAsked({ db, list: dueForDigest(db, SUNDAY_8), now: SUNDAY_8 });

  // ביום ראשון עצמו לא שואלים את ההורה — כרמית עוד לא הספיקה לענות.
  assert.deepEqual(dueForParentRecheck(db, SUNDAY_8), []);

  const recheck = dueForParentRecheck(db, MONDAY_8);
  assert.equal(recheck.length, 1);
  assert.equal(recheck[0].student_name, 'רני חורב');
  await markParentAsked({ db, row: recheck[0], now: MONDAY_8 });
  assert.deepEqual(dueForParentRecheck(db, MONDAY_8), [], 'ההורה נשאל פעם אחת ביום');

  // ובשלישי הוא חוזר לרשימה של כרמית.
  const second = dueForDigest(db, TUESDAY_8);
  assert.equal(second.length, 1);
  await markAsked({ db, list: second, now: TUESDAY_8 });
  assert.equal(db.get(CENTRE_CHECK_COLLECTION)[0].rounds, 2);
});

test('רשימה ריקה אינה הודעה', () => {
  assert.equal(buildDigestMessage([]), '');
  assert.equal(buildDigestMessage([{ student_name: '  ' }]), '');
});

test('אחרי שהורה דיווח שנרשם לא שואלים אותו שוב אם נרשם', async () => {
  const db = testDb();
  const sibling = { id: 's-2', name: 'אחיו', status: 'pending_signup' };
  await recordParentReport({ db, student: RANI, parent: MOTHER, now: SUNDAY_8 });
  const waiting = studentsStillAwaitingRegistration(db, [
    { ...RANI, status: 'pending_signup' },
    sibling,
  ]);
  assert.deepEqual(waiting.map((student) => student.id), ['s-2']);
});
