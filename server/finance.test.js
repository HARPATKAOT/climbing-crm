import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboard, buildPaymentsReport, buildSalesBreakdown, chooseExpenseRows, classifyDocument, expenseFingerprint, reconcileExpenses } from './finance.js';

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

test('sales breakdown counts a duplicated accounting document only once', () => {
  const report = buildSalesBreakdown({
    from: '2026-08-13',
    to: '2026-08-13',
    documents: [
      { id: 'sync-a', doctype: 'invrec', docnum: '4152', document_date: '2026-08-13', total_gross: 35, client_name: 'נועה' },
      { id: 'sync-b', doctype: 'invrec', docnum: '4152', document_date: '2026-08-13', total_gross: 35, client_name: 'נועה', source_url: 'https://example.test/doc' },
    ],
    lines: [{ document_id: 'sync-b', description: 'כניסה לקיר', quantity: 1, line_gross: 35 }],
  });

  assert.equal(report.summary.deals, 1);
  assert.equal(report.summary.revenue, 35);
  assert.equal(report.deals[0].source_url, 'https://example.test/doc');
});

test('payments report combines open operational payments with accounting-only history', () => {
  const report = buildPaymentsReport({
    from: '2026-08-01',
    to: '2026-08-31',
    payments: [{
      id: 'pay-open',
      parent_id: 'parent-1',
      amount: 180,
      description: 'כניסה לקיר, נעליים',
      status: 'pending',
      payment_url: 'https://pay.test/open',
      created_at: '2026-08-13T15:00:00.000Z',
    }],
    parents: [{ id: 'parent-1', name: 'דנה צפוני', phone: '0500000000', icount_client_id: 'ic-1' }],
    documents: [{
      id: 'doc-1', doctype: 'invrec', docnum: '4000', document_date: '2026-08-12',
      total_gross: 35, client_id: 'ic-2', client_name: 'נועה', source_url: 'https://doc.test/4000',
    }],
    lines: [{ document_id: 'doc-1', description: 'כניסה לקיר', quantity: 1, line_gross: 35 }],
    paymentEvents: [{ document_id: 'doc-1', method: 'cash', amount: 35 }],
  });

  assert.equal(report.rows.length, 2);
  assert.equal(report.summary.open_count, 1);
  assert.equal(report.summary.open_amount, 180);
  assert.equal(report.summary.gross_collected, 35);
  assert.equal(report.rows.find((row) => row.payment_id === 'pay-open').customer_name, 'דנה צפוני');
  assert.equal(report.rows.find((row) => row.accounting_only).payment_method_label, 'מזומן');
});

test('payments report excludes optional open links but keeps real POS debts', () => {
  const report = buildPaymentsReport({
    from: '2026-08-13',
    to: '2026-08-13',
    payments: [
      {
        id: 'equipment-option', parent_id: 'p1', amount: 140, status: 'pending',
        description: 'ציוד טיפוס', equipment_payment: true, created_at: '2026-08-13T08:00:00.000Z',
      },
      {
        id: 'quote-option', parent_id: 'p1', amount: 400, status: 'pending',
        description: 'הצעת מחיר', pos_sale_id: 'quote-sale', created_at: '2026-08-13T09:00:00.000Z',
      },
      {
        id: 'wall-debt', parent_id: 'p2', amount: 180, status: 'pending',
        description: 'כניסה לקיר', pos_sale_id: 'wall-sale', created_at: '2026-08-13T10:00:00.000Z',
      },
      {
        id: 'harness-offer', parent_id: 'p1', amount: 350, status: 'pending',
        description: 'רתמת טיפוס', pos_sale_id: 'harness-sale', created_at: '2026-08-13T11:00:00.000Z',
      },
    ],
    posSales: [
      { id: 'quote-sale', parent_id: 'p1', total: 400, status: 'quoted' },
      { id: 'wall-sale', parent_id: 'p2', total: 180, status: 'pending_payment', payment_method: 'online', source: 'pos_debt' },
      { id: 'harness-sale', parent_id: 'p1', total: 350, status: 'pending_payment', payment_method: 'online', source: 'pos_offer' },
    ],
    parents: [{ id: 'p1', name: 'תהל' }, { id: 'p2', name: 'דנה' }],
  });

  assert.deepEqual(report.rows.map((row) => row.payment_id), ['wall-debt']);
  assert.equal(report.summary.open_count, 1);
  assert.equal(report.summary.open_amount, 180);
  assert.equal(report.rows[0].debt_reason, 'חוב שסומן בקופה');
});

