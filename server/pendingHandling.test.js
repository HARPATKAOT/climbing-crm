import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_KIND, todaysEntrants, entryRows, paymentRows, buildPendingQueue, buildCounterQueues,
  shiftSales,
} from './pendingHandling.js';

const TODAY = '2026-08-10';
const dateOf = (iso) => String(iso || '').slice(0, 10);
const students = {
  s1: { id: 's1', name: 'יונתן כהן' },
  s2: { id: 's2', name: 'תמר לוי' },
};
const studentOf = (id) => students[id] || null;

test('only the last entry of the day counts per climber', () => {
  const seen = todaysEntrants([
    { climber_id: 's1', timestamp: '2026-08-10T09:00:00.000Z' },
    { climber_id: 's1', timestamp: '2026-08-10T11:00:00.000Z' },
    { climber_id: 's2', timestamp: '2026-08-09T11:00:00.000Z' },
  ], TODAY, dateOf);
  assert.deepEqual([...seen], [['s1', '2026-08-10T11:00:00.000Z']]);
});

test('only a climber still missing a safety test is on the list', () => {
  const checkIns = [
    { climber_id: 's1', timestamp: '2026-08-10T09:00:00.000Z' },
    { climber_id: 's2', timestamp: '2026-08-10T09:30:00.000Z' },
  ];
  const safetyOf = (id) => (id === 's1' ? { state: 'valid' } : { state: 'missing' });
  const rows = entryRows({ checkIns, today: TODAY, dateOf, studentOf, safetyOf });
  assert.deepEqual(rows.map((r) => r.name), ['תמר לוי']);
  assert.equal(rows[0].kind, PENDING_KIND.SAFETY);
});

test('a payment link waits on the list until an instructor clears it, not until it is paid', () => {
  const sales = [
    { id: 'ps1', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'אבי כהן', total: 60, items: [{ name: 'כניסה בודדת' }] },
    { id: 'ps2', payment_method: 'online', status: 'paid', created_at: '2026-08-10T09:10:00.000Z', updated_at: '2026-08-10T09:14:00.000Z', customer_name: 'נועה לוי', total: 500 },
    { id: 'ps3', payment_method: 'online', status: 'paid', handled_at: '2026-08-10T09:20:00.000Z', created_at: '2026-08-10T09:05:00.000Z', customer_name: 'כבר טופל' },
    { id: 'ps4', payment_method: 'cash', status: 'paid', created_at: '2026-08-10T09:06:00.000Z', customer_name: 'שילם במזומן' },
    { id: 'ps5', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-09T09:00:00.000Z', customer_name: 'אתמול' },
  ];
  const rows = paymentRows({ sales, today: TODAY, dateOf });
  assert.deepEqual(rows.map((r) => r.name), ['אבי כהן', 'נועה לוי']);
  assert.equal(rows[0].paid, false);
  assert.equal(rows[1].paid, true);
  assert.equal(rows[1].paid_at, '2026-08-10T09:14:00.000Z');
  assert.equal(rows[0].items, 'כניסה בודדת');
});

test('whoever already paid rises to the top — they are waiting on a click, not on money', () => {
  const queue = buildPendingQueue({
    checkIns: [{ climber_id: 's2', timestamp: '2026-08-10T08:00:00.000Z' }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'missing' }),
    sales: [
      { id: 'ps1', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'ממתין לכסף' },
      { id: 'ps2', payment_method: 'online', status: 'paid', created_at: '2026-08-10T09:30:00.000Z', customer_name: 'שילם' },
    ],
  });
  assert.deepEqual(queue.map((r) => r.name), ['שילם', 'תמר לוי', 'ממתין לכסף']);
});

test('a row removed by hand does not come back the same day', () => {
  // ההסרה חייבת להחזיק, אחרת היא חסרת ערך והרשימה מפסיקה להיקרא.
  const parts = {
    checkIns: [{ climber_id: 's2', timestamp: '2026-08-10T08:00:00.000Z' }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'missing' }),
    sales: [
      { id: 'ps1', payment_method: 'online', status: 'paid', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'שילם' },
    ],
  };
  assert.deepEqual(buildPendingQueue(parts).map((r) => r.name), ['שילם', 'תמר לוי']);
  assert.deepEqual(
    buildPendingQueue({ ...parts, dismissedIds: ['entry:s2'] }).map((r) => r.name),
    ['שילם']
  );
  assert.deepEqual(buildPendingQueue({ ...parts, dismissedIds: ['entry:s2', 'payment:ps1'] }), []);
});

test('someone who paid for a single entry is on the list like anyone who walked in', () => {
  // כניסה בודדת אינה מייצרת כרטיסייה, ולכן אין ניקוב שירשום את הכניסה. אם
  // המכירה לא רושמת אותה, מי ששילם ונכנס אינו מופיע בשום מקום — לא ביומן
  // ולא בין מי שממתין לתדריך.
  const rows = entryRows({
    checkIns: [{ climber_id: 's2', timestamp: '2026-08-10T09:00:00.000Z', source: 'pos_sale' }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'missing' }),
  });
  assert.deepEqual(rows.map((r) => r.name), ['תמר לוי']);
});

