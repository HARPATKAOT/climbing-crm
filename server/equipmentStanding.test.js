import test from 'node:test';
import assert from 'node:assert/strict';
import {
  equipmentOpenLine,
  equipmentReceiptMessage,
  familyEquipmentStanding,
} from './equipmentStanding.js';
import { followUpMessage } from './botFollowUps.js';

const ELLA = { id: 's-ella', name: 'אלה פרי דינרי', status: 'pending_signup' };
const EVYATAR = { id: 's-evyatar', name: 'אביתר פרי דינרי', status: 'pending_signup' };
const LEAD = { id: 's-lead', name: 'יובל דינרי', status: 'lead_new' };

const store = (rows) => ({ get: (table) => (table === 'student_equipment' ? rows : []) });

const LINK = 'https://app.example/api/e/tok1';

test('מצב הציוד של המשפחה מחולק למה שחסר, מה שנרכש ומה שכבר בבית', () => {
  const db = store([
    { id: 'e1', student_id: 's-ella', item_type: 'shoes', payment_status: 'unpaid' },
    { id: 'e2', student_id: 's-ella', item_type: 'shirt', payment_status: 'paid', shirt_size: 'S' },
    { id: 'e3', student_id: 's-evyatar', item_type: 'shoes', payment_status: 'own' },
  ]);
  const standing = familyEquipmentStanding(db, { students: [ELLA, EVYATAR] });

  assert.deepEqual(standing.open.map((m) => m.student_id), ['s-ella']);
  assert.deepEqual(standing.resolved.map((m) => m.student_id), ['s-evyatar']);
  assert.equal(standing.hasOpen, true);
});

test('שורת הציוד הפתוח נוקבת בשם ובפריטים, ורק כשיש קישור לשלוח', () => {
  const db = store([
    { id: 'e1', student_id: 's-ella', item_type: 'shoes', payment_status: 'unpaid' },
    { id: 'e2', student_id: 's-evyatar', item_type: 'shirt', payment_status: 'unpaid', shirt_size: 'S' },
  ]);
  const standing = familyEquipmentStanding(db, { students: [ELLA, EVYATAR] });

  const line = equipmentOpenLine(standing, { link: LINK });
  assert.match(line, /אלה \(נעלי טיפוס\)/);
  assert.match(line, /אביתר \(חולצת חוג \(מידה S\)\)/);
  assert.match(line, /שכבר יש מהבית/);
  assert.ok(line.includes(LINK));

  // „הציוד לא שולם” בלי דרך לשלם הוא נזיפה, לא שירות.
  assert.equal(equipmentOpenLine(standing, { link: '' }), '');
});

test('ליד שלא שובץ לשום מקום אינו נרדף על ציוד', () => {
  const db = store([
    { id: 'e1', student_id: 's-lead', item_type: 'shoes', payment_status: 'unpaid' },
    { id: 'e2', student_id: 's-ella', item_type: 'shoes', payment_status: 'unpaid' },
  ]);
  const standing = familyEquipmentStanding(db, { students: [LEAD, ELLA] });
  assert.deepEqual(standing.open.map((m) => m.student_id), ['s-ella']);
  assert.doesNotMatch(equipmentOpenLine(standing, { link: LINK }), /יובל/);
});

test('הודעת התודה מפרטת מה נרכש ולמי, מה כבר קיים בבית, ושאין מה לעשות', () => {
  const db = store([
    { id: 'e1', student_id: 's-ella', item_type: 'shoes', payment_status: 'paid' },
    { id: 'e2', student_id: 's-ella', item_type: 'shirt', payment_status: 'paid', shirt_size: 'M' },
    { id: 'e3', student_id: 's-evyatar', item_type: 'shoes', payment_status: 'own' },
  ]);
  const standing = familyEquipmentStanding(db, { students: [ELLA, EVYATAR] });
  const msg = equipmentReceiptMessage(standing, { firstName: 'יובל' });

  assert.match(msg, /תודה יובל/);
  assert.match(msg, /אלה פרי דינרי — נעלי טיפוס, חולצת חוג \(מידה M\)/);
  assert.match(msg, /אביתר פרי דינרי — נעלי טיפוס/);
  assert.match(msg, /אין צורך בפעולות נוספות/);
});

test('נשאר פריט פתוח — התודה אומרת את זה במקום לסגור את העניין', () => {
  const db = store([
    { id: 'e1', student_id: 's-ella', item_type: 'shoes', payment_status: 'paid' },
    { id: 'e2', student_id: 's-ella', item_type: 'chalk_bag', payment_status: 'unpaid' },
  ]);
  const standing = familyEquipmentStanding(db, { students: [ELLA] });
  const msg = equipmentReceiptMessage(standing, { firstName: 'יובל' });

  assert.match(msg, /נשאר עוד פריט/);
  assert.doesNotMatch(msg, /אין צורך בפעולות נוספות/);
});

test('אין מה לאשר — אין הודעה', () => {
  const db = store([
    { id: 'e1', student_id: 's-ella', item_type: 'shoes', payment_status: 'unpaid' },
  ]);
  const standing = familyEquipmentStanding(db, { students: [ELLA] });
  assert.equal(equipmentReceiptMessage(standing, { firstName: 'יובל' }), '');
});

// ─── מה המעקב של מחר באמת שואל ────────────────────────────────────────────────

const ROW = { reason: 'pending_signup', subject: 'אלה פרי דינרי', note: 'ההרשמה במתנ״ס' };

test('נרשמו כבר — לא שואלים על ההרשמה, ממשיכים לציוד שנשאר פתוח', () => {
  const msg = followUpMessage(ROW, {
    firstName: 'יובל',
    awaitingRegistration: [],
    equipmentLine: `אגב, אני רואה שהציוד עדיין לא הוסדר — אלה (נעלי טיפוס).\nכאן משלימים: ${LINK}`,
  });
  assert.doesNotMatch(msg, /ההרשמה/);
  assert.match(msg, /הציוד עדיין לא הוסדר/);
});

test('שני אחים ממתינים — שואלים על שניהם, בשמות פרטיים', () => {
  const msg = followUpMessage(ROW, {
    firstName: 'יובל',
    awaitingRegistration: ['אלה', 'אביתר'],
    equipmentLine: `אגב, הציוד — אלה (נעלי טיפוס). ${LINK}`,
  });
  assert.match(msg, /ההרשמה של אלה ואביתר במתנ״ס/);
  // שם משפחה בהודעה לוואטסאפ הוא טופס, לא שיחה.
  assert.doesNotMatch(msg, /פרי דינרי/);
  assert.match(msg, /הציוד/);
});

test('הכול נסגר בינתיים — אין הודעה בכלל', () => {
  assert.equal(followUpMessage(ROW, { firstName: 'יובל', awaitingRegistration: [], equipmentLine: '' }), '');
  assert.equal(
    followUpMessage({ reason: 'equipment_unpaid', subject: 'אלה' }, { firstName: 'יובל', equipmentLine: '' }),
    ''
  );
});

test('מעקב ציוד בלבד אינו שואל על ההרשמה', () => {
  const msg = followUpMessage({ reason: 'equipment_unpaid', subject: 'אלה' }, {
    firstName: 'יובל',
    equipmentLine: `אגב, הציוד — אלה (נעלי טיפוס). ${LINK}`,
  });
  assert.doesNotMatch(msg, /מתנ/);
  assert.match(msg, /הציוד/);
});