test('payments report finds an unpaid hosted event before the host opens its payment page', () => {
  const report = buildPaymentsReport({
    from: '2026-08-01',
    to: '2026-08-31',
    activities: [{
      id: 'camp-event',
      name: 'קייטנה של מרכז גל',
      date: '2026-08-13',
      status: 'open',
      registration_mode: 'host_pays',
      payment_status: 'unpaid',
      host_parent_id: 'host-1',
      host_charge_amount: 675,
    }],
    parents: [{ id: 'host-1', name: 'גל חן', phone: '0500000000' }],
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].id, 'activity-debt:camp-event');
  assert.equal(report.rows[0].customer_name, 'גל חן');
  assert.equal(report.rows[0].open_amount, 675);
  assert.equal(report.summary.open_amount, 675);
});

test('payments report excludes a pending registration that only becomes confirmed after payment', () => {
  const report = buildPaymentsReport({
    from: '2026-08-13',
    to: '2026-08-13',
    payments: [{
      id: 'registration-option', amount: 220, status: 'pending', activity_id: 'event-1',
      activity_registration_order_id: 'order-1', created_at: '2026-08-13T10:00:00.000Z',
    }],
    registrations: [{
      id: 'reg-1', activity_id: 'event-1', payment_id: 'registration-option', status: 'pending_payment',
    }],
    activities: [{ id: 'event-1', name: 'פעילות פתוחה', date: '2026-08-20' }],
  });

  assert.equal(report.rows.length, 0);
  assert.equal(report.summary.open_count, 0);
  assert.equal(report.summary.open_amount, 0);
});

