import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sumDenominations,
  computeExpectedCash,
  openSession,
  closeSession,
  adjustCash,
  recordSaleInLedger,
  listLedger,
  LEDGER_ACTIONS,
} from './cashRegister.js';

function makeStore(seed = {}) {
  const data = {
    cash_register_sessions: [],
    cash_ledger: [],
    ...seed,
  };
  return {
    get: (t) => data[t] || [],
    getOne: (t, id) => (data[t] || []).find((r) => r.id === id) || null,
    insert: (t, row) => {
      const rec = { id: `${t.slice(0, 2)}${Date.now()}${Math.random()}`, ...row };
      if (!data[t]) data[t] = [];
      data[t].push(rec);
      return rec;
    },
    update: (t, id, patch) => {
      const i = (data[t] || []).findIndex((r) => r.id === id);
      if (i < 0) return null;
      data[t][i] = { ...data[t][i], ...patch };
      return data[t][i];
    },
  };
}

test('sumDenominations totals notes and coins', () => {
  assert.equal(sumDenominations({ 100: 1, 20: 2, '0.5': 2 }), 140 + 1);
});

test('open → cash sale → close tracks expected and discrepancy', () => {
  const store = makeStore();
  openSession(store, {
    denominations: { 100: 8, 20: 1 },
    reqUser: { name: 'עומר' },
    body: { employee_name: 'עומר' },
  });
  assert.equal(computeExpectedCash(store), 820);

  recordSaleInLedger(store, {
    paymentMethod: 'cash',
    total: 30,
    tendered: 100,
    changeGiven: 70,
    saleId: 'sale1',
    reqUser: { name: 'עומר' },
  });
  assert.equal(computeExpectedCash(store), 850);

  const closed = closeSession(store, {
    denominations: { 100: 8, 50: 1 },
    reqUser: { name: 'עומר' },
    body: { employee_name: 'עומר' },
  });
  assert.equal(closed.expected, 850);
  assert.equal(closed.actual, 850);
  assert.equal(closed.discrepancy, 0);
  assert.match(closed.summaryText, /מאוזנת|בפועל יש 850/);
});

test('empty reduces expected; fill increases', () => {
  const store = makeStore();
  openSession(store, {
    denominations: { 100: 10 },
    reqUser: { name: 'מנהל' },
    body: { employee_name: 'מנהל' },
  });
  adjustCash(store, {
    action: 'empty',
    amount: 200,
    reqUser: { name: 'מנהל' },
    body: { employee_name: 'מנהל' },
  });
  assert.equal(computeExpectedCash(store), 800);
  adjustCash(store, {
    action: 'fill',
    amount: 50,
    reqUser: { name: 'מנהל' },
    body: { employee_name: 'מנהל' },
  });
  assert.equal(computeExpectedCash(store), 850);
});

test('open/close/adjust require signed employee', () => {
  const store = makeStore();
  assert.throws(
    () => openSession(store, { denominations: { 100: 1 }, reqUser: { name: 'מחובר' } }),
    /יש לבחור מי מבצע/,
  );
  openSession(store, {
    denominations: { 100: 1 },
    body: { employee_name: 'דני' },
  });
  assert.throws(
    () => closeSession(store, { denominations: { 100: 1 }, reqUser: { name: 'מחובר' } }),
    /יש לבחור מי מבצע/,
  );
  assert.throws(
    () => adjustCash(store, { action: 'fill', amount: 10, reqUser: { name: 'מחובר' } }),
    /יש לבחור מי מבצע/,
  );
});

test('online sale does not change cash expected', () => {
  const store = makeStore();
  openSession(store, {
    denominations: { 100: 5 },
    reqUser: { name: 'א' },
    body: { employee_name: 'א' },
  });
  recordSaleInLedger(store, {
    paymentMethod: 'online',
    total: 200,
    reqUser: { name: 'א' },
  });
  assert.equal(computeExpectedCash(store), 500);
  assert.equal(
    store.get('cash_ledger').some((r) => r.action_type === LEDGER_ACTIONS.SALE_ONLINE),
    true
  );
});

test('ledger running: open/reset gap vs books; fill/empty adjust balance', () => {
  const store = makeStore();
  // קופה ריקה בספרים → פתיחה עם 388.6 = שינוי +388.6, מצטברת +388.6
  openSession(store, {
    denominations: { 100: 3, 50: 1, 20: 1, '10c': 1, '5': 1, '2': 1, '1': 1, '0.5': 1, '0.1': 1 },
    body: { employee_name: 'א' },
  });
  let rows = listLedger(store, { limit: 50 });
  let open = rows.find((r) => r.action_type === 'open');
  assert.equal(open.amount, 388.6);
  assert.equal(open.should_be, 0);
  assert.equal(open.gap_change, 388.6);
  assert.equal(open.gap_cumulative, 388.6);

  adjustCash(store, {
    action: 'empty',
    amount: 100,
    body: { employee_name: 'א' },
  });
  rows = listLedger(store, { limit: 50 });
  const empty = rows.find((r) => r.action_type === 'empty');
  assert.equal(empty.should_be, 288.6);
  assert.equal(empty.gap_change, -100);
  assert.equal(empty.gap_cumulative, 288.6);
  assert.equal(empty.movement, -100);

  adjustCash(store, {
    action: 'reset',
    denominations: { 100: 1, 20: 1 },
    body: { employee_name: 'א' },
  });
  rows = listLedger(store, { limit: 50 });
  const reset = rows.find((r) => r.action_type === 'reset');
  assert.equal(reset.should_be, 120);
  assert.equal(reset.amount, 120);
  assert.equal(reset.gap_change, -288.6);
  assert.equal(reset.gap_cumulative, 0);

  adjustCash(store, {
    action: 'fill',
    amount: 50,
    body: { employee_name: 'א' },
  });
  rows = listLedger(store, { limit: 50 });
  const fill = rows.find((r) => r.action_type === 'fill');
  assert.equal(fill.should_be, 170);
  assert.equal(fill.gap_change, null);
  assert.equal(fill.gap_cumulative, 0);

  assert.throws(
    () => openSession(store, { denominations: { 100: 1 }, body: { employee_name: 'א' } }),
    /כבר יש משמרת פתוחה/,
  );
});
