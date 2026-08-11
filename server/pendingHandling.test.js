import test from 'node:test';
import assert from 'node:assert/strict';
import { PENDING_KIND, todaysEntrants, entryRows, paymentRows, buildPendingQueue } from './pendingHandling.js';

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
