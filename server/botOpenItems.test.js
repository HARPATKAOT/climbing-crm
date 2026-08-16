/**
 * „מה פתוח”: מי באמת ממתין, ומי כבר טופל.
 *
 * המקרה שהוליד את המסך: הבוט אמר „מעביר לצוות”, ההודעה נכנסה לרשימת הממתינים
 * שאיש לא פותח, ושני לקוחות חיכו יום. הבדיקות כאן שומרות על הכלל ההפוך —
 * ברגע שאדם ענה או שמישהו סימן טופל, הלקוח יורד מהרשימה ולא מציף אותה.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botOpenItems,
  openCentreChecks,
  pendingFollowUps,
  waitingForStaff,
} from './botOpenItems.js';

const NOW = new Date('2026-08-11T12:00:00.000Z');
const minutesAgo = (n) => new Date(NOW.getTime() - n * 60_000).toISOString();
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function testDb(store = {}) {
  return { get: (table) => store[table] || [] };
}

test('לקוח שהועבר לצוות ואיש לא ענה לו נמצא ברשימה, עם כמה זמן הוא מחכה', () => {
  const db = testDb({
    parents: [{ id: 'p1', name: 'יעל חורב', phone: '972528310928', bot_handoff_at: minutesAgo(90) }],
    messages: [
      { id: 'm1', phone: '972528310928', direction: 'inbound', message: 'אפשר לשריין מקום לרני?', created_at: minutesAgo(95) },
      { id: 'm2', phone: '972528310928', direction: 'outbound', is_ai: true, source: 'ai', message: 'מעביר לצוות 🧗', created_at: minutesAgo(90) },
    ],
  });
  const [row] = waitingForStaff(db, { now: NOW });
  assert.equal(row.name, 'יעל חורב');
  assert.equal(row.waiting_minutes, 90);
  assert.equal(row.last_message, 'אפשר לשריין מקום לרני?');
});

test('תשובה של אדם לא סוגרת את ההמתנה — היא רק מסמנת „נענה”', () => {
  const build = (outbound) => testDb({
    parents: [{ id: 'p1', name: 'יעל', phone: '972528310928', bot_handoff_at: minutesAgo(60) }],
    messages: [
      { id: 'm1', phone: '972528310928', direction: 'inbound', message: 'שאלה', created_at: minutesAgo(61) },
      { id: 'm2', phone: '972528310928', direction: 'outbound', created_at: minutesAgo(30), ...outbound },
    ],
  });
  // דלק ענה מה-CRM — עדיין ברשימה, כי „אני בודקת” הוא אמצע הטיפול. רק
  // „סיום הטיפול” מוריד. הסימון מבדיל בין זה לבין שתיקה מוחלטת.
  const answered = waitingForStaff(build({ source: 'crm', message: 'היי, כבר בודקת' }), { now: NOW });
  assert.equal(answered.length, 1);
  assert.equal(answered[0].answered, true);
  // אלה לא בני אדם: איש לא נגע בלקוח.
  for (const outbound of [{ source: 'ai', is_ai: true }, { source: 'automation' }, { source: 'otp' }]) {
    const rows = waitingForStaff(build(outbound), { now: NOW });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].answered, false);
  }
});

test('תשובה אנושית מ*לפני* ההעברה אינה סוגרת את ההמתנה', () => {
  // הבאג המתבקש: לספור כל הודעה של אדם בשיחה, ולהחמיץ את מי שכתב אתמול
  // ושאל שוב היום.
  const db = testDb({
    parents: [{ id: 'p1', name: 'יעל', phone: '972528310928', bot_handoff_at: minutesAgo(20) }],
    messages: [
      { id: 'm1', phone: '972528310928', direction: 'outbound', source: 'crm', message: 'ענינו אתמול', created_at: daysAgo(1) },
      { id: 'm2', phone: '972528310928', direction: 'inbound', message: 'ועוד שאלה', created_at: minutesAgo(25) },
    ],
  });
  assert.equal(waitingForStaff(db, { now: NOW }).length, 1);
});

test('סימון „טופל” בתור הממתינים מוריד מהרשימה, והעברה חדשה מחזירה', () => {
  const card = (patch) => testDb({
    parents: [{ id: 'p1', name: 'יעל', phone: '972528310928', bot_handoff_at: minutesAgo(60), ...patch }],
  });
  assert.equal(waitingForStaff(card({ communication_handled_at: minutesAgo(10) }), { now: NOW }).length, 0);
  // טופל לפני ההעברה — כלומר ההעברה הזאת עוד לא נגעה באיש.
  assert.equal(waitingForStaff(card({ communication_handled_at: minutesAgo(120) }), { now: NOW }).length, 1);
});

test('העברה בת שבועיים היא היסטוריה, לא תור', () => {
  const db = testDb({
    parents: [{ id: 'p1', name: 'ישן', phone: '972528310928', bot_handoff_at: daysAgo(30) }],
  });
  assert.equal(waitingForStaff(db, { now: NOW }).length, 0);
});

test('כרטיס הורה וכרטיס ילד על אותו קו הם לקוח אחד ממתין', () => {
  // הודעה ממספר של מתאמן מתויקת לכרטיס ההורה — בלי איחוד לפי קו, אותו אדם
  // היה מופיע פעמיים והתור היה נראה כפול ממה שהוא.
  const db = testDb({
    parents: [
      { id: 'p1', name: 'יעל חורב', phone: '0528310928', bot_handoff_at: minutesAgo(45) },
      { id: 'p2', name: 'רני חורב', phone: '+972-52-8310928', bot_handoff_at: minutesAgo(20) },
    ],
  });
  const rows = waitingForStaff(db, { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].waiting_minutes, 45, 'ההמתנה נמדדת מההעברה הראשונה');
});

test('התור מסודר לפי מי שממתין הכי הרבה זמן', () => {
  const db = testDb({
    parents: [
      { id: 'p1', name: 'חדש', phone: '972500000001', bot_handoff_at: minutesAgo(5) },
      { id: 'p2', name: 'ותיק', phone: '972500000002', bot_handoff_at: minutesAgo(600) },
      { id: 'p3', name: 'אמצע', phone: '972500000003', bot_handoff_at: minutesAgo(120) },
    ],
  });
  assert.deepEqual(waitingForStaff(db, { now: NOW }).map((r) => r.name), ['ותיק', 'אמצע', 'חדש']);
});

test('מעקב שזמנו עבר מסומן כפיגור, ומעקב עתידי לא', () => {
  const db = testDb({
    parents: [{ id: 'p1', name: 'יעל', phone: '972528310928' }],
    bot_followups: [
      { id: 'bf1', parent_id: 'p1', status: 'open', reason: 'pending_signup', subject: 'רני', due_at: minutesAgo(30) },
      { id: 'bf2', parent_id: 'p1', status: 'open', reason: 'customer_asked', note: 'מחירים', due_at: new Date(NOW.getTime() + 3 * 3600_000).toISOString() },
      { id: 'bf3', parent_id: 'p1', status: 'sent', reason: 'general', due_at: minutesAgo(300) },
      { id: 'bf4', parent_id: 'p1', status: 'cancelled', reason: 'general', due_at: minutesAgo(300) },
    ],
  });
  const rows = pendingFollowUps(db, { now: NOW });
  assert.deepEqual(rows.map((r) => r.id), ['bf1', 'bf2'], 'שנשלח ושבוטל אינם פתוחים');
  assert.equal(rows[0].overdue, true);
  assert.equal(rows[0].name, 'יעל');
  assert.equal(rows[0].subject, 'רני');
  assert.equal(rows[1].overdue, false);
});

test('שורה ישנה עם תאריך בלבד עדיין נכנסת לתור', () => {
  // מעקבים שנוצרו לפני שהיה `due_at` נושאים תאריך בלבד — התעלמות מהם היא
  // בדיוק ההבטחה שנשכחת.
  const db = testDb({
    bot_followups: [{ id: 'bf1', parent_id: 'p1', status: 'open', due_date: '2026-08-10' }],
  });
  const [row] = pendingFollowUps(db, { now: NOW });
  assert.equal(row.overdue, true);
});

test('רשימת כרמית: מי שאושר יורד, והשאר מסודרים לפי ותק הדיווח', () => {
  const db = testDb({
    centre_registration_checks: [
      { id: 'c1', student_name: 'רני', status: 'asked', rounds: 1, reported_at: daysAgo(9) },
      { id: 'c2', student_name: 'נועם', status: 'confirmed', reported_at: daysAgo(20) },
      { id: 'c3', student_name: 'איתי', status: 'reported', reported_at: daysAgo(2) },
    ],
  });
  const rows = openCentreChecks(db, { now: NOW });
  assert.deepEqual(rows.map((r) => r.student_name), ['רני', 'איתי']);
  assert.equal(rows[0].waiting_days, 9);
  assert.equal(rows[0].status_label, 'נשאלה כרמית — אין תשובה');
});

test('הסיכום סופר את מי שצריך אדם עכשיו', () => {
  const db = testDb({
    parents: [
      { id: 'p1', name: 'ותיק', phone: '972500000002', bot_handoff_at: minutesAgo(600) },
      { id: 'p2', name: 'זה עתה', phone: '972500000001', bot_handoff_at: minutesAgo(5) },
    ],
    bot_followups: [
      { id: 'bf1', parent_id: 'p1', status: 'open', due_at: minutesAgo(30) },
      { id: 'bf2', parent_id: 'p1', status: 'open', due_at: new Date(NOW.getTime() + 3600_000).toISOString() },
    ],
    centre_registration_checks: [{ id: 'c1', student_name: 'רני', status: 'asked', reported_at: daysAgo(9) }],
  });
  const { summary } = botOpenItems(db, { now: NOW });
  assert.deepEqual(summary, {
    waiting: 2,
    waitingOverHour: 1,
    followUps: 2,
    overdueFollowUps: 1,
    centreChecks: 1,
    needsAttention: 3,
  });
});

test('מסד ריק מחזיר מסך ריק ולא נופל', () => {
  const { summary, waiting, followUps, centreChecks } = botOpenItems(testDb(), { now: NOW });
  assert.deepEqual([waiting, followUps, centreChecks], [[], [], []]);
  assert.equal(summary.needsAttention, 0);
});
