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
import { runFinanceNightly, runFinanceNightlyIfDue } from './financeNightly.js';
import { reviveOutboxRow } from './icountOutbox.js';
import { ingestDocumentFile } from './documentIngestion.js';
import { createGmailProvider, gmailConfigured, runEmailIngestion } from './emailIngestion.js';
import {
  learnAlias,
  matchableDocuments,
  proposeMatches,
  unmatchedExpenseSummary,
} from './matchingEngine.js';
import { applyRules, learnRule, seedCategories, vatSummary } from './financeCategories.js';
import { buildExpenseCenter, filterExpenseRows } from './financeExpenseCenter.js';
import { tagUntaggedExpenses } from './financeAiTagging.js';
import { sendEmail, isEmailConfigured } from './email.js';
import {
  MAX_EMAIL_BYTES,
  bundleEmailBody,
  bundleForEmail,
  deliveryRow,
  expenseAttachments,
  expenseSummaryLine,
} from './accountantDelivery.js';
import {
  classProfitability,
  costByKey,
  effectiveCostPerHour,
  employerCostFactor,
  instructorProfitability,
  laborCostRows,
} from './payrollCost.js';
import { monthlySeries, plStatement, rebuildLedger } from './financeLedger.js';
import { cashFlowTimeline, rebuildCashFlowForecast } from './financeCashFlow.js';

export const financeRouter = express.Router();

