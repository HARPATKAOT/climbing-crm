process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildLedger, plStatement, monthlySeries } from './financeLedger.js';
import { isNightlyDue } from './financeNightly.js';
import { rebuildCashFlowForecast, detectRecurringExpenses, cashFlowTimeline } from './financeCashFlow.js';

function makeStore(seed = {}) {
  const tables = { ...seed };
  return {
    tables,
    get: (table) => tables[table] || [],
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      tables[table].push(record);
      return record;
    },
    update: (table, id, record) => {
      const list = tables[table] || [];
      const index = list.findIndex((row) => String(row.id) === String(id));
      if (index >= 0) list[index] = record;
      return record;
    },
  };
}

const NOW = '2026-08-15T00:00:00.000Z';

const baseSeed = () => ({
  payments: [{ id: 'p1', status: 'paid', amount: 354, paid_at: '2026-08-05T10:00:00Z', pos_sale_id: null }],
  finance_expenses: [
    { id: 'icount:5', source: 'icount', name: 'חשמל', supplier_name: 'חברת החשמל', amount_gross: 354, amount_net: 300, expense_date: '2026-08-03', paid: true, categories: ['חשמל'] },
  ],
  finance_transactions: [
    { id: 't1', kind: 'expense', status: 'classified', booking_date: '2026-08-04', amount_agorot: -35400, raw_description: 'חברת החשמל', category_id: 'cat_ops_utilities' },
  ],
  finance_matches: [
    { id: 'm1', transaction_id: 't1', document_id: 'icount:5', allocated_agorot: 35400, status: 'confirmed' },
  ],
  finance_categories: [
    { id: 'cat_income', name: 'הכנסות', parent_id: null, is_income: true },
    { id: 'cat_ops', name: 'תפעול', parent_id: null },
    { id: 'cat_ops_utilities', name: 'חשמל ומים', parent_id: 'cat_ops', legacy_labels: ['חשמל'] },
    { id: 'cat_hr', name: 'כוח אדם', parent_id: null },
    { id: 'cat_hr_wages', name: 'שכר', parent_id: 'cat_hr' },
    { id: 'cat_hr_social', name: 'הפרשות', parent_id: 'cat_hr' },
    { id: 'cat_income_entries', name: 'מנויים', parent_id: 'cat_income', is_income: true },
  ],
});

test('no double counting: a matched expense is one cash entry, one accrual entry', () => {
  const store = makeStore(baseSeed());
  rebuildLedger(store, { now: NOW });
  const entries = store.get('finance_ledger_entries').filter((row) => !row.voided_at);
  const cashExpenses = entries.filter((row) => row.basis === 'cash' && row.amount_agorot < 0);
  assert.equal(cashExpenses.length, 1, 'תנועת הבנק היא האמת — המסמך המקושר לא נספר שוב');
  assert.equal(cashExpenses[0].source_type, 'transaction');
  assert.equal(cashExpenses[0].amount_agorot, -35400);
  const accrualExpenses = entries.filter((row) => row.basis === 'accrual' && row.amount_agorot < 0);
  assert.equal(accrualExpenses.length, 1);
  assert.equal(accrualExpenses[0].source_type, 'expense');
  assert.equal(accrualExpenses[0].category_id, 'cat_ops_utilities'); // מיפוי legacy
  // הכנסה במזומן מהתשלום
  const cashIncome = entries.filter((row) => row.basis === 'cash' && row.amount_agorot > 0);
  assert.equal(cashIncome.length, 1);
  assert.equal(cashIncome[0].amount_agorot, 35400);
});

test('an unmatched paid expense document does count in cash basis', () => {
  const seed = baseSeed();
  seed.finance_matches = [];
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const cashExpenses = store.get('finance_ledger_entries')
    .filter((row) => !row.voided_at && row.basis === 'cash' && row.amount_agorot < 0);
  // התנועה וגם המסמך — כי בלי match אין ידיעה שזה אותו כסף; ההתאמה היא הפתרון
  assert.equal(cashExpenses.length, 2);
});

