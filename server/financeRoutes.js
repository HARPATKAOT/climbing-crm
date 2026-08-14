import crypto from 'crypto';
import express from 'express';
import { db, persistCore } from './db.js';
import { hasSensitiveAccess } from './userAccess.js';
import {
  buildDashboard,
  buildPaymentsReport,
  buildSalesBreakdown,
  chooseExpenseRows,
  classifyDocument,
  dateInRange,
  reconcileExpenses,
  roundFinance,
} from './finance.js';
import { financeSyncStatus, runFinanceSync } from './financeSync.js';
import { financeAutomationSummary, matchExpenseTransactions, parseFinanceCsv } from './financeAutomation.js';
import { requireCronSecret } from './security.js';

export const financeRouter = express.Router();

// Render invokes this without a CRM session. Keep it before the finance access
// middleware, but fail closed unless the dedicated header secret is present.
financeRouter.post('/sync-scheduled', requireCronSecret, async (_req, res) => {
  try {
    res.json(await runFinanceSync({ full: false, sources: ['notion', 'icount'] }));
  } catch (error) {
    res.status(502).json({ error: error.message || 'סנכרון הנתונים נכשל' });
  }
});

financeRouter.use((req, res, next) => {
  if (!hasSensitiveAccess(req.crmUser, 'finance')) {
    return res.status(403).json({ error: 'אין הרשאה לצפות בנתונים פיננסיים' });
  }
  return next();
});

const period = (req) => ({
  from: String(req.query.from || '2010-01-01').slice(0, 10),
  to: String(req.query.to || new Date().toISOString().slice(0, 10)).slice(0, 10),
});

const persistRow = async (table, row) => {
  const saved = db.getOne(table, row.id)
    ? db.update(table, row.id, row)
    : db.insert(table, row);
  const durable = await persistCore(table, saved);
  if (!durable?.ok) throw new Error(durable?.error || `שמירת ${table} נכשלה`);
  return saved;
};

function automationPayload() {
  const expenses = chooseExpenseRows(db.get('finance_expenses'));
  const transactions = db.get('finance_bank_transactions');
  const matches = db.get('finance_expense_matches');
  const deliveries = db.get('finance_accountant_deliveries');
  const matchByExpense = new Map(matches
    .filter((row) => row.status !== 'superseded')
    .map((row) => [String(row.expense_id), row]));
  const matchByTransaction = new Map(matches
    .filter((row) => row.status !== 'superseded')
    .map((row) => [String(row.transaction_id), row]));
  const deliveryByExpense = new Map(deliveries
    .filter((row) => row.status === 'sent')
    .map((row) => [String(row.expense_id), row]));
  return {
    summary: financeAutomationSummary(expenses, transactions, matches, deliveries),
    settings: db.get('finance_automation_settings')[0] || { id: 'default', auto_send: false },
    expenses: expenses.map((row) => ({
      ...row,
      match: matchByExpense.get(String(row.id)) || null,
      accountant_delivery: deliveryByExpense.get(String(row.id)) || null,
    })).sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || ''))),
    transactions: transactions.map((row) => ({
      ...row,
      match: matchByTransaction.get(String(row.id)) || null,
    })).sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || ''))),
  };
}

financeRouter.get('/dashboard', (req, res) => {
  const { from, to } = period(req);
  res.json(buildDashboard({
    documents: db.get('finance_documents'),
    expenses: db.get('finance_expenses'),
    payments: db.get('finance_payment_events'),
    from,
    to,
  }));
});

