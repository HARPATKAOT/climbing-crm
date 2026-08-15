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
import { FINANCE_FLAGS, financeFlag, financeId } from './financeCore.js';
import { PROVIDER_CATALOG, credentialsFromEnv, fromCsvRows } from './bankProviders.js';
import { ingestRawTransactions } from './bankIngestion.js';
import { durableRecordingStore, runBankSync } from './bankSync.js';
import { runFinanceNightly } from './financeNightly.js';
import { reviveOutboxRow } from './icountOutbox.js';
import { ingestDocumentFile } from './documentIngestion.js';
import { createGmailProvider, gmailConfigured, runEmailIngestion } from './emailIngestion.js';

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

// משיכת בנק/אשראי לילית. no-op בטוח כשהדגל כבוי.
financeRouter.post('/bank-sync-scheduled', requireCronSecret, async (_req, res) => {
  try {
    res.json(await runBankSync());
  } catch (error) {
    res.status(502).json({ error: error.message || 'משיכת תנועות הבנק נכשלה' });
  }
});

// הג'וב הלילי: outbox, יישוב מול iCount, ledger ותחזית (כל חלק לפי דגל).
financeRouter.post('/nightly-scheduled', requireCronSecret, async (_req, res) => {
  try {
    res.json(await runFinanceNightly());
  } catch (error) {
    res.status(502).json({ error: error.message || 'הריצה הלילית נכשלה' });
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

// ─── מרכז פיננסי: חשבונות, משיכה, תיבת נכנס (FINANCE_SPEC שלבים 1, 5.4) ────

financeRouter.get('/flags', (_req, res) => {
  res.json(Object.fromEntries(FINANCE_FLAGS.map((name) => [name, financeFlag(name)])));
});

financeRouter.get('/accounts', (_req, res) => {
  const accounts = db.get('financial_accounts').map((account) => ({
    ...account,
    // שמות השדות הנדרשים + האם env מכיל אותם. ערכים לעולם לא נשלחים.
    provider: PROVIDER_CATALOG[account.institution]
      ? {
        label: PROVIDER_CATALOG[account.institution].label,
        credential_fields: PROVIDER_CATALOG[account.institution].credentialFields,
        credentials_configured: Boolean(credentialsFromEnv(account.institution)),
      }
      : null,
  }));
  res.json({ accounts, catalog: Object.fromEntries(Object.entries(PROVIDER_CATALOG)
    .map(([key, spec]) => [key, { label: spec.label, account_type: spec.accountType, credential_fields: spec.credentialFields }])) });
});

financeRouter.post('/accounts', async (req, res) => {
  try {
    const type = String(req.body?.type || '');
    if (!['bank', 'credit_card', 'cash', 'clearing'].includes(type)) {
      return res.status(400).json({ error: 'סוג חשבון לא תקין' });
    }
    const row = await persistRow('financial_accounts', {
      id: financeId('acc'),
      type,
      institution: String(req.body?.institution || '').trim(),
      display_name: String(req.body?.display_name || '').trim(),
      last4: String(req.body?.last4 || '').replace(/\D/g, '').slice(-4) || null,
      currency: 'ILS',
      is_active: true,
      created_by: req.crmUser?.email || null,
    });
    return res.status(201).json(row);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'שמירת החשבון נכשלה' });
  }
});

financeRouter.post('/bank-sync', async (_req, res) => {
  try {
    res.json(await runBankSync());
  } catch (error) {
    res.status(502).json({ error: error.message || 'משיכת תנועות הבנק נכשלה' });
  }
});

// פאנל בריאות הסנכרון (FINANCE_SPEC 4.3.9): מה רץ, מה תקוע, ואיפה הפערים.
financeRouter.get('/health', (_req, res) => {
  const outbox = db.get('icount_outbox');
  const outboxCounts = { pending: 0, sent: 0, failed: 0, dead: 0 };
  for (const row of outbox) outboxCounts[row.status] = (outboxCounts[row.status] || 0) + 1;
  const inboxOpen = db.get('finance_inbox_items').filter((row) => row.status === 'open');
  const inboxCounts = {};
  for (const item of inboxOpen) inboxCounts[item.item_type] = (inboxCounts[item.item_type] || 0) + 1;
  const reconciliation = db.get('finance_reconciliation_items')
    .filter((row) => row.month)
    .sort((a, b) => String(b.month).localeCompare(String(a.month)))
    .slice(0, 6);
  res.json({
    sync: financeSyncStatus(),
    bank: db.getOne('finance_center_settings', 'bank_sync_status') || null,
    nightly: db.getOne('finance_center_settings', 'nightly_status') || null,
    outbox: { counts: outboxCounts, dead: outbox.filter((row) => row.status === 'dead') },
    inbox: { open: inboxOpen.length, counts: inboxCounts },
    reconciliation,
  });
});

financeRouter.get('/outbox', (req, res) => {
  const wanted = String(req.query.status || 'all');
  const rows = db.get('icount_outbox')
    .filter((row) => wanted === 'all' || row.status === wanted)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 200);
  res.json({ rows });
});

