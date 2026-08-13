import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, buildSalesBreakdown, chooseExpenseRows, classifyDocument, expenseFingerprint, reconcileExpenses } from './finance.js';

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

test('sales breakdown links accounting documents to events and products without fuzzy matching', () => {
  const report = buildSalesBreakdown({
    from: '2026-08-01',
    to: '2026-08-31',
    documents: [{ id: 'icount:invrec:42', doctype: 'invrec', docnum: '42', document_date: '2026-08-13', total_gross: 300, client_id: 'c1', client_name: 'משפחה' }],
    lines: [{ document_id: 'icount:invrec:42', item_id: 'p1', description: 'מחנה טיפוס', quantity: 2, line_gross: 300 }],
    paymentEvents: [{ document_id: 'icount:invrec:42', method: 'credit_card', amount: 300 }],
    payments: [{ id: 'pay1', icount_doc_number: '42' }],
    registrations: [{ payment_id: 'pay1', activity_id: 'event1' }],
    activities: [{ id: 'event1', name: 'מחנה קיץ', date: '2026-08-20', type: 'camp' }],
  });
  assert.equal(report.summary.deals, 1);
  assert.equal(report.daily[0].date, '2026-08-13');
  assert.equal(report.events[0].name, 'מחנה קיץ');
  assert.equal(report.products[0].name, 'מחנה טיפוס');
  assert.equal(report.payment_methods[0].method, 'אשראי');
});

test('sales breakdown shows a paid CRM payment before its accounting sync arrives', () => {
  const report = buildSalesBreakdown({
    from: '2026-08-13',
    to: '2026-08-13',
    documents: [],
    payments: [{
      id: 'pay-today',
      status: 'paid',
      amount: 3900,
      paid_at: '2026-08-13T09:13:43.851Z',
      parent_id: 'parent1',
      activity_id: 'event1',
      description: 'הרשמה למחנה',
      cc_confirmation_code: 'confirmed',
    }],
    activities: [{ id: 'event1', name: 'מחנה קיץ', date: '2026-08-20', type: 'camp' }],
    parents: [{ id: 'parent1', name: 'משפחת ישראלי' }],
  });

  assert.equal(report.summary.deals, 1);
  assert.equal(report.summary.revenue, 3900);
  assert.equal(report.daily[0].date, '2026-08-13');
  assert.equal(report.events[0].name, 'מחנה קיץ');
  assert.equal(report.products[0].name, 'הרשמה למחנה');
  assert.equal(report.payment_methods[0].method, 'אשראי אונליין');
  assert.equal(report.deals[0].customer_name, 'משפחת ישראלי');
});
