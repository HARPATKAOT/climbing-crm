process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpenseCenter, filterExpenseRows } from './financeExpenseCenter.js';
import { tagUntaggedExpenses, untaggedExpenseItems } from './financeAiTagging.js';
import { attachmentFromDataUrl, bundleForEmail, deliveryRow, expenseAttachments, MAX_EMAIL_BYTES } from './accountantDelivery.js';

function makeStore(seed = {}) {
  const tables = { ...seed };
  return {
    tables,
    get: (table) => tables[table] || [],
    getOne: (table, id) => (tables[table] || []).find((row) => String(row.id) === String(id)),
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

const AUGUST = { from: '2026-08-01', to: '2026-08-31' };

const txn = (over = {}) => ({
  id: over.id ?? 't1',
  kind: 'expense',
  status: over.status ?? 'new',
  booking_date: over.booking_date ?? '2026-08-05',
  amount_agorot: over.amount_agorot ?? -35400,
  raw_description: over.raw_description ?? 'חברת החשמל',
  merchant_raw: over.raw_description ?? 'חברת החשמל',
  account_id: 'acc1',
  category_id: over.category_id ?? null,
  classified_by: over.classified_by,
});

const icountExpense = (over = {}) => ({
  id: over.id ?? 'icount:5',
  source: 'icount',
  name: over.name ?? 'חשמל',
  supplier_name: over.supplier_name ?? 'חברת החשמל',
  amount_gross: over.amount_gross ?? 354,
  expense_date: over.expense_date ?? '2026-08-03',
  document_number: '4478',
  categories: over.categories ?? [],
  category_id: over.category_id,
});

test('a matched transaction+document pair renders as ONE row with both source tags', () => {
  const center = buildExpenseCenter({
    transactions: [txn()],
    expenses: [icountExpense()],
    matches: [{ id: 'm1', transaction_id: 't1', document_id: 'icount:5', allocated_agorot: 35400, status: 'confirmed' }],
    accounts: [{ id: 'acc1', type: 'credit_card' }],
    ...AUGUST,
  });
  assert.equal(center.rows.length, 1);
  const [row] = center.rows;
  assert.equal(row.invoice_status, 'matched');
  assert.deepEqual(row.source_tags.sort(), ['credit_card', 'icount']);
  assert.equal(row.refs.expense_id, 'icount:5');
  assert.equal(center.summary.missing_invoice, 0);
});

test('without a match: two rows, the transaction is missing its invoice', () => {
  const center = buildExpenseCenter({
    transactions: [txn()],
    expenses: [icountExpense()],
    accounts: [{ id: 'acc1', type: 'credit_card' }],
    ...AUGUST,
  });
  assert.equal(center.rows.length, 2);
  const txnRow = center.rows.find((row) => row.id === 'txn:t1');
  const expRow = center.rows.find((row) => row.id === 'exp:icount:5');
  assert.equal(txnRow.invoice_status, 'missing');
  assert.equal(expRow.invoice_status, 'attached'); // הוצאת iCount היא מסמך בעצמה
  assert.equal(center.summary.missing_invoice, 1);
});

test('a proposed match folds in as proposed; merged ingested docs never appear', () => {
  const center = buildExpenseCenter({
    transactions: [txn()],
    ingested: [
      { id: 'fdoc1', status: 'parsed', total_gross_agorot: 35400, issue_date: '2026-08-04', supplier_name: 'חברת החשמל', doc_number: '4478' },
      { id: 'fdoc2', status: 'merged', total_gross_agorot: 20000, issue_date: '2026-08-04', supplier_name: 'כפול' },
    ],
    matches: [{ id: 'm1', transaction_id: 't1', document_id: 'fdoc1', allocated_agorot: 35400, status: 'proposed' }],
    accounts: [{ id: 'acc1', type: 'credit_card' }],
    ...AUGUST,
  });
  assert.equal(center.rows.length, 1);
  assert.equal(center.rows[0].invoice_status, 'proposed');
  assert.ok(!center.rows.some((row) => row.id === 'doc:fdoc2'));
});

test('categories resolve from id, legacy label, and report their source', () => {
  const categories = [
    { id: 'cat_ops', name: 'תפעול', parent_id: null },
    { id: 'cat_ops_utilities', name: 'חשמל ומים', parent_id: 'cat_ops', legacy_labels: ['חשמל'] },
  ];
  const center = buildExpenseCenter({
    transactions: [txn({ category_id: 'cat_ops_utilities', classified_by: 'ai:gemini' })],
    expenses: [icountExpense({ id: 'icount:9', categories: ['חשמל'], expense_date: '2026-08-07' })],
    categories,
    accounts: [{ id: 'acc1', type: 'bank' }],
    ...AUGUST,
  });
  const txnRow = center.rows.find((row) => row.id === 'txn:t1');
  assert.equal(txnRow.category_name, 'חשמל ומים');
  assert.equal(txnRow.category_source, 'ai');
  const expRow = center.rows.find((row) => row.id === 'exp:icount:9');
  assert.equal(expRow.category_name, 'חשמל ומים'); // legacy label ממופה
});

test('free-text filter matches supplier and doc number', () => {
  const center = buildExpenseCenter({
    expenses: [icountExpense(), icountExpense({ id: 'icount:6', supplier_name: 'פז', name: 'דלק', expense_date: '2026-08-04' })],
    ...AUGUST,
  });
  assert.equal(filterExpenseRows(center.rows, 'חשמל').length, 1);
  assert.equal(filterExpenseRows(center.rows, '4478').length, 2); // לשתיהן אותו מספר מסמך בפיקסטורה
  assert.equal(filterExpenseRows(center.rows, '').length, 2);
});

// ─── תיוג AI ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'cat_ops_utilities', name: 'חשמל ומים', parent_id: null },
  { id: 'cat_marketing', name: 'שיווק', parent_id: null },
];

test('ai tagging applies confident valid assignments and skips the rest', async () => {
  const store = makeStore({
    finance_categories: CATEGORIES,
    finance_transactions: [txn(), txn({ id: 't2', raw_description: 'ספק עלום' })],
    finance_expenses: [icountExpense()],
    ai_service_state: [],
  });
  const summary = await tagUntaggedExpenses(store, {
    apiKey: 'test-key',
    callModel: async () => JSON.stringify({
      assignments: [
        { id: 'txn:t1', category_id: 'cat_ops_utilities', confidence: 0.95 },
        { id: 'txn:t2', category_id: 'cat_ops_utilities', confidence: 0.4 },   // ביטחון נמוך
        { id: 'exp:icount:5', category_id: 'cat_no_such', confidence: 0.99 },  // id לא קיים
      ],
    }),
  });
  assert.equal(summary.tagged, 1);
  assert.equal(summary.low_confidence, 1);
  assert.equal(summary.invalid, 1);
  const tagged = store.get('finance_transactions').find((row) => row.id === 't1');
  assert.equal(tagged.category_id, 'cat_ops_utilities');
  assert.equal(tagged.classified_by, 'ai:gemini');
  assert.notEqual(tagged.status, 'classified'); // חוק ואדם גוברים על AI
});

test('ai tagging never touches rows that already have a category', async () => {
  const store = makeStore({
    finance_categories: CATEGORIES,
    finance_transactions: [txn({ category_id: 'cat_marketing' })],
    finance_expenses: [],
    ai_service_state: [],
  });
  assert.equal(untaggedExpenseItems(store).length, 0);
  const summary = await tagUntaggedExpenses(store, { apiKey: 'k', callModel: async () => { throw new Error('אסור להיקרא'); } });
  assert.equal(summary.candidates, 0);
});

test('a dead model records a failure and stops without corrupting data', async () => {
  const store = makeStore({
    finance_categories: CATEGORIES,
    finance_transactions: [txn()],
    finance_expenses: [],
    ai_service_state: [],
  });
  const summary = await tagUntaggedExpenses(store, { apiKey: 'k', callModel: async () => null });
  assert.ok(summary.error);
  assert.equal(store.get('finance_transactions')[0].category_id, null);
});

// ─── שליחה לרו״ח ────────────────────────────────────────────────────────────

test('attachments come from data-urls; garbage yields null', () => {
  const good = attachmentFromDataUrl('inv.pdf', `data:application/pdf;base64,${Buffer.from('pdf!').toString('base64')}`);
  assert.equal(good.contentType, 'application/pdf');
  assert.equal(Buffer.from(good.content, 'base64').toString(), 'pdf!');
  assert.equal(attachmentFromDataUrl('x', 'not-a-data-url'), null);
  const expense = { attachment_metadata: [{ file_name: 'a.pdf', data: 'data:application/pdf;base64,QUJD' }] };
  assert.equal(expenseAttachments(expense).length, 1);
  assert.equal(expenseAttachments({}).length, 0);
});

test('bundles split under the size cap and resends update the same delivery row', () => {
  const big = { attachments: [{ filename: 'a', content: 'x', bytes: MAX_EMAIL_BYTES - 100 }], expense: { id: 'e1', expense_date: '2026-08-01' } };
  const small = { attachments: [{ filename: 'b', content: 'y', bytes: 500 }], expense: { id: 'e2', expense_date: '2026-08-02' } };
  const bundles = bundleForEmail([big, small]);
  assert.equal(bundles.length, 2, 'חריגה מהתקרה פותחת חבילה חדשה');

  const first = deliveryRow({ id: 'e1', expense_date: '2026-08-01' }, { sentTo: 'roeh@x.co.il', ok: true });
  const second = deliveryRow({ id: 'e1', expense_date: '2026-08-01' }, { sentTo: 'roeh@x.co.il', ok: true, previous: first });
  assert.equal(first.id, second.id);
  assert.equal(second.attempts, 2);
});

test('a transaction categorized as wages is exempt from the missing-invoice chase', () => {
  const categories = [
    { id: 'cat_hr', name: 'כוח אדם', parent_id: null },
    { id: 'cat_hr_wages', name: 'שכר עובדים', parent_id: 'cat_hr', no_invoice_required: true },
  ];
  const center = buildExpenseCenter({
    transactions: [{
      id: 'txn-salary', kind: 'expense', status: 'booked', booking_date: '2026-08-16',
      amount_agorot: 65000, raw_description: 'העברה ליניב ומיקה נחמיא', account_id: 'acc-bank',
      category_id: 'cat_hr_wages',
    }],
    accounts: [{ id: 'acc-bank', type: 'bank' }],
    categories,
    from: '2026-08-01',
    to: '2026-08-31',
  });
  const row = center.rows.find((item) => item.id === 'txn:txn-salary');
  assert.equal(row.invoice_status, 'exempt');
  assert.equal(center.summary.missing_invoice, 0);
  // אותה תנועה בלי קטגוריה — עדיין נרדפת
  const untagged = buildExpenseCenter({
    transactions: [{
      id: 'txn-salary', kind: 'expense', status: 'booked', booking_date: '2026-08-16',
      amount_agorot: 65000, raw_description: 'העברה ליניב ומיקה נחמיא', account_id: 'acc-bank',
    }],
    accounts: [{ id: 'acc-bank', type: 'bank' }],
    categories,
    from: '2026-08-01',
    to: '2026-08-31',
  });
  assert.equal(untagged.summary.missing_invoice, 1);
});