financeRouter.post('/outbox/:id/retry', async (req, res) => {
  try {
    const store = durableRecordingStore();
    const row = reviveOutboxRow(store, req.params.id);
    await store.flush();
    res.json(row);
  } catch (error) {
    res.status(400).json({ error: error.message || 'החייאת האירוע נכשלה' });
  }
});

// ─── קליטת מסמכים: pipeline אחד להעלאה, מייל וצילום (שלב 2) ────────────────

financeRouter.post('/documents/upload', async (req, res) => {
  try {
    if (!financeFlag('doc_ingestion')) return res.status(409).json({ error: 'קליטת מסמכים כבויה (דגל doc_ingestion)' });
    const raw = String(req.body?.data || '');
    const match = raw.match(/^data:(application\/pdf|image\/jpeg|image\/png);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'אפשר לצרף PDF, JPG או PNG בלבד' });
    if (raw.length > 11_000_000) return res.status(413).json({ error: 'הקובץ גדול מדי; המגבלה היא 8MB' });
    const store = durableRecordingStore();
    const result = ingestDocumentFile(store, {
      fileName: String(req.body?.file_name || 'מסמך'),
      mimeType: match[1],
      base64Data: match[2],
      source: req.body?.source === 'mobile' ? 'mobile' : 'upload',
      uploadedBy: req.crmUser?.email || null,
    });
    await store.flush();
    return res.status(result.created ? 201 : 200).json({
      document: { ...result.document, data: undefined },
      created: result.created,
      merged_with: result.merged_with,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'קליטת המסמך נכשלה' });
  }
});

financeRouter.get('/documents', (req, res) => {
  const wanted = String(req.query.status || 'all');
  const rows = db.get('finance_ingested_documents')
    .filter((row) => wanted === 'all' || row.status === wanted)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 500)
    .map((row) => ({ ...row, data: undefined, has_file: Boolean(row.data) }));
  res.json({ rows, total: db.get('finance_ingested_documents').length });
});

financeRouter.get('/documents/:id/download', (req, res) => {
  const row = db.getOne('finance_ingested_documents', req.params.id);
  const match = String(row?.data || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return res.status(404).json({ error: 'הקובץ לא נמצא' });
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name || 'invoice')}`);
  return res.send(Buffer.from(match[2], 'base64'));
});

financeRouter.post('/email-sync', async (_req, res) => {
  try {
    if (!gmailConfigured()) {
      return res.status(409).json({ error: 'תיבת המייל עדיין לא מחוברת — נדרשים מפתחות Google (חסם B2 ב-PROGRESS.md)' });
    }
    const store = durableRecordingStore();
    const summary = await runEmailIngestion(store, { provider: createGmailProvider() });
    await store.flush();
    res.json(summary);
  } catch (error) {
    res.status(502).json({ error: error.message || 'קליטת המייל נכשלה' });
  }
});

financeRouter.get('/inbox', (req, res) => {
  const wanted = String(req.query.status || 'open');
  const items = db.get('finance_inbox_items')
    .filter((row) => wanted === 'all' || row.status === wanted)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const counts = {};
  for (const item of items) counts[item.item_type] = (counts[item.item_type] || 0) + 1;
  res.json({ items, counts, total: items.length });
});

financeRouter.put('/inbox/:id', async (req, res) => {
  try {
    const item = db.getOne('finance_inbox_items', req.params.id);
    if (!item) return res.status(404).json({ error: 'הפריט לא נמצא' });
    const status = String(req.body?.status || '');
    if (!['resolved', 'dismissed', 'open'].includes(status)) {
      return res.status(400).json({ error: 'סטטוס לא תקין' });
    }
    const saved = await persistRow('finance_inbox_items', {
      ...item,
      status,
      resolved_by: status === 'open' ? null : (req.crmUser?.email || null),
      resolved_at: status === 'open' ? null : new Date().toISOString(),
    });
    return res.json(saved);
  } catch (error) {
    return res.status(500).json({ error: error.message || 'עדכון הפריט נכשל' });
  }
});

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

    // אותו קובץ מזין גם את המרכז הפיננסי החדש — pipeline אחד, לא שניים.
    // ה-dedupe_hash מגן מפני ייבוא כפול, אז אפשר להזרים את כל השורות.
    let financeCenter = null;
    if (financeFlag('bank_ingestion')) {
      const accountType = req.body?.account_type === 'bank' ? 'bank' : 'credit_card';
      const last4 = String(req.body?.account_last4 || '').replace(/\D/g, '').slice(-4) || null;
      let account = db.get('financial_accounts').find((row) =>
        row.type === accountType && String(row.last4 || '') === String(last4 || '') && row.institution === 'csv');
      if (!account) {
        account = await persistRow('financial_accounts', {
          id: financeId('acc'),
          type: accountType,
          institution: 'csv',
          display_name: `ייבוא קובץ ${accountType === 'bank' ? 'בנק' : 'אשראי'}${last4 ? ` ${last4}` : ''}`,
          last4,
          currency: 'ILS',
          is_active: true,
        });
      }
      const store = durableRecordingStore();
      financeCenter = ingestRawTransactions(store, { account, rawTxns: fromCsvRows(parsed.rows) });
      await store.flush();
    }
    res.json({ ...automationPayload(), import_errors: parsed.errors, finance_center: financeCenter });
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