financeRouter.get('/transactions', (req, res) => {
  const { from, to } = period(req);
  const documents = db.get('finance_documents')
    .filter((row) => dateInRange(row.document_date, from, to))
    .map((row) => {
      const classification = classifyDocument(row.doctype, { isStorno: row.is_storno, total: row.total_gross });
      return {
        ...row,
        date: row.document_date,
        name: classification.bucket === 'pipeline' ? 'מסמך צבר' : 'מסמך הכנסה',
        document_number: row.docnum,
        transaction_kind: 'document',
        categories: [classification.bucket === 'pipeline' ? 'צבר עתידי' : 'הכנסה'],
        amount: roundFinance(Math.abs(Number(row.total_gross) || 0) * classification.sign),
      };
    });
  const expenses = chooseExpenseRows(db.get('finance_expenses'))
    .filter((row) => dateInRange(row.expense_date, from, to))
    .map((row) => ({
      ...row,
      date: row.expense_date,
      transaction_kind: 'expense',
      amount: roundFinance(row.amount_gross),
    }));
  const all = [...documents, ...expenses]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize) || 500));
  res.json({ rows: all.slice(0, pageSize), total: all.length });
});

financeRouter.get('/sales-breakdown', (req, res) => {
  const { from, to } = period(req);
  res.json(buildSalesBreakdown({
    documents: db.get('finance_documents'),
    lines: db.get('finance_document_lines'),
    paymentEvents: db.get('finance_payment_events'),
    payments: db.get('payments'),
    posSales: db.get('pos_sales'),
    registrations: db.get('activity_registrations'),
    activities: db.get('activities'),
    parents: db.get('parents'),
    from,
    to,
  }));
});

financeRouter.get('/payments', (req, res) => {
  const { from, to } = period(req);
  res.json(buildPaymentsReport({
    documents: db.get('finance_documents'),
    lines: db.get('finance_document_lines'),
    paymentEvents: db.get('finance_payment_events'),
    payments: db.get('payments'),
    posSales: db.get('pos_sales'),
    registrations: db.get('activity_registrations'),
    activities: db.get('activities'),
    parents: db.get('parents'),
    students: db.get('students'),
    customerPasses: db.get('customer_passes'),
    from,
    to,
  }));
});

financeRouter.get('/reconciliation', (_req, res) => {
  const expenses = db.get('finance_expenses');
  const rows = reconcileExpenses(expenses);
  res.json({
    rows,
    counts: {
      matched: rows.filter((row) => row.reconciliation_status === 'matched').length,
      review: rows.filter((row) => row.reconciliation_status === 'review').length,
      notion_only: rows.filter((row) => row.reconciliation_status === 'notion_only').length,
      missing_date: expenses.filter((row) => !row.expense_date).length,
      missing_amount: expenses.filter((row) => row.amount_gross == null).length,
    },
  });
});

financeRouter.get('/sync-status', (_req, res) => res.json(financeSyncStatus()));

financeRouter.post('/sync', async (req, res) => {
  try {
    const sources = Array.isArray(req.body?.sources) ? req.body.sources.filter((row) => ['notion', 'icount'].includes(row)) : ['icount'];
    res.json(await runFinanceSync({ full: req.body?.full === true, sources }));
  } catch (error) {
    res.status(502).json({ error: error.message || 'סנכרון הנתונים נכשל' });
  }
});

financeRouter.get('/automation', (_req, res) => res.json(automationPayload()));

financeRouter.post('/automation/run', async (_req, res) => {
  try {
    const proposed = matchExpenseTransactions(
      chooseExpenseRows(db.get('finance_expenses')),
      db.get('finance_bank_transactions')
    );
    for (const row of proposed) await persistRow('finance_expense_matches', row);
    res.json(automationPayload());
  } catch (error) {
    res.status(500).json({ error: error.message || 'התאמת התנועות נכשלה' });
  }
});

financeRouter.put('/automation/matches/:expenseId', async (req, res) => {
  try {
    const expenseId = String(req.params.expenseId);
    const transactionId = String(req.body?.transaction_id || '');
    const match = db.get('finance_expense_matches').find((row) => String(row.expense_id) === expenseId && String(row.transaction_id) === transactionId);
    if (!match) return res.status(404).json({ error: 'ההתאמה לא נמצאה' });
    await persistRow('finance_expense_matches', {
      ...match,
      status: 'matched',
      method: 'manual',
      matched_at: new Date().toISOString(),
      matched_by: req.crmUser?.email || null,
    });
    return res.json(automationPayload());
  } catch (error) {
    return res.status(500).json({ error: error.message || 'אישור ההתאמה נכשל' });
  }
});

