import test from 'node:test';
import assert from 'node:assert/strict';
import {
  announceProgramEligibility,
  eligibilityNoticeMessage,
  eligibilityStaffNotice,
} from './eligibilityNotice.js';

const STUDENT = { id: 's-1', name: 'נווה פאר', parentId: 'p-1' };
const PARENT = { id: 'p-1', name: 'אביבית פילבסקי', phone: '972544954130' };

function store(row) {
  const rows = { [row.id]: { ...row } };
  return {
    rows,
    update: (collection, id, patch) => {
      rows[id] = { ...rows[id], ...patch };
      return rows[id];
    },
  };
}

test('הנוסח הוא מה שנקבע, ונגמר בשאלה', () => {
  const msg = eligibilityNoticeMessage();
  assert.equal(msg, 'מנהל אישר לכם זכאות להרשמה לקבוצת מתקדמים\nהאם תרצו להמשיך בהרשמה?');
});

test('חלון פתוח — ההודעה יוצאת ללקוח והשליחה נחתמת על שורת הזכאות', async () => {
  const db = store({ id: 'pe-1' });
  const sent = [];
  const result = await announceProgramEligibility({
    db,
    student: STUDENT,
    parent: PARENT,
    row: db.rows['pe-1'],
    windowOpen: true,
    sendReply: async (phone, text) => { sent.push({ phone, text }); return { success: true }; },
  });

  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].phone, PARENT.phone);
  assert.match(sent[0].text, /זכאות להרשמה לקבוצת מתקדמים/);
  assert.ok(db.rows['pe-1'].notified_at);
});

test('שמירה חוזרת של הכרטיס אינה הודעה שנייה', async () => {
  const db = store({ id: 'pe-1', notified_at: '2026-08-11T09:00:00.000Z' });
  let calls = 0;
  const result = await announceProgramEligibility({
    db,
    student: STUDENT,
    parent: PARENT,
    row: db.rows['pe-1'],
    windowOpen: true,
    sendReply: async () => { calls += 1; return { success: true }; },
  });
  assert.equal(result.skipped, 'already_announced');
  assert.equal(calls, 0);
});

test('חלון סגור — עובר לצוות ולא נעלם', async () => {
  const db = store({ id: 'pe-1' });
  const staff = [];
  const result = await announceProgramEligibility({
    db,
    student: STUDENT,
    parent: PARENT,
    row: db.rows['pe-1'],
    windowOpen: false,
    sendReply: async () => { throw new Error('אסור לשלוח מחוץ לחלון'); },
    notifyStaff: async (text) => { staff.push(text); },
  });

  assert.equal(result.handedToStaff, true);
  assert.match(staff[0], /נווה פאר/);
  assert.match(staff[0], /חלון 24 השעות סגור/);
  assert.ok(db.rows['pe-1'].staff_notified_at);
  assert.equal(db.rows['pe-1'].notified_at, undefined);
});

test('שליחה שנכשלה אינה נחתמת — כדי שאפשר יהיה לנסות שוב', async () => {
  const db = store({ id: 'pe-1' });
  const result = await announceProgramEligibility({
    db,
    student: STUDENT,
    parent: PARENT,
    row: db.rows['pe-1'],
    windowOpen: true,
    sendReply: async () => ({ success: false, error: 'meta down' }),
  });
  assert.equal(result.ok, false);
  assert.equal(db.rows['pe-1'].notified_at, undefined);
});

test('בלי טלפון אין מה לשלוח', async () => {
  const db = store({ id: 'pe-1' });
  const result = await announceProgramEligibility({
    db, student: STUDENT, parent: { id: 'p-1', phone: '' }, row: db.rows['pe-1'], windowOpen: true,
  });
  assert.equal(result.reason, 'no_phone');
});

test('הודעת הצוות אומרת על מי מדובר ואיך להשיג', () => {
  const text = eligibilityStaffNotice({ studentName: 'נווה', parentName: 'אביבית', phone: '972544954130' });
  assert.match(text, /נווה/);
  assert.match(text, /972544954130/);
});
