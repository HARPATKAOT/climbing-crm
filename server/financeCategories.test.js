process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seedCategories,
  categoryForLegacyLabel,
  ruleMatches,
  applyRules,
  learnRule,
  vatSummary,
  DEFAULT_CATEGORIES,
} from './financeCategories.js';

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

test('seeding twice inserts the tree once and keeps user edits', () => {
  const store = makeStore();
  const first = seedCategories(store);
  assert.equal(first.inserted, DEFAULT_CATEGORIES.length);
  // המשתמש שינה שם — הזריעה הבאה לא דורסת
  const rent = store.get('finance_categories').find((row) => row.id === 'cat_ops_rent');
  store.update('finance_categories', rent.id, { ...rent, name: 'שכירות המתחם' });
  const second = seedCategories(store);
  assert.equal(second.inserted, 0);
  assert.equal(store.get('finance_categories').find((row) => row.id === 'cat_ops_rent').name, 'שכירות המתחם');
});

test('legacy free-text labels map into the tree', () => {
  const categories = DEFAULT_CATEGORIES.map((category) => ({ legacy_labels: [], ...category }));
  assert.equal(categoryForLegacyLabel(categories, 'שכ"ד').id, 'cat_ops_rent');
  assert.equal(categoryForLegacyLabel(categories, 'ביטוח לאומי').id, 'cat_hr_social');
  assert.equal(categoryForLegacyLabel(categories, 'תווית שאין לה בית'), null);
});

const expenseTxn = (over = {}) => ({
  id: over.id ?? 't1',
  kind: over.kind ?? 'expense',
  status: over.status ?? 'new',
  amount_agorot: over.amount_agorot ?? -11800,
  merchant_raw: over.merchant_raw ?? 'חברת החשמל לישראל',
  raw_description: over.raw_description ?? over.merchant_raw ?? 'חברת החשמל לישראל',
  category_id: over.category_id ?? null,
});

test('rules classify open transactions but never touch manual or settlement rows', () => {
  const store = makeStore({
    finance_rules: [{
      id: 'r1', is_active: true,
      matcher: { merchant_pattern: 'חברת החשמל' },
      set_category_id: 'cat_ops_utilities',
      hits: 0,
    }],
    finance_transactions: [
      expenseTxn({ id: 'a' }),
      expenseTxn({ id: 'b', category_id: 'cat_ops_rent', status: 'classified' }), // ידני — לא נוגעים
      expenseTxn({ id: 'c', kind: 'settlement' }),
      expenseTxn({ id: 'd', merchant_raw: 'ספק אחר לגמרי' }),
    ],
  });
  const summary = applyRules(store);
  assert.equal(summary.classified, 1);
  const rows = Object.fromEntries(store.get('finance_transactions').map((row) => [row.id, row]));
  assert.equal(rows.a.category_id, 'cat_ops_utilities');
  assert.equal(rows.a.status, 'classified');
  assert.equal(rows.b.category_id, 'cat_ops_rent');
  assert.equal(rows.c.category_id, null);
  assert.equal(rows.d.category_id, null);
  assert.equal(store.get('finance_rules')[0].hits, 1);
});

test('rule matching honors amount bounds', () => {
  const rule = { matcher: { merchant_pattern: 'חברת החשמל', min_agorot: 10000, max_agorot: 50000 } };
  assert.equal(ruleMatches(rule, expenseTxn({ amount_agorot: -20000 })), true);
  assert.equal(ruleMatches(rule, expenseTxn({ amount_agorot: -5000 })), false);
  assert.equal(ruleMatches(rule, expenseTxn({ amount_agorot: -90000 })), false);
});

test('learnRule is idempotent and validates its inputs', () => {
  const store = makeStore();
  const first = learnRule(store, { merchantPattern: 'PAZ TLV', categoryId: 'cat_ops_utilities' });
  const second = learnRule(store, { merchantPattern: 'paz tlv', categoryId: 'cat_ops_utilities' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(store.get('finance_rules').length, 1);
  assert.throws(() => learnRule(store, { merchantPattern: '', categoryId: 'x' }));
  assert.throws(() => learnRule(store, { merchantPattern: 'y' }));
});

test('vat summary splits deductible from lost by document coverage and category rate', () => {
  const result = vatSummary({
    documentsVatAgorot: 50000,
    transactions: [
      expenseTxn({ id: 'covered', amount_agorot: -11800, category_id: 'cat_ops_utilities' }),
      expenseTxn({ id: 'uncovered', amount_agorot: -11800, category_id: 'cat_ops_utilities' }),
      expenseTxn({ id: 'nondeductible', amount_agorot: -11800, category_id: 'cat_finance_bank' }),
    ],
    matches: [{ transaction_id: 'covered', allocated_agorot: 11800, status: 'confirmed' }],
    categories: [
      { id: 'cat_ops_utilities', vat_deductible_rate: 1 },
      { id: 'cat_finance_bank', vat_deductible_rate: 0 },
    ],
  });
  assert.equal(result.input_vat_deductible_agorot, 1800); // רק המכוסה
  assert.equal(result.input_vat_lost_agorot, 1800);       // המכוסה-לא; העמלה בשיעור 0 לא נספרת
  assert.equal(result.net_position_agorot, 48200);
});