// Render invokes this without a CRM session. Keep it before the finance access
// middleware, but fail closed unless the dedicated header secret is present.
financeRouter.post('/sync-scheduled', requireCronSecret, async (_req, res) => {
  try {
    // רשת ביטחון: אם ה-cron הלילי הייעודי לא קיים, הריצה הלילית נתפסת כאן —
    // ברקע, בלי לעכב את הסנכרון עצמו, לכל היותר פעם ביום.
    runFinanceNightlyIfDue().catch((error) =>
      console.error('finance nightly (piggyback) failed:', error?.message || error));
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
  // תקרת שורות כמו ב-/transactions — אבל חוב פתוח תמיד עובר אותה, שלא
  // ניצור שוב "חוב בלתי נראה". summary והפילטרים נשארים על מלוא הנתונים.
  const pageSize = Math.min(2000, Math.max(1, Number(req.query.pageSize) || 500));
  const rows = report.rows.filter((row, index) =>
    index < pageSize || (row.is_debt && ['pending', 'open', 'quoted'].includes(row.status)));
  res.json({ ...report, rows, total: report.rows.length });
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

// ─── מנוע ההתאמה רבים-לרבים + מסך ההתאמה (שלב 3) ───────────────────────────

function matchingContext() {
  return {
    transactions: db.get('finance_transactions'),
    documents: matchableDocuments({
      expenses: chooseExpenseRows(db.get('finance_expenses')),
      ingested: db.get('finance_ingested_documents'),
      suppliers: db.get('finance_suppliers'),
    }),
    existingMatches: db.get('finance_matches'),
  };
}

function matchingState() {
  const { transactions, documents, existingMatches } = matchingContext();
  const allocated = new Map();
  for (const match of existingMatches.filter((row) => ['proposed', 'confirmed'].includes(row.status))) {
    allocated.set(String(match.document_id), (allocated.get(String(match.document_id)) || 0) + Math.abs(match.allocated_agorot || 0));
  }
  return {
    transactions: transactions
      .filter((row) => row.status !== 'voided')
      .sort((a, b) => String(b.booking_date).localeCompare(String(a.booking_date)))
      .slice(0, 500),
    documents: documents
      .map((doc) => ({ ...doc, remaining_agorot: Math.max(0, doc.gross_agorot - (allocated.get(String(doc.id)) || 0)) }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 500),
    matches: existingMatches
      .filter((row) => row.status !== 'superseded')
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    unmatched: unmatchedExpenseSummary({ transactions, matches: existingMatches }),
  };
}

financeRouter.post('/matching/run', async (_req, res) => {
  try {
    if (!financeFlag('matching_v2')) return res.status(409).json({ error: 'מנוע ההתאמה כבוי (דגל matching_v2)' });
    const proposals = proposeMatches(matchingContext());
    const store = durableRecordingStore();
    for (const proposal of proposals) store.insert('finance_matches', proposal);
    await store.flush();
    res.json({ proposed: proposals.filter((row) => row.status === 'proposed').length,
      auto_confirmed: proposals.filter((row) => row.status === 'confirmed').length,
      state: matchingState() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'הרצת ההתאמה נכשלה' });
  }
});

financeRouter.get('/matching/state', (_req, res) => res.json(matchingState()));

async function decideMatch(req, res, status) {
  const match = db.getOne('finance_matches', req.params.id);
  if (!match) return res.status(404).json({ error: 'ההתאמה לא נמצאה' });
  const store = durableRecordingStore();
  store.update('finance_matches', match.id, {
    ...match,
    status,
    method: 'manual',
    matched_by: req.crmUser?.email || null,
    matched_at: new Date().toISOString(),
  });
  // אישור ידני מלמד alias — הפיצ'ר שהופך את המערכת לחכמה עם הזמן (5.2).
  if (status === 'confirmed') {
    const transaction = db.getOne('finance_transactions', match.transaction_id);
    const document = matchingContext().documents.find((doc) => String(doc.id) === String(match.document_id));
    const supplier = document?.supplier_id ? db.getOne('finance_suppliers', document.supplier_id) : null;
    if (supplier && transaction?.merchant_raw) {
      const { supplier: updated, learned } = learnAlias(supplier, transaction.merchant_raw);
      if (learned) store.update('finance_suppliers', supplier.id, updated);
    }
  }
  await store.flush();
  return res.json({ ok: true, state: matchingState() });
}

financeRouter.post('/matching/:id/confirm', (req, res) => decideMatch(req, res, 'confirmed')
  .catch((error) => res.status(500).json({ error: error.message })));
financeRouter.post('/matching/:id/reject', (req, res) => decideMatch(req, res, 'rejected')
  .catch((error) => res.status(500).json({ error: error.message })));

financeRouter.post('/matching/confirm-batch', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const store = durableRecordingStore();
    let confirmed = 0;
    for (const id of ids) {
      const match = db.getOne('finance_matches', id);
      if (!match || match.status !== 'proposed') continue;
      store.update('finance_matches', id, {
        ...match, status: 'confirmed', method: 'manual',
        matched_by: req.crmUser?.email || null, matched_at: new Date().toISOString(),
      });
      confirmed += 1;
    }
    await store.flush();
    res.json({ confirmed, state: matchingState() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'אישור ההתאמות נכשל' });
  }
});

financeRouter.post('/matching/manual', async (req, res) => {
  try {
    const transaction = db.getOne('finance_transactions', String(req.body?.transaction_id || ''));
    const state = matchingState();
    const document = state.documents.find((doc) => String(doc.id) === String(req.body?.document_id || ''));
    if (!transaction || !document) return res.status(404).json({ error: 'תנועה או מסמך לא נמצאו' });
    // תקרות: היתרה שטרם הוקצתה במסמך, וסכום התנועה — הקצאה לא ממציאה כסף.
    const ceiling = Math.min(Math.abs(transaction.amount_agorot), document.remaining_agorot ?? document.gross_agorot);
    if (ceiling <= 0) return res.status(409).json({ error: 'המסמך כבר מוקצה במלואו' });
    const allocated = Number(req.body?.allocated_agorot) || ceiling;
    if (!Number.isInteger(allocated) || allocated <= 0) return res.status(400).json({ error: 'סכום הקצאה לא תקין (אגורות שלמות)' });
    if (allocated > ceiling) return res.status(400).json({ error: `ההקצאה חורגת מהיתרה (${ceiling} אג׳)` });
    const store = durableRecordingStore();
    const match = store.insert('finance_matches', {
      id: financeId('fmt'),
      transaction_id: String(transaction.id),
      document_id: String(document.id),
      document_source: document.source,
      allocated_agorot: allocated,
      confidence: 100,
      score_breakdown: { manual: true },
      method: 'manual',
      status: 'confirmed',
      matched_by: req.crmUser?.email || null,
      matched_at: new Date().toISOString(),
    });
    const supplier = document.supplier_id ? db.getOne('finance_suppliers', document.supplier_id) : null;
    if (supplier && transaction.merchant_raw) {
      const { supplier: updated, learned } = learnAlias(supplier, transaction.merchant_raw);
      if (learned) store.update('finance_suppliers', supplier.id, updated);
    }
    await store.flush();
    res.status(201).json({ match, state: matchingState() });
  } catch (error) {
    res.status(500).json({ error: error.message || 'הקישור הידני נכשל' });
  }
});

// ─── ספר החשבונות, רווח והפסד ותזרים (שלב 6) ──────────────────────────────

financeRouter.post('/ledger/rebuild', async (_req, res) => {
  try {
    if (!financeFlag('ledger')) return res.status(409).json({ error: 'ספר החשבונות כבוי (דגל ledger)' });
    const store = durableRecordingStore();
    const ledger = rebuildLedger(store);
    const forecast = rebuildCashFlowForecast(store);
    await store.flush();
    res.json({ ledger, forecast });
  } catch (error) {
    res.status(500).json({ error: error.message || 'בניית ספר החשבונות נכשלה' });
  }
});

financeRouter.get('/pl', (req, res) => {
  const { from, to } = period(req);
  const basis = req.query.basis === 'accrual' ? 'accrual' : 'cash';
  res.json({
    ...plStatement({ entries: db.get('finance_ledger_entries'), categories: db.get('finance_categories'), from, to, basis }),
    monthly: monthlySeries({ entries: db.get('finance_ledger_entries'), basis, months: 12 }),
  });
});

// drill-down: מכל מספר בדוח עד שורת המקור הבודדת שיצרה אותו.
financeRouter.get('/ledger/entries', (req, res) => {
  const basis = req.query.basis === 'accrual' ? 'accrual' : 'cash';
  const wantedPeriod = String(req.query.period || '');
  const wantedCategory = String(req.query.category_id || '');
  const { from, to } = period(req);
  // שורות שכר במזומן הן משכורת פר עובד — בלי הרשאת hr רואים רק את הצבירה
  // החודשית המצרפית, לא את השורות הפרטניות.
  const canSeePayroll = hasSensitiveAccess(req.crmUser, 'hr');
  const rows = db.get('finance_ledger_entries')
    .filter((entry) => entry.basis === basis && !entry.voided_at)
    .filter((entry) => canSeePayroll || entry.source_type !== 'payroll' || !String(entry.source_id).startsWith('paid:'))
    .filter((entry) => (wantedPeriod ? entry.period === wantedPeriod : dateInRange(entry.entry_date, from, to)))
    .filter((entry) => !wantedCategory || String(entry.category_id || 'uncategorized') === wantedCategory)
    .sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)))
    .slice(0, 500);
  res.json({ rows, total: rows.length });
});