test('a parent paying for their child is one row, in the child\u0027s name', () => {
  // ההורה שילם והופיע ברשימה בשמו; אחרי שהתשלום נפרע נוצרה כניסה לילד
  // והצטרפה שורה שנייה. כניסה אחת, אדם אחד, שורה אחת.
  const queue = buildPendingQueue({
    checkIns: [{ climber_id: 's2', timestamp: '2026-08-10T09:10:00.000Z', source: 'pos_sale' }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'missing' }),
    sales: [{
      id: 'ps1', payment_method: 'online', status: 'paid', student_id: 's2',
      customer_name: 'נועה לוי', total: 60,
      created_at: '2026-08-10T09:00:00.000Z', updated_at: '2026-08-10T09:05:00.000Z',
    }],
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].name, 'תמר לוי');
  assert.equal(queue[0].payer_name, 'נועה לוי');
  assert.equal(queue[0].paid, true);
  assert.equal(queue[0].needs_safety, true);
});

test('a payment with no climber attached keeps its own row under the payer', () => {
  const queue = buildPendingQueue({
    checkIns: [],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'missing' }),
    sales: [{
      id: 'ps9', payment_method: 'online', status: 'pending_payment',
      customer_name: 'קונה מזדמן', total: 20, created_at: '2026-08-10T09:00:00.000Z',
    }],
  });
  assert.deepEqual(queue.map((r) => r.name), ['קונה מזדמן']);
  assert.equal(queue[0].needs_safety, undefined);
});

test('a climber with nothing open moves to the shift list, not the task list', () => {
  const parts = {
    checkIns: [
      { climber_id: 's1', timestamp: '2026-08-10T09:00:00.000Z' },
      { climber_id: 's2', timestamp: '2026-08-10T09:30:00.000Z' },
    ],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: (id) => (id === 's1' ? { state: 'valid' } : { state: 'missing' }),
    sales: [],
  };
  const { pending, active } = buildCounterQueues(parts);
  assert.deepEqual(pending.map((r) => r.name), ['תמר לוי']);
  assert.deepEqual(active.map((r) => r.name), ['יונתן כהן']);
});

test('someone whose payment is still open is not counted as climbing', () => {
  const { pending, active } = buildCounterQueues({
    checkIns: [{ climber_id: 's1', timestamp: '2026-08-10T09:00:00.000Z' }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
    sales: [{
      id: 'ps1', payment_method: 'online', status: 'pending_payment', student_id: 's1',
      customer_name: 'אבי כהן', total: 60, created_at: '2026-08-10T08:55:00.000Z',
    }],
  });
  assert.deepEqual(pending.map((r) => r.name), ['יונתן כהן']);
  assert.deepEqual(active, []);
});

test('„אפשר להכניס” נאמר רק על מכירה שקנתה כניסה', () => {
  // זוג נעליים ששולם אינו אישור כניסה. הכיתוב הזה על שורה של נעליים שולח
  // מטפס לקיר בלי שקנה כניסה, ואיש בדלפק לא יידע.
  const base = {
    sales: [
      { id: 'shoes', payment_method: 'online', status: 'paid', created_at: '2026-08-10T08:30:00.000Z',
        customer_name: 'יעל חורב', student_id: 's1', total: 350,
        items: [{ name: 'נעלי REFLEX', grants_wall_climbing: false }] },
      { id: 'entry', payment_method: 'online', status: 'paid', created_at: '2026-08-10T09:00:00.000Z',
        customer_name: 'נועה לוי', student_id: 's2', total: 60,
        items: [{ name: 'כניסה לקיר', grants_wall_climbing: true }] },
    ],
    today: TODAY,
    dateOf,
    studentOf,
  };
  const rows = paymentRows(base);
  assert.equal(rows.find((r) => r.sale_id === 'shoes').grants_entry, false);
  assert.equal(rows.find((r) => r.sale_id === 'entry').grants_entry, true);
});

test('מכירה במזומן אינה ממתינה לטיפול, אבל היא כן במכירות המשמרת', () => {
  // העובד שגבה במזומן ראה את הכסף; אין על מה שיאשר. עדיין צריך שהמכירה
  // תופיע איפשהו, אחרת אין בדלפק תמונה של מה נמכר במשמרת.
  const parts = {
    checkIns: [],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
    sales: [
      { id: 'c1', payment_method: 'cash', status: 'paid', created_at: '2026-08-10T09:00:00.000Z',
        customer_name: 'קונה במזומן', total: 20, items: [{ name: 'ארטיק' }] },
      { id: 'o1', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T09:30:00.000Z',
        customer_name: 'ממתין לקישור', total: 60 },
    ],
  };
  const { pending, sales } = buildCounterQueues(parts);
  assert.deepEqual(pending.map((r) => r.name), ['ממתין לקישור']);
  // הכי חדש בראש.
  assert.deepEqual(sales.map((r) => r.name), ['ממתין לקישור', 'קונה במזומן']);
  assert.equal(sales.find((r) => r.sale_id === 'c1').method, 'cash');
});

test('מכירה מבוטלת אינה נספרת במכירות המשמרת', () => {
  const rows = shiftSales({
    sales: [
      { id: 'x', payment_method: 'cash', status: 'cancelled', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'בוטל' },
      { id: 'y', payment_method: 'cash', status: 'paid', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'תקין' },
    ],
    today: TODAY,
    dateOf,
    studentOf,
  });
  assert.deepEqual(rows.map((r) => r.name), ['תקין']);
});
