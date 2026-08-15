process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestRawTransactions, syncAccount, isIsraelBusinessDay, matureInstallments } from './bankIngestion.js';
import { createMockProvider, fromCsvRows, credentialsFromEnv, normalizeScrapedTransaction } from './bankProviders.js';
import { countsTowardProfit } from './financeCore.js';

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

const bankAccount = { id: 'acc_bank', type: 'bank', institution: 'mercantile', last4: '4411', display_name: 'עו״ש מרכנתיל' };
const cardAccount = { id: 'acc_max', type: 'credit_card', institution: 'max', last4: '9922', display_name: 'Max עסקי' };

const cardTxn = (over = {}) => ({
  externalId: over.externalId ?? 'e1',
  date: over.date ?? '2026-08-02',
  processedDate: over.processedDate ?? over.date ?? '2026-08-02',
  amountShekels: over.amountShekels ?? -450,
  description: over.description ?? 'סופר להב בעמ',
  memo: '',
  installments: over.installments ?? null,
  pending: over.pending ?? false,
  raw: {},
});

test('ingesting the same feed twice creates zero duplicates', () => {
  const store = makeStore();
  const rawTxns = [cardTxn(), cardTxn({ externalId: 'e2', amountShekels: -120, description: 'דלק פז' })];
  const first = ingestRawTransactions(store, { account: cardAccount, rawTxns, now: '2026-08-10' });
  const second = ingestRawTransactions(store, { account: cardAccount, rawTxns, now: '2026-08-10' });
  assert.equal(first.inserted, 2);
  assert.equal(second.inserted, 0);
  assert.equal(second.duplicates, 2);
  assert.equal(store.get('finance_transactions').length, 2);
});

test('overlapping pull window: only genuinely new rows are added', () => {
  const store = makeStore();
  ingestRawTransactions(store, { account: cardAccount, rawTxns: [cardTxn()], now: '2026-08-10' });
  const wider = [cardTxn(), cardTxn({ externalId: 'e3', date: '2026-08-05', amountShekels: -80, description: 'חומרי טיפוס' })];
  const result = ingestRawTransactions(store, { account: cardAccount, rawTxns: wider, now: '2026-08-10' });
  assert.equal(result.inserted, 1);
  assert.equal(result.duplicates, 1);
});

test('acceptance: a consolidated card charge in the bank is never an expense', () => {
  const store = makeStore();
  // תנועות הכרטיס עצמן — הוצאות אמיתיות
  ingestRawTransactions(store, {
    account: cardAccount,
    rawTxns: [cardTxn({ amountShekels: -450 }), cardTxn({ externalId: 'e2', amountShekels: -550, description: 'ציוד' })],
    now: '2026-08-10',
  });
  // החיוב המרוכז בבנק — 1,000 ש״ח
  ingestRawTransactions(store, {
    account: bankAccount,
    rawTxns: [cardTxn({ externalId: 'b1', date: '2026-08-10', amountShekels: -1000, description: 'מקס איט פיננסים בעמ' })],
    now: '2026-08-10',
  });
  const rows = store.get('finance_transactions');
  const settlement = rows.find((row) => row.account_id === 'acc_bank');
  assert.equal(settlement.kind, 'settlement');
  assert.equal(countsTowardProfit(settlement.kind), false);
  // ההוצאה מוכרת ברמת התנועה הבודדת בכרטיס בלבד
  const profitRows = rows.filter((row) => countsTowardProfit(row.kind));
  assert.equal(profitRows.length, 2);
  assert.equal(profitRows.reduce((sum, row) => sum + row.amount_agorot, 0), -100000);
  // והמחזור נסגר בלי פער
  const cycle = store.get('finance_cc_cycles')[0];
  assert.equal(cycle.status, 'settled');
  assert.equal(cycle.gap_agorot, 0);
});

test('a settlement that does not equal the cycle raises a gap inbox item', () => {
  const store = makeStore();
  ingestRawTransactions(store, {
    account: cardAccount,
    rawTxns: [cardTxn({ amountShekels: -450 })],
    now: '2026-08-10',
  });
  ingestRawTransactions(store, {
    account: bankAccount,
    rawTxns: [cardTxn({ externalId: 'b1', amountShekels: -500, description: 'MAX IT FINANCE' })],
    now: '2026-08-10',
  });
  const cycle = store.get('finance_cc_cycles')[0];
  assert.equal(cycle.status, 'gap');
  assert.equal(cycle.gap_agorot, 5000);
  const gapItem = store.get('finance_inbox_items').find((row) => row.item_type === 'reconciliation_gap');
  assert.ok(gapItem, 'פער חייב להפוך לפריט inbox, לא להיבלע');
});