financeRouter.get('/cashflow', (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
  res.json(cashFlowTimeline({ items: db.get('finance_cash_flow_items'), days }));
});

// רווחיות פר מרכז חושפת עלות מדריך פרטנית — לכן גם כאן שער hr.
financeRouter.get('/profit-centers', (req, res) => {
  if (!hasSensitiveAccess(req.crmUser, 'hr')) {
    return res.status(403).json({ error: 'רווחיות פר חוג כוללת נתוני שכר — נדרשת הרשאת HR' });
  }
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const factor = employerCostFactor(db.get('finance_center_settings'));
  const { rows } = laborCostRows({ workAssignments: db.get('work_assignments'), factor });
  res.json({
    month,
    classes: classProfitability({
      groups: db.get('groups'),
      enrollments: db.get('enrollments'),
      laborRows: rows,
      month,
    }),
    activities: costByKey(rows.filter((row) => row.month === month), 'activity_id'),
  });
});

// ─── עלות שכר ורווחיות פר חוג/מדריך (שלב 5) — מידע רגיש, שער hr נוסף ───────

financeRouter.get('/payroll-cost', async (req, res) => {
  try {
    if (!hasSensitiveAccess(req.crmUser, 'hr')) {
      return res.status(403).json({ error: 'נתוני שכר דורשים הרשאת HR' });
    }
    if (!financeFlag('payroll_cost')) return res.status(409).json({ error: 'ניתוח עלות שכר כבוי (דגל payroll_cost)' });
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
    const factor = employerCostFactor(db.get('finance_center_settings'));
    const { rows, unpriced } = laborCostRows({ workAssignments: db.get('work_assignments'), factor });
    const monthRows = rows.filter((row) => row.month === month);
    const classRows = classProfitability({
      groups: db.get('groups'),
      enrollments: db.get('enrollments'),
      laborRows: rows,
      month,
    });
    const employeeNames = new Map(db.get('employees').map((employee) => [String(employee.id), employee.name || '']));
    const withName = (row) => ({ ...row, employee_name: employeeNames.get(String(row.employee_id)) || row.employee_id });
    res.json({
      month,
      employer_cost_factor: factor,
      factor_note: 'עלות מעביד מוערכת: ברוטו × מקדם. כיול במסך ההגדרות; אינה תחליף לחישוב רו״ח.',
      per_employee: effectiveCostPerHour(monthRows).map(withName),
      per_class: classRows,
      per_activity: costByKey(monthRows, 'activity_id'),
      per_instructor: instructorProfitability({ classRows, laborRows: rows, month }).map(withName),
      unpriced_assignments: unpriced.filter((row) => monthOfDate(row.date) === month).length,
      totals: {
        wage_agorot: monthRows.reduce((sum, row) => sum + row.wage_agorot, 0),
        employer_cost_agorot: monthRows.reduce((sum, row) => sum + row.employer_cost_agorot, 0),
        hours: Math.round(monthRows.reduce((sum, row) => sum + row.hours, 0) * 100) / 100,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'חישוב עלות השכר נכשל' });
  }
});

const monthOfDate = (value) => String(value || '').slice(0, 7);

// ─── מרכז ההוצאות: שורה אחת לכל הוצאה כלכלית (משוב 2) ──────────────────────

financeRouter.get('/expense-center', (req, res) => {
  const { from, to } = period(req);
  const center = buildExpenseCenter({
    expenses: db.get('finance_expenses'),
    transactions: db.get('finance_transactions'),
    matches: db.get('finance_matches'),
    ingested: db.get('finance_ingested_documents'),
    deliveries: db.get('finance_accountant_deliveries'),
    categories: db.get('finance_categories'),
    suppliers: db.get('finance_suppliers'),
    accounts: db.get('financial_accounts'),
    from,
    to,
  });
  const query = String(req.query.q || '');
  res.json({
    ...center,
    rows: filterExpenseRows(center.rows, query).slice(0, 1000),
    categories: db.get('finance_categories').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
    email_configured: isEmailConfigured(),
    accountant_email: db.get('finance_automation_settings')[0]?.accountant_email || '',
  });
});

// עריכת קטגוריה של מסמך הוצאה (לתנועות יש /transactions/:id/classify).
financeRouter.put('/expense-center/expenses/:id/category', async (req, res) => {
  try {
    const expense = db.getOne('finance_expenses', req.params.id);
    if (!expense) return res.status(404).json({ error: 'ההוצאה לא נמצאה' });
    const categoryId = String(req.body?.category_id || '');
    if (!db.getOne('finance_categories', categoryId)) return res.status(400).json({ error: 'קטגוריה לא מוכרת' });
    const store = durableRecordingStore();
    store.update('finance_expenses', expense.id, {
      ...expense,
      category_id: categoryId,
      category_source: 'manual',
    });
    let rule = null;
    if (req.body?.create_rule === true) {
      const learned = learnRule(store, {
        merchantPattern: expense.supplier_name || expense.name,
        categoryId,
        createdBy: req.crmUser?.email || null,
      });
      rule = learned.rule;
      applyRules(store);
    }
    await store.flush();
    res.json({ ok: true, rule });
  } catch (error) {
    res.status(500).json({ error: error.message || 'עדכון הקטגוריה נכשל' });
  }
});

financeRouter.post('/ai-tagging/run', async (_req, res) => {
  try {
    if (!financeFlag('ai_tagging')) return res.status(409).json({ error: 'תיוג AI כבוי (דגל ai_tagging)' });
    const store = durableRecordingStore();
    const summary = await tagUntaggedExpenses(store);
    await store.flush();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message || 'התיוג נכשל' });
  }
});