test('payments report never duplicates a linked iCount receipt', () => {
  const report = buildPaymentsReport({
    from: '2026-08-13',
    to: '2026-08-13',
    payments: [{
      id: 'pay-1', status: 'paid', amount: 105, icount_doc_number: '4153',
      paid_at: '2026-08-13T18:02:35.000Z', parent_id: 'p1', description: 'כניסה לקיר',
    }],
    parents: [{ id: 'p1', name: 'טל צברי' }],
    documents: [
      { id: 'doc-a', doctype: 'invrec', docnum: '4153', document_date: '2026-08-13', total_gross: 105, client_name: 'טל צברי' },
      { id: 'doc-b', doctype: 'invrec', docnum: '4153', document_date: '2026-08-13', total_gross: 105, client_name: 'טל צברי', source_url: 'https://doc.test/4153' },
    ],
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.summary.gross_collected, 105);
  assert.equal(report.rows[0].document_url, 'https://doc.test/4153');
});

test('payments report shows accounting credits as refunds instead of revenue', () => {
  const report = buildPaymentsReport({
    from: '2026-08-01',
    to: '2026-08-31',
    documents: [{
      id: 'credit-1', doctype: 'refund', docnum: 'R100', document_date: '2026-08-13',
      total_gross: 80, client_id: 'c1', client_name: 'לקוח מזוכה',
    }],
  });

  assert.equal(report.summary.gross_collected, 0);
  assert.equal(report.summary.refunds, 80);
  assert.equal(report.summary.net_collected, -80);
  assert.equal(report.rows[0].status, 'refunded');
});

test('payments report never counts a linked refund document twice', () => {
  const report = buildPaymentsReport({
    from: '2026-08-01',
    to: '2026-08-31',
    payments: [{
      id: 'pay-refunded', status: 'refunded', amount: 80, refund_amount: 80,
      icount_doc_number: '4100', refund_doc_number: 'R4100',
      paid_at: '2026-08-10T10:00:00.000Z', refunded_at: '2026-08-13T10:00:00.000Z',
    }],
    documents: [
      { id: 'charge-4100', doctype: 'invrec', docnum: '4100', document_date: '2026-08-10', total_gross: 80 },
      { id: 'credit-4100', doctype: 'refund', docnum: 'R4100', document_date: '2026-08-13', total_gross: 80 },
    ],
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.summary.gross_collected, 80);
  assert.equal(report.summary.refunds, 80);
  assert.equal(report.summary.net_collected, 0);
  assert.equal(report.rows[0].refund_document_number, 'R4100');
});

test('payments report merges a generic webhook payment with its POS payment', () => {
  const report = buildPaymentsReport({
    from: '2026-08-13',
    to: '2026-08-13',
    payments: [
      {
        id: 'generic-payment', parent_id: 'p1', amount: 35, status: 'paid',
        description: 'תשלום iCount', icount_doc_number: '4152', paid_at: '2026-08-13T14:37:00.000Z',
      },
      {
        id: 'pos-payment', parent_id: 'p1', amount: 35, status: 'paid',
        description: 'כניסה לקיר', pos_sale_id: 'sale-1', paid_at: '2026-08-13T14:37:02.000Z',
      },
    ],
    posSales: [{
      id: 'sale-1', parent_id: 'p1', total: 35, status: 'paid', payment_method: 'cash',
      icount_doc_number: '4152', items: [{ name: 'כניסה לקיר', quantity: 1, unitprice: 35 }],
    }],
    parents: [{ id: 'p1', name: 'נועה כידן' }],
    documents: [{ id: 'doc-4152', doctype: 'invrec', docnum: '4152', document_date: '2026-08-13', total_gross: 35 }],
  });

  assert.equal(report.rows.length, 1);
  assert.equal(report.summary.gross_collected, 35);
  assert.equal(report.rows[0].payment_id, 'pos-payment');
  assert.equal(report.rows[0].description, 'כניסה לקיר');
  assert.deepEqual(report.rows[0].product_names, ['כניסה לקיר']);
});

// ─── חוב פתוח = מלאי: מוצג תמיד, בלי קשר לטווח (תיקון "החוב שנעלם") ─────────

test('an open payment debt outside the window is still shown, but not counted as collection', () => {
  const report = buildPaymentsReport({
    payments: [
      { id: 'p-old', status: 'pending', amount: 200, created_at: '2026-07-13T10:00:00Z' },
      { id: 'p-paid-old', status: 'paid', amount: 300, paid_at: '2026-07-01T10:00:00Z' },
    ],
    from: '2026-08-12',
    to: '2026-08-16',
  });
  const debt = report.rows.find((row) => row.id === 'payment:p-old');
  assert.ok(debt, 'חוב פתוח מחוץ לטווח חייב להופיע');
  assert.equal(debt.in_period, false);
  assert.equal(report.summary.open_amount, 200);
  // תשלום ששולם מחוץ לטווח נשאר בחוץ, והגבייה בתקופה אפס
  assert.ok(!report.rows.some((row) => row.id === 'payment:p-paid-old'));
  assert.equal(report.summary.gross_collected, 0);
});

test('the vanished-debt scenario: host event in the future, filter on this week', () => {
  const report = buildPaymentsReport({
    activities: [{
      id: 'act-9', name: 'יום הולדת דנה', registration_mode: 'host_pays', status: 'confirmed',
      payment_status: 'unpaid', host_name: 'דנה צפוני', date: '2026-09-20',
      host_charge_amount: 850, created_at: '2026-08-13T09:00:00Z',
    }],
    from: '2026-08-12',
    to: '2026-08-16',
  });
  const debt = report.rows.find((row) => row.id === 'activity-debt:act-9');
  assert.ok(debt, 'חוב אירוע עתידי חייב להופיע גם בסינון של השבוע');
  assert.equal(debt.open_amount, 850);
  assert.equal(debt.in_period, false);
  assert.equal(report.summary.open_amount, 850);
});

test('a host activity whose payment exists outside the window yields one row, not two', () => {
  const report = buildPaymentsReport({
    payments: [{
      id: 'p-host', status: 'pending', amount: 850, created_at: '2026-07-20T10:00:00Z',
      activity_host_payment: true, activity_id: 'act-9',
    }],
    activities: [{
      id: 'act-9', name: 'אירוע', registration_mode: 'host_pays', status: 'confirmed',
      payment_status: 'unpaid', host_name: 'מזמין', date: '2026-09-20',
      host_payment_id: 'p-host', host_charge_amount: 850,
    }],
    from: '2026-08-12',
    to: '2026-08-16',
  });
  const debtRows = report.rows.filter((row) => row.open_amount > 0);
  assert.equal(debtRows.length, 1, 'שורה אחת לחוב — לא תשלום + שורה סינתטית');
  assert.equal(debtRows[0].id, 'payment:p-host');
});

test('an unpaid iCount invoice becomes an open debt with only the paid part collected', () => {
  const doc = {
    id: 'icount:invoice:501', doctype: 'invoice', docnum: '501', document_date: '2026-08-13',
    total_gross: 500, total_net: 423.73, remaining_sum: 200, client_name: 'דנה צפוני',
  };
  const inRange = buildPaymentsReport({ documents: [doc], from: '2026-08-12', to: '2026-08-16' });
  const row = inRange.rows.find((item) => item.document_number === '501');
  assert.equal(row.status, 'open');
  assert.equal(row.is_debt, true);
  assert.equal(row.gross_collected, 300);
  assert.equal(row.open_amount, 200);
  // גם מחוץ לטווח — החוב נשאר, הגבייה לא נספרת
  const outOfRange = buildPaymentsReport({ documents: [doc], from: '2026-01-01', to: '2026-01-31' });
  const stillThere = outOfRange.rows.find((item) => item.document_number === '501');
  assert.ok(stillThere);
  assert.equal(outOfRange.summary.open_amount, 200);
  assert.equal(outOfRange.summary.gross_collected, 0);
});

test('regression: fully paid rows outside the window stay hidden', () => {
  const report = buildPaymentsReport({
    documents: [{
      id: 'icount:invrec:600', doctype: 'invrec', docnum: '600', document_date: '2026-07-01',
      total_gross: 400, total_net: 338.98, remaining_sum: 0,
    }],
    payments: [{ id: 'p-done', status: 'paid', amount: 150, paid_at: '2026-07-02T10:00:00Z' }],
    from: '2026-08-12',
    to: '2026-08-16',
  });
  assert.equal(report.rows.length, 0);
});
