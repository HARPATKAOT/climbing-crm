/**
 * התמחור של הרשמה לימים בודדים, דרך שירות ההרשמה עצמו.
 *
 * הבדיקה הזאת עוברת ב-`registerActivityGroup` האמיתי ולא מחשבת מחדש את
 * הנוסחה — אחרת היא הייתה מאשרת את החישוב של עצמה.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { registerActivityGroup } from './activityRegistrationOrderService.js';
import { CANONICAL_HEALTH_QUESTIONS } from './participationDocuments.js';

/** תשובה „לא” לכל שאלת סינון — הבדיקה היא על התמחור, לא על המסמכים. */
const ALL_ANSWERS = Object.fromEntries(
  CANONICAL_HEALTH_QUESTIONS.map((question) => [question.id, false])
);

const camp = (over = {}) => ({
  id: 'act1',
  name: 'קייטנת קיץ',
  date: '2026-08-10',
  end_date: '2026-08-14',
  price: 500,
  single_day_price: 120,
  allow_single_day: true,
  price_includes_vat: true,
  registration_mode: 'paid_per_participant',
  max_participants: 20,
  ...over,
});

/** מסד מינימלי בזיכרון — מספיק כדי שהשירות ירוץ מקצה לקצה. */
function fakeDb() {
  const rows = {
    activity_registrations: [], activity_registration_orders: [], payments: [],
    parents: [], students: [], households: [], household_members: [],
    cancellation_policies: [], cancellation_policy_versions: [],
    health_declarations: [], participation_waivers: [], student_guardians: [],
  };
  let seq = 0;
  return {
    rows,
    get: (t) => rows[t] || [],
    getOne: (t, id) => (rows[t] || []).find((r) => String(r.id) === String(id)) || null,
    insert: (t, row) => {
      const next = { id: row.id || `${t}-${++seq}`, ...row };
      (rows[t] = rows[t] || []).push(next);
      return next;
    },
    update: (t, id, patch) => {
      const row = (rows[t] || []).find((r) => String(r.id) === String(id));
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
    delete: (t, id) => {
      rows[t] = (rows[t] || []).filter((r) => String(r.id) !== String(id));
      return true;
    },
    set: (t, list) => { rows[t] = list; },
    upsertParentByPhone: (parent) => {
      const existing = rows.parents.find((r) => r.phone === parent.phone);
      if (existing) { Object.assign(existing, parent); return existing; }
      const next = { id: `parent-${++seq}`, ...parent };
      rows.parents.push(next);
      return next;
    },
    upsertStudent: (student) => {
      const next = { id: student.id || `student-${++seq}`, ...student };
      const at = rows.students.findIndex((r) => String(r.id) === String(next.id));
      if (at >= 0) rows.students[at] = next; else rows.students.push(next);
      return next;
    },
  };
}

async function register(activity, attendingDates, participantCount = 1) {
  const db = fakeDb();
  const result = await registerActivityGroup({
    db,
    persist: async () => ({ ok: true }),
    activity,
    payload: {
      idempotency_key: `key-${Math.random()}`,
      parent: { name: 'הורה', phone: '0500000000', email: 'a@b.c' },
      attending_dates: attendingDates,
      participants: Array.from({ length: participantCount }, (_, i) => ({
        type: 'child',
        name: `ילד ${i + 1}`,
        birthDate: '2016-05-05',
        waiverAccepted: true,
        signature: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        answers: { ...ALL_ANSWERS },
      })),
      policyAccepted: true,
    },
    createPaymentUrl: async () => 'https://pay.example/x',
  });
  return { db, result };
}

test('הרשמה מלאה מחייבת את מחיר האירוע', async () => {
  const { db } = await register(camp(), null);
  const order = db.get('activity_registration_orders')[0];
  assert.equal(order.total_amount, 500);
  assert.equal(order.attending_dates, null);
});

test('יומיים מתוך חמישה מחייבים פעמיים מחיר יום', async () => {
  const { db } = await register(camp(), ['2026-08-11', '2026-08-12']);
  const order = db.get('activity_registration_orders')[0];
  assert.equal(order.total_amount, 240);
  assert.deepEqual(order.attending_dates, ['2026-08-11', '2026-08-12']);
});

test('הימים נשמרים על כל הרשמה, כדי שהנוכחות תדע', async () => {
  const { db } = await register(camp(), ['2026-08-11'], 2);
  const regs = db.get('activity_registrations');
  assert.equal(regs.length, 2);
  for (const reg of regs) {
    assert.deepEqual(reg.attending_dates, ['2026-08-11']);
    assert.equal(reg.amount, 120);
  }
  assert.equal(db.get('activity_registration_orders')[0].total_amount, 240);
});

test('בחירה שמכסה את כל הימים נשמרת כאירוע מלא במחיר המלא', async () => {
  const all = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
  const { db } = await register(camp(), all);
  const order = db.get('activity_registration_orders')[0];
  assert.equal(order.attending_dates, null);
  assert.equal(order.total_amount, 500);
});

test('בלי מחיר ליום — ההרשמה החלקית נחסמת ולא נגבה אפס', async () => {
  await assert.rejects(
    () => register(camp({ single_day_price: 0 }), ['2026-08-11']),
    /לא הוגדר מחיר ליום בודד/
  );
});

test('אירוע שאינו מציע ימים בודדים מתעלם מהבחירה וגובה מחיר מלא', async () => {
  const { db } = await register(camp({ allow_single_day: false }), ['2026-08-11']);
  const order = db.get('activity_registration_orders')[0];
  assert.equal(order.attending_dates, null);
  assert.equal(order.total_amount, 500);
});

test('מחיר לפני מע״מ — המע״מ מתווסף על מחיר הימים', async () => {
  const { db } = await register(
    camp({ price_includes_vat: false }),
    ['2026-08-11', '2026-08-12']
  );
  // 240 × 1.18
  assert.equal(db.get('activity_registration_orders')[0].total_amount, 283.2);
});