// ─── קטגוריות, מנוע חוקים, ספקים ומע״מ (שלב 4) ─────────────────────────────

financeRouter.get('/categories', async (_req, res) => {
  try {
    if (!db.get('finance_categories').length) {
      const store = durableRecordingStore();
      seedCategories(store);
      await store.flush();
    }
    res.json({ categories: db.get('finance_categories').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'טעינת הקטגוריות נכשלה' });
  }
});

financeRouter.put('/transactions/:id/classify', async (req, res) => {
  try {
    const transaction = db.getOne('finance_transactions', req.params.id);
    if (!transaction) return res.status(404).json({ error: 'התנועה לא נמצאה' });
    const store = durableRecordingStore();
    store.update('finance_transactions', transaction.id, {
      ...transaction,
      category_id: req.body?.category_id ?? transaction.category_id,
      supplier_id: req.body?.supplier_id ?? transaction.supplier_id,
      cost_center_id: req.body?.cost_center_id ?? transaction.cost_center_id ?? null,
      status: 'classified',
      classified_by: req.crmUser?.email || null,
      classified_at: new Date().toISOString(),
    });
    let rule = null;
    // "החל על כל החיובים מהספק הזה מעכשיו" — כך המערכת לומדת (סעיף 9.3).
    if (req.body?.create_rule === true) {
      const learned = learnRule(store, {
        merchantPattern: transaction.merchant_raw || transaction.raw_description,
        categoryId: req.body?.category_id || null,
        supplierId: req.body?.supplier_id || null,
        costCenterId: req.body?.cost_center_id || null,
        createdBy: req.crmUser?.email || null,
      });
      rule = learned.rule;
      applyRules(store);
    }
    await store.flush();
    res.json({ ok: true, rule });
  } catch (error) {
    res.status(500).json({ error: error.message || 'הסיווג נכשל' });
  }
});

