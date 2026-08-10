import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, chooseExpenseRows, classifyDocument, expenseFingerprint, reconcileExpenses } from './finance.js';

test('recognizes only accounting revenue documents', () => {
  assert.equal(classifyDocument('invoice').recognized, true);
  assert.equal(classifyDocument('invrec').recognized, true);
  assert.equal(classifyDocument('deal').recognized, false);
  assert.equal(classifyDocument('offer').recognized, false);
  assert.equal(classifyDocument('deal', { total: -936 }).recognized, false);
});

test('golden fixture excludes deals and offers from revenue', () => {
  const documents = [
    { id: '1', doctype: 'invoice', document_date: '2026-08-01', total_net: 3069.18, total_gross: 3069.18 },
    { id: '2', doctype: 'invrec', document_date: '2026-08-01', total_net: 64420.22, total_gross: 64420.22 },
    { id: '3', doctype: 'deal', document_date: '2026-08-01', total_net: 44041.5, total_gross: 44041.5 },
    { id: '4', doctype: 'offer', document_date: '2026-08-01', total_net: 7000, total_gross: 7000 },
  ];
  const report = buildDashboard({ documents, from: '2026-08-01', to: '2026-08-31' });
  assert.equal(report.kpis.revenue_net, 67489.4);
  assert.equal(report.kpis.pipeline, 51041.5);
  assert.equal(documents.reduce((sum, row) => sum + row.total_gross, 0), 118530.9);
});

test('expense fingerprints prefer invoice number when available', () => {
  assert.match(expenseFingerprint({ supplier_name: 'ספק א', document_number: '123', amount_gross: 100 }), /^doc\|/);
  assert.match(expenseFingerprint({ supplier_name: 'ספק א', expense_date: '2026-08-01', amount_gross: 100 }), /^soft\|/);
});

test('same date and amount across sources is review, never silently counted twice', () => {
  const rows = reconcileExpenses([
    { id: 'i1', source: 'icount', expense_date: '2026-08-01', amount_gross: 100, supplier_name: '' },
    { id: 'n1', source: 'notion', expense_date: '2026-08-01', amount_gross: 100, supplier_name: 'ספק' },
  ]);
  assert.equal(rows[0].reconciliation_status, 'review');
  assert.equal(rows[0].matched_expense_id, 'i1');
});

test('directly entered expenses are included in reporting', () => {
  const rows = chooseExpenseRows([{ id: 'm1', source: 'manual', expense_date: '2026-08-09', amount_gross: 50 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'm1');
});