test('a PROPOSED match already suppresses the duplicate cash entry (review fix #1)', () => {
  const seed = baseSeed();
  seed.finance_matches = [{ id: 'm1', transaction_id: 't1', document_id: 'icount:5', allocated_agorot: 35400, status: 'proposed' }];
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const cashExpenses = store.get('finance_ledger_entries')
    .filter((row) => !row.voided_at && row.basis === 'cash' && row.amount_agorot < 0);
  assert.equal(cashExpenses.length, 1, 'הצעה בציון 60+ מספיקה כדי לא לספור פעמיים');
  assert.equal(cashExpenses[0].source_type, 'transaction');
  // דחייה מחזירה את המסמך לספירה
  store.tables.finance_matches[0].status = 'rejected';
  rebuildLedger(store, { now: NOW });
  assert.equal(store.get('finance_ledger_entries')
    .filter((row) => !row.voided_at && row.basis === 'cash' && row.amount_agorot < 0).length, 2);
});

test('a refund is booked on its own date, not netted into the sale month (review fix #9)', () => {
  const seed = baseSeed();
  seed.payments = [{
    id: 'p1', status: 'refunded', amount: 354, refund_amount: 100,
    paid_at: '2026-06-05T10:00:00Z', refunded_at: '2026-08-09T10:00:00Z',
  }];
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const income = store.get('finance_ledger_entries')
    .filter((row) => !row.voided_at && row.source_type === 'payment');
  const sale = income.find((row) => row.amount_agorot > 0);
  const refund = income.find((row) => row.amount_agorot < 0);
  assert.equal(sale.period, '2026-06');
  assert.equal(sale.amount_agorot, 35400);
  assert.equal(refund.period, '2026-08');
  assert.equal(refund.amount_agorot, -10000);
});

test('a bank income row enters the ledger only after explicit classification (review fix #5)', () => {
  const seed = baseSeed();
  seed.finance_transactions.push(
    { id: 'in1', kind: 'income', status: 'new', booking_date: '2026-08-06', amount_agorot: 50000, raw_description: 'זיכוי ריבית' },
    { id: 'in2', kind: 'income', status: 'classified', category_id: 'cat_income', booking_date: '2026-08-07', amount_agorot: 60000, raw_description: 'החזר מס' },
  );
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const txnIncome = store.get('finance_ledger_entries')
    .filter((row) => !row.voided_at && row.source_type === 'transaction' && row.amount_agorot > 0);
  assert.equal(txnIncome.length, 1);
  assert.equal(txnIncome[0].source_id, 'in2');
});

test('rebuilding twice neither duplicates nor grows', () => {
  const store = makeStore(baseSeed());
  rebuildLedger(store, { now: NOW });
  const firstCount = store.get('finance_ledger_entries').length;
  const second = rebuildLedger(store, { now: NOW });
  assert.equal(store.get('finance_ledger_entries').length, firstCount);
  assert.equal(second.voided, 0);
});

test('an entry whose source disappears is voided, never deleted', () => {
  const store = makeStore(baseSeed());
  rebuildLedger(store, { now: NOW });
  store.tables.finance_transactions = [];
  rebuildLedger(store, { now: NOW });
  const voided = store.get('finance_ledger_entries').filter((row) => row.voided_at);
  assert.equal(voided.length, 1);
  assert.equal(voided[0].source_type, 'transaction');
});

test('multi-month membership is deferred: reversal plus equal spread, sum preserved', () => {
  const seed = baseSeed();
  seed.customer_passes = [{ id: 'cp1', status: 'active', paid_price: 900, valid_from: '2026-08-01', valid_until: '2026-10-31' }];
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const deferrals = store.get('finance_ledger_entries').filter((row) => row.source_type === 'deferral' && !row.voided_at);
  assert.equal(deferrals.length, 4); // היפוך + 3 חודשי הכרה
  const total = deferrals.reduce((sum, row) => sum + row.amount_agorot, 0);
  assert.equal(total, 0, 'הפריסה מזיזה הכנסה בין חודשים, לא ממציאה ולא מאבדת');
  const monthly = deferrals.filter((row) => row.amount_agorot > 0);
  assert.deepEqual(monthly.map((row) => row.period), ['2026-08', '2026-09', '2026-10']);
  assert.equal(monthly.reduce((sum, row) => sum + row.amount_agorot, 0), 90000);
});