financeRouter.post('/rules/apply', async (_req, res) => {
  try {
    if (!financeFlag('rules_engine')) return res.status(409).json({ error: 'מנוע החוקים כבוי (דגל rules_engine)' });
    const store = durableRecordingStore();
    const summary = applyRules(store);
    await store.flush();
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message || 'הרצת החוקים נכשלה' });
  }
});

financeRouter.get('/rules', (_req, res) => {
  res.json({ rules: db.get('finance_rules').sort((a, b) => (b.hits || 0) - (a.hits || 0)) });
});

financeRouter.put('/rules/:id', async (req, res) => {
  try {
    const rule = db.getOne('finance_rules', req.params.id);
    if (!rule) return res.status(404).json({ error: 'החוק לא נמצא' });
    const saved = await persistRow('finance_rules', {
      ...rule,
      is_active: req.body?.is_active !== false,
      set_category_id: req.body?.set_category_id ?? rule.set_category_id,
      set_supplier_id: req.body?.set_supplier_id ?? rule.set_supplier_id,
      set_cost_center_id: req.body?.set_cost_center_id ?? rule.set_cost_center_id,
    });
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message || 'עדכון החוק נכשל' });
  }
});

financeRouter.get('/suppliers', (_req, res) => {
  const usage = new Map();
  for (const expense of db.get('finance_expenses')) {
    if (expense.supplier_id) usage.set(String(expense.supplier_id), (usage.get(String(expense.supplier_id)) || 0) + 1);
  }
  res.json({
    suppliers: db.get('finance_suppliers').map((supplier) => ({
      ...supplier,
      alias_count: (supplier.aliases || []).length,
      expense_count: usage.get(String(supplier.id)) || 0,
    })).sort((a, b) => (b.expense_count || 0) - (a.expense_count || 0)),
  });
});

