import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sumDenominations,
  computeExpectedCash,
  openSession,
  closeSession,
  adjustCash,
  recordSaleInLedger,
  recordRefundInLedger,
  listLedger,
  discrepancyByEmployee,
  getLastResetAt,
  sessionSnapshot,
  CASH_GO_LIVE_KEY,
  CASH_GO_LIVE_DEFAULT,
  LEDGER_ACTIONS,
} from './cashRegister.js';

// פתיחה/סגירה מחייבות עובד שמסומן בתיק כמורשה קופה — לא רק שם חתום.
const CASH_OPERATOR = { id: 'emp-operator', name: 'עומר', is_active: true, can_operate_cash: true };
const PLAIN_EMPLOYEE = { id: 'emp-plain', name: 'דני', is_active: true, can_operate_cash: false };
const OPERATOR_BODY = { employee_id: CASH_OPERATOR.id, employee_name: CASH_OPERATOR.name };

function makeStore(seed = {}) {
  const { appSettings = {}, ...tables } = seed;
  const data = {
    cash_register_sessions: [],
    cash_ledger: [],
    employees: [CASH_OPERATOR, PLAIN_EMPLOYEE],
    ...tables,
  };
  return {
    getAppSettingLocal: (key) => appSettings[key],
    setAppSettingLocal: (key, value) => { appSettings[key] = value; },
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
    body: OPERATOR_BODY,
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
    body: OPERATOR_BODY,
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
    body: OPERATOR_BODY,
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

test('open/close require an authorized operator; adjust only needs a signature', () => {
  const store = makeStore();
  assert.throws(
    () => openSession(store, { denominations: { 100: 1 }, reqUser: { name: 'מחובר' } }),
    /יש לבחור מי מבצע/,
  );
  // שם חופשי בלי בחירת עובד מהתיק לא מספיק לפתיחה/סגירה
  assert.throws(
    () => openSession(store, { denominations: { 100: 1 }, body: { employee_name: 'דני' } }),
    /עובד מורשה/,
  );
  assert.throws(
    () => openSession(store, {
      denominations: { 100: 1 },
      body: { employee_id: PLAIN_EMPLOYEE.id, employee_name: PLAIN_EMPLOYEE.name },
    }),
    /אינו מורשה/,
  );
  openSession(store, {
    denominations: { 100: 1 },
    body: OPERATOR_BODY,
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
    body: OPERATOR_BODY,
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

test('אשראי במסוף נרשם ביומן כמכירת סליקה ואינו נוגע במזומן', () => {
  const store = makeStore();
  openSession(store, {
    denominations: { 100: 5 },
    reqUser: { name: 'א' },
    body: OPERATOR_BODY,
  });
  recordSaleInLedger(store, {
    paymentMethod: 'emv',
    total: 200,
    saleId: 'emv-sale',
    reqUser: { name: 'א' },
  });
  assert.equal(computeExpectedCash(store), 500);
  const rows = store.get('cash_ledger').filter((r) => r.action_type === LEDGER_ACTIONS.SALE_ONLINE);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 200);
  assert.equal(rows[0].expected_after, null);
});

test('cash refund reduces expected cash once; online refund is audit-only', () => {
  const store = makeStore();
  openSession(store, {
    denominations: { 100: 5 },
    reqUser: { name: 'א' },
    body: OPERATOR_BODY,
  });
  recordSaleInLedger(store, {
    paymentMethod: 'cash', total: 80, saleId: 'cash-sale', reqUser: { name: 'א' },
  });
  assert.equal(computeExpectedCash(store), 580);

  recordRefundInLedger(store, {
    paymentMethod: 'cash', total: 80, saleId: 'cash-sale', reqUser: { name: 'א' },
  });
  recordRefundInLedger(store, {
    paymentMethod: 'cash', total: 80, saleId: 'cash-sale', reqUser: { name: 'א' },
  });
  assert.equal(computeExpectedCash(store), 500);
  assert.equal(
    store.get('cash_ledger').filter((r) => r.action_type === LEDGER_ACTIONS.REFUND_CASH).length,
    1,
  );

  recordRefundInLedger(store, {
    paymentMethod: 'online', total: 120, saleId: 'online-sale', reqUser: { name: 'א' },
  });
  assert.equal(computeExpectedCash(store), 500);
  assert.equal(
    store.get('cash_ledger').some((r) => r.action_type === LEDGER_ACTIONS.REFUND_ONLINE),
    true,
  );
});

test('sale ledger entry is idempotent per sale and payment method', () => {
  const store = makeStore();
  recordSaleInLedger(store, {
    paymentMethod: 'online', total: 200, saleId: 'online-sale', reqUser: { name: 'א' },
  });
  recordSaleInLedger(store, {
    paymentMethod: 'online', total: 200, saleId: 'online-sale', reqUser: { name: 'א' },
  });
  assert.equal(
    store.get('cash_ledger').filter((r) => r.action_type === LEDGER_ACTIONS.SALE_ONLINE).length,
    1,
  );
});

test('ledger running: open/reset gap vs books; fill/empty adjust balance', () => {
  const store = makeStore();
  // קופה ריקה בספרים → פתיחה עם 388.6 = שינוי +388.6, מצטברת +388.6
  openSession(store, {
    denominations: { 100: 3, 50: 1, 20: 1, '10c': 1, '5': 1, '2': 1, '1': 1, '0.5': 1, '0.1': 1 },
    body: OPERATOR_BODY,
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
    () => openSession(store, { denominations: { 100: 1 }, body: OPERATOR_BODY }),
    /כבר יש משמרת פתוחה/,
  );
});

test('פערי סגירה נצברים לפי מי שסגר — חוסר ועודף בנפרד', () => {
  const store = makeStore({
    appSettings: { [CASH_GO_LIVE_KEY]: { from: '2026-07-01' } },
    cash_register_sessions: [
      {
        id: 's1', status: 'closed', closed_at: '2026-08-01T10:00:00.000Z',
        closed_by_id: 'emp-a', closed_by_name: 'אבי',
        expected_at_close: 500, closing_actual: 400, discrepancy: -100,
      },
      {
        id: 's2', status: 'closed', closed_at: '2026-08-05T10:00:00.000Z',
        closed_by_id: 'emp-a', closed_by_name: 'אבי',
        expected_at_close: 300, closing_actual: 260, discrepancy: -40,
      },
      {
        id: 's3', status: 'closed', closed_at: '2026-08-06T10:00:00.000Z',
        closed_by_id: 'emp-b', closed_by_name: 'בת',
        expected_at_close: 200, closing_actual: 230, discrepancy: 30,
      },
      {
        id: 's4', status: 'closed', closed_at: '2026-08-07T10:00:00.000Z',
        closed_by_id: 'emp-b', closed_by_name: 'בת',
        expected_at_close: 200, closing_actual: 200, discrepancy: 0,
      },
      // משמרת פתוחה עדיין לא נספרת
      { id: 's5', status: 'open', opened_at: '2026-08-08T06:00:00.000Z', discrepancy: -999 },
    ],
    // שיקוף הסגירות לרשימה הישנה — אסור שייספר פעמיים
    cash_register_shifts: [
      { id: 'l1', session_id: 's1', employee: 'אבי', discrepancy: -100, created_at: '2026-08-01T10:00:00.000Z' },
      { id: 'l2', employee: 'גד', discrepancy: -25, created_at: '2026-08-02T10:00:00.000Z' },
    ],
  });

  const report = discrepancyByEmployee(store, {});
  const byName = Object.fromEntries(report.rows.map((r) => [r.employee_name, r]));

  assert.equal(byName['אבי'].closes, 2);
  assert.equal(byName['אבי'].gaps, 2);
  assert.equal(byName['אבי'].shortage_total, 140);
  assert.equal(byName['אבי'].worst_shortage, 100);
  assert.equal(byName['אבי'].surplus_total, 0);

  assert.equal(byName['בת'].closes, 2);
  assert.equal(byName['בת'].gaps, 1);
  assert.equal(byName['בת'].surplus_total, 30);
  assert.equal(byName['בת'].shortage_total, 0);

  // סגירה ישנה בלי session_id נספרת פעם אחת לפי השם
  assert.equal(byName['גד'].closes, 1);
  assert.equal(byName['גד'].shortage_total, 25);

  // הגדול בחוסר מוביל את הרשימה
  assert.equal(report.rows[0].employee_name, 'אבי');
  assert.equal(report.totals.closes, 5);
  assert.equal(report.totals.gaps, 4);
  assert.equal(report.totals.shortage_total, 165);

  // חלון תאריכים חותך סגירות ישנות
  const recent = discrepancyByEmployee(store, { from: '2026-08-05' });
  assert.equal(recent.totals.closes, 3);
  assert.equal(recent.totals.shortage_total, 40);
});

test('getLastResetAt מחזיר את הספירה או האיפוס האחרונים', () => {
  const store = makeStore();
  assert.equal(getLastResetAt(store), null);

  openSession(store, { denominations: { 100: 1 }, body: OPERATOR_BODY });
  assert.equal(getLastResetAt(store), null);

  adjustCash(store, {
    action: 'reset',
    denominations: { 100: 1, 20: 1 },
    body: { employee_name: 'מנהל' },
  });
  const first = getLastResetAt(store);
  assert.ok(first);

  adjustCash(store, {
    action: 'reset',
    denominations: { 50: 1 },
    body: { employee_name: 'מנהל' },
  });
  assert.ok(getLastResetAt(store) >= first);
  assert.equal(sessionSnapshot(store).last_reset_at, getLastResetAt(store));
});

test('תקופת הבדיקות שלפני המעבר לעבודה לא נספרת, גם ב"הכל"', () => {
  const sessions = [
    {
      id: 'test1', status: 'closed', closed_at: '2026-08-09T05:12:18.000Z',
      closed_by_id: 'emp-a', closed_by_name: 'אבי',
      expected_at_close: 1000, closing_actual: 270, discrepancy: -730,
    },
    {
      id: 'real1', status: 'closed', closed_at: '2026-08-21T18:00:00.000Z',
      closed_by_id: 'emp-a', closed_by_name: 'אבי',
      expected_at_close: 410, closing_actual: 400, discrepancy: -10,
    },
  ];

  // בלי הגדרה — נופלים לתאריך המעבר שבקוד
  const store = makeStore({ cash_register_sessions: sessions });
  assert.equal(sessionSnapshot(store).go_live_from, CASH_GO_LIVE_DEFAULT);
  const report = discrepancyByEmployee(store, {});
  assert.equal(report.from, CASH_GO_LIVE_DEFAULT);
  assert.equal(report.totals.closes, 1);
  assert.equal(report.totals.shortage_total, 10);

  // בקשה לטווח מוקדם יותר לא פותחת את תקופת הבדיקות
  const stretched = discrepancyByEmployee(store, { from: '2026-01-01' });
  assert.equal(stretched.from, CASH_GO_LIVE_DEFAULT);
  assert.equal(stretched.totals.closes, 1);

  // טווח צר יותר מהמעבר כן מכובד
  const narrow = discrepancyByEmployee(store, { from: '2026-08-22' });
  assert.equal(narrow.totals.closes, 0);

  // הזזת התאריך בהגדרה מחזירה את התקופה הישנה בלי גרסה חדשה
  const moved = makeStore({
    appSettings: { [CASH_GO_LIVE_KEY]: { from: '2026-08-01' } },
    cash_register_sessions: sessions,
  });
  assert.equal(discrepancyByEmployee(moved, {}).totals.closes, 2);
});