test('payroll enters accrual from frozen rows and cash from actual payments', () => {
  const seed = baseSeed();
  seed.work_assignments = [
    { id: 'w1', employee_id: 'e-27', date: '2026-08-03', group_id: 'g-1', hours: 2, pay_amount: 200 },
  ];
  seed.groups = [{ id: 'g-1', name: 'מתקדמים' }];
  seed.payroll_periods = [{ id: 'pp1', employee_id: 'e-27', period: '2026-07', salary_amount: 4000, salary_paid_at: '2026-08-09' }];
  seed.finance_center_settings = [{ id: 'default', employer_cost_factor: 1.25 }];
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const entries = store.get('finance_ledger_entries').filter((row) => row.source_type === 'payroll' && !row.voided_at);
  const wages = entries.find((row) => row.source_id === 'wages:2026-08');
  const employer = entries.find((row) => row.source_id === 'employer:2026-08');
  const paid = entries.find((row) => row.basis === 'cash');
  assert.equal(wages.amount_agorot, -20000);
  assert.equal(employer.amount_agorot, -5000);
  assert.equal(paid.amount_agorot, -400000);
  // מרכז עלות לחוג נוצר
  assert.ok(store.get('finance_cost_centers').some((row) => row.id === 'cc_groups_g-1'));
});

test('P&L tiers: revenue, credits, cogs, wages, opex, ebitda', () => {
  const categories = baseSeed().finance_categories.concat([{ id: 'cat_cogs_goods', name: 'סחורה', parent_id: null, is_cogs: true }]);
  const entries = [
    { basis: 'cash', entry_date: '2026-08-01', period: '2026-08', amount_agorot: 100000, category_id: 'cat_income', source_type: 'payment' },
    { basis: 'cash', entry_date: '2026-08-02', period: '2026-08', amount_agorot: -5000, category_id: 'cat_income', source_type: 'payment' },
    { basis: 'cash', entry_date: '2026-08-03', period: '2026-08', amount_agorot: -20000, category_id: 'cat_cogs_goods', source_type: 'expense' },
    { basis: 'cash', entry_date: '2026-08-04', period: '2026-08', amount_agorot: -10000, category_id: 'cat_hr_wages', source_type: 'payroll' },
    { basis: 'cash', entry_date: '2026-08-05', period: '2026-08', amount_agorot: -15000, category_id: 'cat_ops_utilities', source_type: 'transaction' },
    { basis: 'accrual', entry_date: '2026-08-05', period: '2026-08', amount_agorot: -99999, category_id: 'cat_ops_utilities', source_type: 'expense' },
  ];
  const pl = plStatement({ entries, categories, from: '2026-08-01', to: '2026-08-31', basis: 'cash' });
  assert.equal(pl.revenue_agorot, 100000);
  assert.equal(pl.credits_agorot, 5000);
  assert.equal(pl.net_revenue_agorot, 95000);
  assert.equal(pl.cogs_agorot, 20000);
  assert.equal(pl.gross_profit_agorot, 75000);
  assert.equal(pl.wages_agorot, 10000);
  assert.equal(pl.opex_agorot, 15000);
  assert.equal(pl.ebitda_agorot, 50000);
  assert.equal(pl.net_profit_agorot, 50000);
});

test('monthly series aggregates by period on one basis only', () => {
  const entries = [
    { basis: 'cash', period: '2026-07', entry_date: '2026-07-05', amount_agorot: 50000 },
    { basis: 'cash', period: '2026-08', entry_date: '2026-08-05', amount_agorot: 80000 },
    { basis: 'cash', period: '2026-08', entry_date: '2026-08-08', amount_agorot: -30000 },
    { basis: 'accrual', period: '2026-08', entry_date: '2026-08-08', amount_agorot: -999999 },
  ];
  const series = monthlySeries({ entries, basis: 'cash', now: NOW });
  assert.deepEqual(series, [
    { period: '2026-07', income_agorot: 50000, expense_agorot: 0, profit_agorot: 50000 },
    { period: '2026-08', income_agorot: 80000, expense_agorot: 30000, profit_agorot: 50000 },
  ]);
});

// ─── תזרים ──────────────────────────────────────────────────────────────────