financeRouter.put('/suppliers/:id', async (req, res) => {
  try {
    const supplier = db.getOne('finance_suppliers', req.params.id);
    if (!supplier) return res.status(404).json({ error: 'הספק לא נמצא' });
    const saved = await persistRow('finance_suppliers', {
      ...supplier,
      name: String(req.body?.name ?? supplier.name).trim() || supplier.name,
      vat_id: String(req.body?.vat_id ?? supplier.vat_id ?? '').replace(/\D/g, '') || supplier.vat_id,
      aliases: Array.isArray(req.body?.aliases) ? req.body.aliases.map(String).filter(Boolean) : supplier.aliases,
      default_category_id: req.body?.default_category_id ?? supplier.default_category_id ?? null,
      payment_terms: req.body?.payment_terms ?? supplier.payment_terms ?? null,
      is_recurring: req.body?.is_recurring ?? supplier.is_recurring ?? false,
    });
    res.json(saved);
  } catch (error) {
    res.status(500).json({ error: error.message || 'עדכון הספק נכשל' });
  }
});

financeRouter.get('/vat-summary', (req, res) => {
  const { from, to } = period(req);
  const documentsVatAgorot = db.get('finance_documents')
    .filter((doc) => dateInRange(doc.document_date, from, to))
    .filter((doc) => classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).recognized)
    .reduce((sum, doc) => {
      const sign = classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).sign;
      return sum + Math.round(Math.abs(Number(doc.vat_amount) || 0) * 100) * sign;
    }, 0);
  res.json(vatSummary({
    documentsVatAgorot,
    transactions: db.get('finance_transactions').filter((row) => dateInRange(row.booking_date, from, to)),
    matches: db.get('finance_matches'),
    categories: db.get('finance_categories'),
  }));
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
      accountant_email: String(req.body?.accountant_email || '').trim(),
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

// ─── שליחה לרואה החשבון במייל (משוב 2) ─────────────────────────────────────

function accountantRecipient(req) {
  const explicit = String(req.body?.to || '').trim();
  if (explicit) return explicit;
  return String(db.get('finance_automation_settings')[0]?.accountant_email || '').trim();
}

function matchedIngestedFor(expenseId) {
  const match = db.get('finance_matches').find((row) =>
    ['confirmed', 'proposed'].includes(row.status) && String(row.document_id) === String(expenseId));
  if (!match) return null;
  return null; // ההתאמה מצביעה מההוצאה לתנועה; קובץ מגיע מהמסמך שהועלה, אם קיים
}