test('future Max installments become cash-flow items, not expenses', () => {
  const store = makeStore();
  const result = ingestRawTransactions(store, {
    account: cardAccount,
    rawTxns: [
      cardTxn({ amountShekels: -300, installments: { number: 1, total: 3 }, date: '2026-08-05' }),
      cardTxn({ externalId: 'e2', amountShekels: -300, installments: { number: 2, total: 3 }, date: '2026-09-05', pending: true }),
      cardTxn({ externalId: 'e3', amountShekels: -300, installments: { number: 3, total: 3 }, date: '2026-10-05', pending: true }),
    ],
    now: '2026-08-10',
  });
  assert.equal(result.inserted, 3);
  assert.equal(result.future_installments, 2);
  const rows = store.get('finance_transactions');
  // רק התשלום הראשון הוצאה שוטפת
  assert.equal(rows.filter((row) => row.kind === 'expense').length, 1);
  assert.equal(rows.filter((row) => row.kind === 'installment_future').length, 2);
  const cashFlow = store.get('finance_cash_flow_items');
  assert.equal(cashFlow.length, 2);
  assert.deepEqual(cashFlow.map((row) => row.due_date), ['2026-09-05', '2026-10-05']);
  assert.ok(cashFlow.every((row) => row.confidence === 'known'));
});

test('zero transactions on a business day is flagged, on shabbat it is not', async () => {
  assert.equal(isIsraelBusinessDay('2026-08-12'), true);  // רביעי
  assert.equal(isIsraelBusinessDay('2026-08-15'), false); // שבת
  const store = makeStore();
  const empty = createMockProvider('mercantile', []);
  const onBusinessDay = await syncAccount(store, { account: bankAccount, provider: empty, since: '2026-07-01', now: '2026-08-12' });
  assert.equal(onBusinessDay.status, 'suspicious_empty');
  assert.ok(store.get('finance_inbox_items').some((row) => row.item_type === 'sync_error'));
  const shabbatStore = makeStore();
  const onShabbat = await syncAccount(shabbatStore, { account: bankAccount, provider: empty, since: '2026-07-01', now: '2026-08-15' });
  assert.equal(onShabbat.status, 'ok');
  assert.equal(shabbatStore.get('finance_inbox_items').length, 0);
});

test('auth failure creates an inbox item and does not throw', async () => {
  const store = makeStore();
  const failing = {
    key: 'max',
    accountType: 'credit_card',
    async fetchTransactions() {
      const error = new Error('סיסמה שגויה');
      error.code = 'auth_required';
      throw error;
    },
  };
  const result = await syncAccount(store, { account: cardAccount, provider: failing, since: '2026-07-01', now: '2026-08-12' });
  assert.equal(result.status, 'auth_required');
  const item = store.get('finance_inbox_items').find((row) => row.item_type === 'auth_required');
  assert.ok(item);
  // ריצה שנייה לא מכפילה את הפריט
  await syncAccount(store, { account: cardAccount, provider: failing, since: '2026-07-01', now: '2026-08-12' });
  assert.equal(store.get('finance_inbox_items').filter((row) => row.item_type === 'auth_required').length, 1);
});

test('matured installments become expenses, join their cycle and settle the forecast item (review fix #3)', () => {
  const store = makeStore({ financial_accounts: [cardAccount] });
  ingestRawTransactions(store, {
    account: cardAccount,
    rawTxns: [
      cardTxn({ amountShekels: -300, installments: { number: 1, total: 3 }, date: '2026-08-05' }),
      cardTxn({ externalId: 'e2', amountShekels: -300, installments: { number: 2, total: 3 }, date: '2026-09-05', pending: true }),
    ],
    now: '2026-08-10',
  });
  // חודש עבר — תשלום 2 הגיע לפירעון
  const result = matureInstallments(store, { now: '2026-09-06' });
  assert.equal(result.matured, 1);
  const rows = store.get('finance_transactions');
  assert.equal(rows.filter((row) => row.kind === 'expense').length, 2);
  assert.equal(rows.filter((row) => row.kind === 'installment_future').length, 0);
  // המחזור של ספטמבר מכיל עכשיו את התשלום שהבשיל
  const septemberCycle = store.get('finance_cc_cycles').find((cycle) => cycle.cycle_month === '2026-09');
  assert.equal(septemberCycle.expected_agorot, 30000);
  // פריט התזרים סומן כסולק ולא יופיע יותר בצפי
  const cashFlowItem = store.get('finance_cash_flow_items')[0];
  assert.ok(cashFlowItem.settled_transaction_id);
  // ריצה שנייה לא עושה כלום
  assert.equal(matureInstallments(store, { now: '2026-09-07' }).matured, 0);
});

test('pending non-installment rows are skipped until they clear (review fix #8)', () => {
  const store = makeStore();
  const result = ingestRawTransactions(store, {
    account: cardAccount,
    rawTxns: [cardTxn({ pending: true, date: '2026-08-09' })],
    now: '2026-08-10',
  });
  assert.equal(result.pending_skipped, 1);
  assert.equal(store.get('finance_transactions').length, 0);
});