financeRouter.put('/automation/settings', async (req, res) => {
  try {
    const saved = await persistRow('finance_automation_settings', {
      id: 'default',
      accountant_name: String(req.body?.accountant_name || '').trim(),
      accountant_phone: String(req.body?.accountant_phone || '').replace(/\D/g, ''),
      email_address: String(req.body?.email_address || '').trim(),
      email_provider: ['gmail', 'outlook'].includes(req.body?.email_provider) ? req.body.email_provider : '',
      auto_send: req.body?.auto_send === true,
      updated_at: new Date().toISOString(),
    });
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message || 'שמירת ההגדרות נכשלה' });
  }
});

financeRouter.post('/bank-transactions/import', async (req, res) => {
  try {
    const parsed = parseFinanceCsv(req.body?.csv, req.body || {});
    if (!parsed.rows.length) return res.status(400).json({ error: parsed.errors[0] || 'לא נמצאו תנועות לייבוא' });
    const existing = new Set(db.get('finance_bank_transactions').map((row) => String(row.id)));
    for (const row of parsed.rows.filter((item) => !existing.has(String(item.id)))) {
      await persistRow('finance_bank_transactions', { ...row, imported_by: req.crmUser?.email || null });
    }
    const proposed = matchExpenseTransactions(chooseExpenseRows(db.get('finance_expenses')), db.get('finance_bank_transactions'));
    for (const row of proposed) await persistRow('finance_expense_matches', row);
    res.json({ ...automationPayload(), import_errors: parsed.errors });
  } catch (error) {
    res.status(500).json({ error: error.message || 'ייבוא התנועות נכשל' });
  }
});

financeRouter.post('/expenses', async (req, res) => {
  try {
    const amountGross = Number(req.body?.amount_gross);
    if (!String(req.body?.name || '').trim() || !req.body?.expense_date || !(amountGross > 0)) {
      return res.status(400).json({ error: 'יש למלא תיאור, תאריך וסכום תקין' });
    }
    const includesVat = req.body?.includes_vat !== false;
    const amountNet = includesVat ? amountGross / 1.18 : amountGross;
    const row = await persistRow('finance_expenses', {
      id: `manual:${crypto.randomUUID()}`,
      source: 'manual',
      source_id: null,
      name: String(req.body.name).trim(),
      expense_date: String(req.body.expense_date).slice(0, 10),
      amount_gross: roundFinance(amountGross),
      amount_net: roundFinance(amountNet),
      vat_amount: roundFinance(amountGross - amountNet),
      currency: 'ILS',
      supplier_name: String(req.body.supplier_name || '').trim(),
      categories: Array.isArray(req.body.categories) ? req.body.categories.map(String).filter(Boolean) : [],
      document_number: String(req.body.document_number || '').trim(),
      payment_method: String(req.body.payment_method || ''),
      note: String(req.body.note || '').trim(),
      paid: req.body.paid !== false,
      attachment_metadata: [],
      created_by: req.crmUser?.email || null,
      created_at: new Date().toISOString(),
    });
    return res.status(201).json(row);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'שמירת ההוצאה נכשלה' });
  }
});

