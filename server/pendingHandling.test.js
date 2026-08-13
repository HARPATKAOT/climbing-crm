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

test('only an unpaid payment link remains in the treatment queue', () => {
  const sales = [
    { id: 'ps1', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'אבי כהן', total: 60, items: [{ name: 'כניסה בודדת' }] },
    { id: 'ps2', payment_method: 'online', status: 'paid', created_at: '2026-08-10T09:10:00.000Z', updated_at: '2026-08-10T09:14:00.000Z', customer_name: 'נועה לוי', total: 500 },
    { id: 'ps3', payment_method: 'online', status: 'paid', handled_at: '2026-08-10T09:20:00.000Z', created_at: '2026-08-10T09:05:00.000Z', customer_name: 'כבר טופל' },
    { id: 'ps4', payment_method: 'cash', status: 'paid', created_at: '2026-08-10T09:06:00.000Z', customer_name: 'שילם במזומן' },
    { id: 'ps5', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-09T09:00:00.000Z', customer_name: 'אתמול' },
  ];
  const rows = paymentRows({ sales, today: TODAY, dateOf });
  assert.deepEqual(rows.map((r) => r.name), ['אבי כהן']);
  assert.equal(rows[0].paid, false);
  assert.equal(rows[0].items, 'כניסה בודדת');
});

test('a paid link leaves treatment immediately while safety and unpaid links remain', () => {
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
  assert.deepEqual(queue.map((r) => r.name), ['תמר לוי', 'ממתין לכסף']);
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
      { id: 'ps1', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'ממתין' },
    ],
  };
  assert.deepEqual(buildPendingQueue(parts).map((r) => r.name), ['תמר לוי', 'ממתין']);
  assert.deepEqual(
    buildPendingQueue({ ...parts, dismissedIds: ['entry:s2'] }).map((r) => r.name),
    ['ממתין']
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

test('a paid parent link leaves only the child safety task and stays in shift sales', () => {
  const queues = buildCounterQueues({
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
  assert.equal(queues.pending.length, 1);
  assert.equal(queues.pending[0].name, 'תמר לוי');
  assert.equal(queues.pending[0].needs_safety, true);
  assert.equal(queues.sales.length, 1);
  assert.equal(queues.sales[0].payer_name, 'נועה לוי');
  assert.equal(queues.sales[0].status, 'paid');
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

test('a paid cash wall entry repairs a missing check-in on the live counter', () => {
  const base = {
    checkIns: [],
    sales: [{
      id: 'cash-entry',
      payment_method: 'cash',
      status: 'paid',
      student_id: 's1',
      created_at: '2026-08-10T09:00:00.000Z',
      items: [{
        name: 'wall entry',
        product_type: 'product',
        grants_wall_climbing: true,
        participant_ids: ['s1'],
      }],
    }],
    today: TODAY,
    dateOf,
    studentOf,
  };

  const valid = buildCounterQueues({ ...base, safetyOf: () => ({ state: 'valid' }) });
  assert.deepEqual(valid.pending, []);
  assert.deepEqual(valid.active.map((row) => row.name), [students.s1.name]);

  const missing = buildCounterQueues({ ...base, safetyOf: () => ({ state: 'missing' }) });
  assert.deepEqual(missing.pending.map((row) => row.name), [students.s1.name]);
  assert.deepEqual(missing.active, []);
});

test('buying a pass does not count as entering until the pass is punched', () => {
  const queues = buildCounterQueues({
    checkIns: [],
    sales: [{
      id: 'pass-sale', status: 'paid', student_id: 's1', created_at: '2026-08-10T09:00:00.000Z',
      items: [{ product_type: 'punch_card', grants_wall_climbing: true }],
    }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
  });
  assert.deepEqual(queues.active, []);
});

test('a successful pass punch is a wall entry even without a separate check-in', () => {
  const queues = buildCounterQueues({
    checkIns: [],
    sales: [],
    punches: [{
      id: 'punch-1', student_id: 's1', punched_at: '2026-08-10T09:00:00.000Z',
    }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
  });
  assert.deepEqual(queues.active.map((row) => row.name), [students.s1.name]);
});

test('a cancelled pass punch is not a wall entry', () => {
  const queues = buildCounterQueues({
    checkIns: [],
    sales: [],
    punches: [{
      id: 'punch-1', student_id: 's1', punched_at: '2026-08-10T09:00:00.000Z',
      cancelled_at: '2026-08-10T09:01:00.000Z',
    }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
  });
  assert.deepEqual(queues.active, []);
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
      { id: 'shoes', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T08:30:00.000Z',
        customer_name: 'יעל חורב', student_id: 's1', total: 350,
        items: [{ name: 'נעלי REFLEX', grants_wall_climbing: false }] },
      { id: 'entry', payment_method: 'online', status: 'pending_payment', created_at: '2026-08-10T09:00:00.000Z',
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

test('כל עסקה מופיעה במכירות המשמרת, ורק קישור פתוח ממתין לטיפול', () => {
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
  assert.deepEqual(sales.map((r) => r.name), ['ממתין לקישור', 'קונה במזומן']);
  assert.equal(sales.find((r) => r.sale_id === 'c1').method, 'cash');
});

test('מכירה מבוטלת נשארת ביומן המשמרת לצורכי ביקורת', () => {
  const rows = shiftSales({
    sales: [
      { id: 'x', payment_method: 'cash', status: 'cancelled', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'בוטל' },
      { id: 'y', payment_method: 'cash', status: 'paid', created_at: '2026-08-10T09:00:00.000Z', customer_name: 'תקין' },
    ],
    today: TODAY,
    dateOf,
    studentOf,
  });
  assert.deepEqual(rows.map((r) => r.name), ['בוטל', 'תקין']);
  assert.equal(rows.find((row) => row.sale_id === 'x').cancelled, true);
});

test('קישור פתוח הוא גם משימה וגם רשומת עסקה; אחרי תשלום נשאר רק ביומן', () => {
  const parts = {
    checkIns: [],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
    sales: [{
      id: 'ps1', payment_method: 'online', status: 'pending_payment', student_id: 's1',
      customer_name: 'יעל חורב', total: 350, created_at: '2026-08-10T08:30:00.000Z',
      items: [{ name: 'נעלי REFLEX', grants_wall_climbing: false }],
    }],
  };
  const open = buildCounterQueues(parts);
  assert.deepEqual(open.pending.map((r) => r.sale_id), ['ps1']);
  assert.deepEqual(open.sales.map((r) => r.sale_id), ['ps1']);
  assert.equal(open.sales[0].status, 'pending_payment');

  const paid = buildCounterQueues({
    ...parts,
    sales: [{ ...parts.sales[0], status: 'paid', updated_at: '2026-08-10T08:40:00.000Z' }],
  });
  assert.deepEqual(paid.pending, []);
  assert.deepEqual(paid.sales.map((r) => r.sale_id), ['ps1']);
  assert.equal(paid.sales[0].status, 'paid');
});

test('הסרת משימה אינה מוחקת את רשומת המכירה מהיומן', () => {
  const parts = {
    checkIns: [],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
    dismissedIds: ['payment:ps1'],
    sales: [{
      id: 'ps1', payment_method: 'online', status: 'paid',
      customer_name: 'יעל חורב', total: 350, created_at: '2026-08-10T08:30:00.000Z',
    }],
  };
  const { pending, sales } = buildCounterQueues(parts);
  assert.deepEqual(pending, []);
  assert.deepEqual(sales.map((r) => r.sale_id), ['ps1']);
});

test('תשלום מאושר גובר על סטטוס מכירה ישן ומוציא אותה מממתינים', () => {
  const parts = {
    checkIns: [],
    sales: [{
      id: 'ps1', payment_id: 'pay1', payment_method: 'online', status: 'pending_payment',
      customer_name: 'שולם עכשיו', total: 90, created_at: '2026-08-10T09:00:00.000Z',
    }],
    payments: [{
      id: 'pay1', pos_sale_id: 'ps1', status: 'paid', paid_at: '2026-08-10T09:05:00.000Z',
      icount_doc_number: '1234',
    }],
    today: TODAY,
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
  };
  const queues = buildCounterQueues(parts);
  assert.deepEqual(queues.pending, []);
  assert.equal(queues.sales[0].status, 'paid');
  assert.equal(queues.sales[0].doc_number, '1234');
  assert.equal(queues.sales[0].paid_at, '2026-08-10T09:05:00.000Z');
});

test('טבלאות המשמרת אינן מערבבות כניסות ומכירות מלפני הפתיחה', () => {
  const queues = buildCounterQueues({
    checkIns: [
      { climber_id: 's1', timestamp: '2026-08-10T08:00:00.000Z' },
      { climber_id: 's2', timestamp: '2026-08-10T09:30:00.000Z' },
    ],
    sales: [
      { id: 'old', payment_method: 'cash', status: 'paid', customer_name: 'ישן', created_at: '2026-08-10T08:30:00.000Z' },
      { id: 'new', payment_method: 'cash', status: 'paid', customer_name: 'חדש', created_at: '2026-08-10T09:15:00.000Z' },
    ],
    today: TODAY,
    shiftStartedAt: '2026-08-10T09:00:00.000Z',
    dateOf,
    studentOf,
    safetyOf: () => ({ state: 'valid' }),
  });
  assert.deepEqual(queues.active.map((row) => row.name), ['תמר לוי']);
  assert.deepEqual(queues.sales.map((row) => row.name), ['חדש']);
});

test('פירוט מכירה כולל שורות, מוכר, עודף וקופון למסך הפעולות', () => {
  const [row] = shiftSales({
    sales: [{
      id: 'sale1', payment_method: 'cash', status: 'paid', sold_by: 'אילי',
      customer_name: 'לקוח', total: 70, tendered_amount: 100, change_given: 30,
      coupon_code: 'WELCOME', coupon_discount: 10,
      created_at: '2026-08-10T09:00:00.000Z',
      items: [{ name: 'כניסה לקיר', quantity: 1, unitprice: 60 }, { name: 'ארטיק', quantity: 1, unitprice: 10 }],
    }],
    today: TODAY,
    dateOf,
    studentOf,
  });
  assert.equal(row.seller_name, 'אילי');
  assert.equal(row.change_given, 30);
  assert.equal(row.coupon_code, 'WELCOME');
  assert.deepEqual(row.line_items.map((line) => line.name), ['כניסה לקיר', 'ארטיק']);
});