financeRouter.post('/expenses/:id/send-accountant', async (req, res) => {
  try {
    const expense = db.getOne('finance_expenses', req.params.id);
    if (!expense) return res.status(404).json({ error: 'ההוצאה לא נמצאה' });
    const recipient = accountantRecipient(req);
    if (!recipient) return res.status(400).json({ error: 'לא הוגדרה כתובת מייל של רואה החשבון (בהגדרות המסירה)' });
    const attachments = expenseAttachments(expense, { matchedIngested: matchedIngestedFor(expense.id) });
    if (!attachments.length && req.body?.force !== true) {
      return res.status(409).json({ error: 'אין חשבונית מצורפת להוצאה הזו. צרף קובץ, או שלח עם force לסיכום בלבד.' });
    }
    const totalBytes = attachments.reduce((sum, file) => sum + file.bytes, 0);
    if (totalBytes > MAX_EMAIL_BYTES) {
      return res.status(413).json({ error: 'הקבצים גדולים מדי למייל אחד' });
    }
    const result = await sendEmail({
      to: recipient,
      subject: `חשבונית: ${expense.supplier_name || expense.name || expense.id}`,
      text: `שלום,\n\nמצורפת חשבונית:\n• ${expenseSummaryLine(expense)}\n\nנשלח ממערכת קיר בועז.`,
      attachments,
    });
    if (result.stub) {
      // אין מפתח מייל — לא מסמנים "נשלח" לעולם.
      return res.json({ sent: false, stub: true, error: 'המייל עדיין לא מחובר (חסר RESEND_API_KEY)' });
    }
    const previous = db.getOne('finance_accountant_deliveries', `fad:${expense.id}`);
    const saved = await persistRow('finance_accountant_deliveries', deliveryRow(expense, {
      sentTo: recipient,
      emailId: result.id,
      ok: result.sent,
      error: result.error,
      previous,
    }));
    return res.status(result.sent ? 200 : 502).json({ sent: result.sent, delivery: saved, error: result.error });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'השליחה נכשלה' });
  }
});

// חבילה חודשית: כל חשבוניות החודש שטרם נשלחו, בצ'אנקים מתחת לתקרת הגודל.
financeRouter.post('/accountant/send-bundle', async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month || req.body?.month || ''))
      ? String(req.query.month || req.body.month)
      : new Date().toISOString().slice(0, 7);
    const recipient = accountantRecipient(req);
    if (!recipient) return res.status(400).json({ error: 'לא הוגדרה כתובת מייל של רואה החשבון' });
    const sentAlready = new Set(db.get('finance_accountant_deliveries')
      .filter((row) => row.status === 'sent').map((row) => String(row.expense_id)));
    const monthExpenses = chooseExpenseRows(db.get('finance_expenses'))
      .filter((expense) => String(expense.expense_date || '').slice(0, 7) === month)
      .filter((expense) => !sentAlready.has(String(expense.id)));
    const withFiles = [];
    const skippedNoInvoice = [];
    for (const expense of monthExpenses) {
      const attachments = expenseAttachments(expense);
      if (attachments.length) withFiles.push({ expense, attachments });
      else skippedNoInvoice.push({ id: expense.id, summary: expenseSummaryLine(expense) });
    }
    if (!withFiles.length) {
      return res.json({ sent: 0, skipped_no_invoice: skippedNoInvoice, note: 'אין חשבוניות חדשות לשליחה בחודש הזה' });
    }
    const bundles = bundleForEmail(withFiles);
    let sent = 0;
    let stub = false;
    for (let index = 0; index < bundles.length; index += 1) {
      const bundle = bundles[index];
      const subjectSuffix = bundles.length > 1 ? ` (${index + 1}/${bundles.length})` : '';
      const result = await sendEmail({
        to: recipient,
        subject: `חשבוניות ${month}${subjectSuffix}`,
        text: bundleEmailBody(month, bundle.expenses),
        attachments: bundle.attachments,
      });
      if (result.stub) { stub = true; break; }
      if (!result.sent) {
        return res.status(502).json({ sent, error: result.error || 'שליחת החבילה נכשלה', skipped_no_invoice: skippedNoInvoice });
      }
      for (const expense of bundle.expenses) {
        const previous = db.getOne('finance_accountant_deliveries', `fad:${expense.id}`);
        await persistRow('finance_accountant_deliveries', deliveryRow(expense, {
          sentTo: recipient, emailId: result.id, ok: true, previous,
        }));
        sent += 1;
      }
    }
    return res.json({ sent, bundles: bundles.length, stub, skipped_no_invoice: skippedNoInvoice });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'שליחת החבילה נכשלה' });
  }
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