financeRouter.post('/expenses/:id/attachment', async (req, res) => {
  try {
    const expense = db.getOne('finance_expenses', req.params.id);
    if (!expense) return res.status(404).json({ error: 'ההוצאה לא נמצאה' });
    const data = String(req.body?.data || '');
    if (!/^data:(application\/pdf|image\/jpeg|image\/png);base64,/.test(data)) {
      return res.status(400).json({ error: 'אפשר לצרף PDF, JPG או PNG בלבד' });
    }
    if (data.length > 11_000_000) return res.status(413).json({ error: 'הקובץ גדול מדי; המגבלה היא 8MB' });
    const attachment = {
      id: crypto.randomUUID(),
      file_name: String(req.body?.file_name || 'חשבונית'),
      mime_type: String(req.body?.mime_type || '').slice(0, 100),
      data,
      uploaded_at: new Date().toISOString(),
      uploaded_by: req.crmUser?.email || null,
    };
    await persistRow('finance_expenses', {
      ...expense,
      attachment_metadata: [...(expense.attachment_metadata || []), attachment],
    });
    return res.json({ attachment: { ...attachment, data: undefined }, automation: automationPayload() });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'העלאת החשבונית נכשלה' });
  }
});

financeRouter.get('/expenses/:id/attachments/:attachmentId/download', (req, res) => {
  const expense = db.getOne('finance_expenses', req.params.id);
  const attachment = expense?.attachment_metadata?.find((row) => String(row.id) === String(req.params.attachmentId));
  if (!attachment?.data) return res.status(404).json({ error: 'הקובץ לא נמצא' });
  const match = attachment.data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(500).json({ error: 'הקובץ השמור אינו תקין' });
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.file_name || 'invoice')}`);
  return res.send(Buffer.from(match[2], 'base64'));
});

financeRouter.post('/expenses/:id/send-accountant', (_req, res) => {
  res.status(501).json({ error: 'שליחה לרואה החשבון עדיין לא חוברה ל־WhatsApp. ניתן להוריד את הקובץ ולשלוח ידנית.' });
});

financeRouter.get('/export.csv', (req, res) => {
  const { from, to } = period(req);
  const report = buildSalesBreakdown({
    documents: db.get('finance_documents'),
    lines: db.get('finance_document_lines'),
    paymentEvents: db.get('finance_payment_events'),
    payments: db.get('payments'),
    posSales: db.get('pos_sales'),
    registrations: db.get('activity_registrations'),
    activities: db.get('activities'),
    parents: db.get('parents'),
    from,
    to,
  });
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['תאריך', 'מספר מסמך', 'לקוח', 'סכום', 'אירוע', 'מוצרים', 'אמצעי תשלום'];
  const rows = report.deals.map((row) => [row.date, row.document_number, row.customer_name, row.amount, row.events.join(' | '), row.products.join(' | '), row.payment_methods.join(' | ')]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="finance-${from}-${to}.csv"`);
  res.send(`\uFEFF${[header, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`);
});

financeRouter.get('/payments/export.csv', (req, res) => {
  const { from, to } = period(req);
  const report = buildPaymentsReport({
    documents: db.get('finance_documents'),
    lines: db.get('finance_document_lines'),
    paymentEvents: db.get('finance_payment_events'),
    payments: db.get('payments'),
    posSales: db.get('pos_sales'),
    registrations: db.get('activity_registrations'),
    activities: db.get('activities'),
    parents: db.get('parents'),
    students: db.get('students'),
    customerPasses: db.get('customer_passes'),
    from,
    to,
  });
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = [
    'תאריך', 'לקוח', 'תיאור', 'מוצרים', 'אירועים', 'מקור', 'אמצעי תשלום', 'סטטוס',
    'סכום דרישה', 'נגבה', 'פתוח', 'זוכה', 'נטו', 'מספר מסמך', 'עובד',
  ];
  const rows = report.rows.map((row) => [
    row.date,
    row.customer_name,
    row.description,
    row.product_names.join(' | '),
    row.activities.join(' | '),
    row.source,
    row.payment_method_label,
    row.status,
    row.amount,
    row.gross_collected,
    row.open_amount,
    row.refund_amount,
    row.net_amount,
    row.document_number,
    row.sold_by,
  ]);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payments-${from}-${to}.csv"`);
  res.send(`\uFEFF${[header, ...rows].map((row) => row.map(escape).join(',')).join('\n')}`);
});