test('recurring expense detection needs three consecutive similar months', () => {
  const monthly = (month, amount) => ({ supplier_name: 'שכירות בעמ', amount_gross: amount, expense_date: `${month}-01` });
  const stable = detectRecurringExpenses({
    expenses: [monthly('2026-05', 8000), monthly('2026-06', 8000), monthly('2026-07', 8200)],
    now: NOW,
  });
  assert.equal(stable.length, 1);
  assert.equal(stable[0].amount_agorot, 800000);
  const gappy = detectRecurringExpenses({
    expenses: [monthly('2026-04', 8000), monthly('2026-06', 8000), monthly('2026-07', 8000)],
    now: NOW,
  });
  assert.equal(gappy.length, 0, 'חודש חסר שובר את הרצף');
  const noisy = detectRecurringExpenses({
    expenses: [monthly('2026-05', 8000), monthly('2026-06', 15000), monthly('2026-07', 3000)],
    now: NOW,
  });
  assert.equal(noisy.length, 0, 'סטייה גדולה אינה מחזוריות');
});

test('forecast rebuild is idempotent and projects enrollments income', () => {
  const store = makeStore({
    finance_expenses: [
      { supplier_name: 'שכירות בעמ', amount_gross: 8000, expense_date: '2026-05-01' },
      { supplier_name: 'שכירות בעמ', amount_gross: 8000, expense_date: '2026-06-01' },
      { supplier_name: 'שכירות בעמ', amount_gross: 8000, expense_date: '2026-07-01' },
    ],
    enrollments: [{ group_id: 'g-1', status: 'active', price: 380 }],
    finance_ledger_entries: [],
  });
  const first = rebuildCashFlowForecast(store, { now: NOW });
  const countAfterFirst = store.get('finance_cash_flow_items').length;
  rebuildCashFlowForecast(store, { now: NOW });
  assert.equal(store.get('finance_cash_flow_items').length, countAfterFirst);
  assert.equal(first.recurring_expenses, 3); // שלושה חודשי אופק
  assert.equal(first.income, 3);
  const income = store.get('finance_cash_flow_items').find((row) => row.source_type === 'recurring_income');
  assert.equal(income.amount_agorot, 38000);
});

test('an unpaid iCount invoice books only the collected part as cash income — once', () => {
  const seed = baseSeed();
  seed.payments = [];
  seed.finance_documents = [{
    id: 'icount:invoice:501', doctype: 'invoice', docnum: '501', document_date: '2026-08-03',
    total_gross: 500, total_net: 423.73, remaining_sum: 200,
  }];
  const store = makeStore(seed);
  rebuildLedger(store, { now: NOW });
  const income = store.get('finance_ledger_entries')
    .filter((row) => !row.voided_at && row.basis === 'cash' && row.source_type === 'payment');
  assert.equal(income.length, 1);
  // 500 פחות 200 יתרה = 300 שנגבו; הניכוי קורה פעם אחת בלבד (בדוח, לא שוב בספר)
  assert.equal(income[0].amount_agorot, 30000);
});

test('nightly due-check: once a day, only after 04:00 Israel time', () => {
  const at = (iso) => new Date(iso);
  // 02:00 בלילה בישראל (23:00 UTC) — לפני החלון
  assert.equal(isNightlyDue(null, at('2026-08-14T23:00:00Z')), false);
  // 05:00 בבוקר בישראל (02:00 UTC), אף פעם לא רצה — כן
  assert.equal(isNightlyDue(null, at('2026-08-15T02:00:00Z')), true);
  // רצה כבר היום — לא
  assert.equal(isNightlyDue({ last_run_at: '2026-08-15T02:05:00Z' }, at('2026-08-15T09:00:00Z')), false);
  // רצה אתמול — כן
  assert.equal(isNightlyDue({ last_run_at: '2026-08-14T02:05:00Z' }, at('2026-08-15T02:00:00Z')), true);
});

test('timeline accumulates and finds the minimum point', () => {
  const timeline = cashFlowTimeline({
    from: '2026-08-15',
    days: 60,
    items: [
      { due_date: '2026-08-20', amount_agorot: -50000, direction: 'out' },
      { due_date: '2026-09-05', amount_agorot: 80000, direction: 'in' },
      { due_date: '2026-09-10', amount_agorot: -10000, direction: 'out' },
    ],
  });
  assert.equal(timeline.net_agorot, 20000);
  assert.equal(timeline.minimum.amount_agorot, -50000);
  assert.equal(timeline.minimum.date, '2026-08-20');
  assert.equal(timeline.items[2].cumulative_agorot, 20000);
});