test('the same real transaction from csv and scraper accounts is one row (review fix #12)', () => {
  const store = makeStore();
  const csvAccount = { id: 'acc_csv', type: 'credit_card', institution: 'csv', last4: '9922' };
  ingestRawTransactions(store, { account: csvAccount, rawTxns: [cardTxn()], now: '2026-08-10' });
  const second = ingestRawTransactions(store, { account: cardAccount, rawTxns: [cardTxn()], now: '2026-08-10' });
  assert.equal(second.duplicates, 1);
  assert.equal(store.get('finance_transactions').length, 1);
});

test('salary bank transfers classify as transfer, card credits as refund (review fixes #2, #5)', () => {
  const store = makeStore();
  ingestRawTransactions(store, {
    account: bankAccount,
    rawTxns: [cardTxn({ externalId: 's1', amountShekels: -4000, description: 'העברת משכורת - מסב' })],
    now: '2026-08-10',
  });
  ingestRawTransactions(store, {
    account: cardAccount,
    rawTxns: [cardTxn({ externalId: 'r1', amountShekels: 120, description: 'זיכוי מבית עסק' })],
    now: '2026-08-10',
  });
  const rows = store.get('finance_transactions');
  assert.equal(rows.find((row) => row.external_id === 's1').kind, 'transfer');
  assert.equal(rows.find((row) => row.external_id === 'r1').kind, 'refund');
});

test('hebrew settlement words match without latin word boundaries (review fix #13)', () => {
  const store = makeStore();
  ingestRawTransactions(store, {
    account: bankAccount,
    rawTxns: [cardTxn({ externalId: 'b1', amountShekels: -900, description: 'מקס פיננסים' })],
    now: '2026-08-10',
  });
  assert.equal(store.get('finance_transactions')[0].kind, 'settlement');
});

test('csv signs: card credit is positive, bank credit column is income (review fix #4)', () => {
  const rows = fromCsvRows([
    { account_type: 'credit_card', transaction_date: '2026-08-03', description: 'זיכוי', amount: 50, amount_negative: true },
    { account_type: 'credit_card', transaction_date: '2026-08-03', description: 'חיוב', amount: 80, amount_negative: false },
    { account_type: 'bank', transaction_date: '2026-08-03', description: 'הפקדה', amount: 200, amount_negative: false, amount_header: 'זכות' },
    { account_type: 'bank', transaction_date: '2026-08-03', description: 'חיוב', amount: 300, amount_negative: true },
  ]);
  assert.deepEqual(rows.map((row) => row.amountShekels), [50, -80, 200, -300]);
});

test('mercantile needs three credential fields, max two — no shared shape', () => {
  const env = {
    BANK_MERCANTILE_ID: '123', BANK_MERCANTILE_PASSWORD: 'x', BANK_MERCANTILE_NUM: 'u1',
    BANK_MAX_USERNAME: 'biz', BANK_MAX_PASSWORD: 'y',
  };
  assert.deepEqual(credentialsFromEnv('mercantile', env), { id: '123', password: 'x', num: 'u1' });
  assert.deepEqual(credentialsFromEnv('max', env), { username: 'biz', password: 'y' });
  assert.equal(credentialsFromEnv('mercantile', { BANK_MERCANTILE_ID: '123' }), null);
  assert.throws(() => credentialsFromEnv('leumi', env));
});

test('csv rows flow through the same pipeline as scraped rows', () => {
  const store = makeStore();
  const rawTxns = fromCsvRows([
    { id: 'ft-abc', transaction_date: '2026-08-03', description: 'שכירות אולם', amount: 8000, external_id: 'ref1' },
  ]);
  const result = ingestRawTransactions(store, { account: bankAccount, rawTxns, now: '2026-08-10' });
  assert.equal(result.inserted, 1);
  const row = store.get('finance_transactions')[0];
  assert.equal(row.amount_agorot, -800000);
  assert.equal(row.kind, 'expense');
  assert.equal(row.source, 'csv');
});

test('scraped transaction normalization keeps signs and installments', () => {
  const txn = normalizeScrapedTransaction({
    identifier: 77,
    date: '2026-08-04T00:00:00.000Z',
    processedDate: '2026-09-01T00:00:00.000Z',
    chargedAmount: -1200.5,
    description: 'ריהוט למשרד',
    installments: { number: 2, total: 6 },
    status: 'pending',
  });
  assert.equal(txn.amountShekels, -1200.5);
  assert.equal(txn.date, '2026-08-04');
  assert.equal(txn.processedDate, '2026-09-01');
  assert.deepEqual(txn.installments, { number: 2, total: 6 });
  assert.equal(txn.pending, true);
});
