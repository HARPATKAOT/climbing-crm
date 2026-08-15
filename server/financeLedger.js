/**
 * ספר החשבונות הראשי — FINANCE_SPEC שלב 6. כל דוח נגזר מכאן.
 *
 * שני בסיסים לכל שורה: cash (מתי הכסף זז) ו-accrual (למתי הוא שייך).
 * מניעת ספירה כפולה:
 *  - הכנסה במזומן: שורות buildPaymentsReport — הדדופ הקרבי הקיים בין
 *    payments / pos_sales / מסמכי iCount. לא סוכמים טבלאות גולמיות.
 *  - הוצאה במזומן: תנועת בנק/אשראי היא האמת; הוצאת iCount שמקושרת
 *    לתנועה (match מאושר) לא נספרת שוב. הוצאה בלי תנועה נספרת מהמסמך.
 *  - settlement / transfer לעולם לא נכנסים (countsTowardProfit).
 *  - הכנסה בצבירה: מסמכים מוכרים + פריסת מנוי תקופתי על חלון התוקף.
 *
 * מזהים דטרמיניסטיים: ריצה חוזרת מעדכנת את אותן שורות — לא מכפילה.
 */

import crypto from 'crypto';
import { toAgorot } from './financeMoney.js';
import { countsTowardProfit } from './financeCore.js';
import { classifyDocument, buildPaymentsReport, chooseExpenseRows } from './finance.js';
import { categoryForLegacyLabel } from './financeCategories.js';
import { employerCostFactor, laborCostRows } from './payrollCost.js';

const monthOf = (value) => String(value || '').slice(0, 7);

function entryId(basis, sourceType, sourceId, period) {
  const hash = crypto.createHash('sha1').update(`${basis}|${sourceType}|${sourceId}|${period}`).digest('hex').slice(0, 20);
  return `fle_${hash}`;
}

function upsertEntry(store, existingById, entry) {
  const id = entryId(entry.basis, entry.source_type, entry.source_id, entry.period);
  const row = { id, voided_at: null, ...entry };
  if (existingById.has(id)) store.update('finance_ledger_entries', id, { ...existingById.get(id), ...row });
  else store.insert('finance_ledger_entries', row);
  existingById.set(id, row);
  return row;
}

const INCOME_CATEGORY_BY_SOURCE = {
  pos: 'cat_income_pos',
  activity: 'cat_income_events',
  equipment: 'cat_income_entries',
  customer: 'cat_income_entries',
  icount: 'cat_income',
};

/** מרכז עלות לחוג/פעילות, נוצר בעצלנות עם מזהה דטרמיניסטי. */
function ensureCostCenter(store, centers, { type, refTable, refId, name }) {
  const id = `cc_${refTable}_${refId}`;
  if (!centers.has(id)) {
    store.insert('finance_cost_centers', {
      id, type, name: name || refId, ref_table: refTable, ref_id: String(refId), is_active: true,
    });
    centers.add(id);
  }
  return id;
}

export function rebuildLedger(store, { now = new Date().toISOString() } = {}) {
  const existingById = new Map(store.get('finance_ledger_entries').map((row) => [row.id, row]));
  const beforeIds = new Set(existingById.keys());
  const touched = new Set();
  const centers = new Set(store.get('finance_cost_centers').map((row) => row.id));
  const categories = store.get('finance_categories');
  const groupsById = new Map(store.get('groups').map((row) => [String(row.id), row]));
  const activitiesById = new Map(store.get('activities').map((row) => [String(row.id), row]));
  const add = (entry) => touched.add(upsertEntry(store, existingById, entry).id);
  const summary = { cash_income: 0, cash_expense: 0, accrual_income: 0, accrual_expense: 0, payroll: 0, deferrals: 0 };

  // ── הכנסה במזומן: שורות התשלומים המאוחדות ────────────────────────────────
  const paymentsReport = buildPaymentsReport({
    documents: store.get('finance_documents'),
    lines: store.get('finance_document_lines'),
    paymentEvents: store.get('finance_payment_events'),
    payments: store.get('payments'),
    posSales: store.get('pos_sales'),
    registrations: store.get('activity_registrations'),
    activities: store.get('activities'),
    parents: store.get('parents'),
    students: store.get('students'),
    customerPasses: store.get('customer_passes'),
    from: '2010-01-01',
    to: now.slice(0, 10),
  });
  for (const row of paymentsReport.rows) {
    const amount = toAgorot(Number(row.net_amount) || 0);
    if (!amount || !row.date) continue;
    let costCenterId = null;
    if (row.activity_ids?.length === 1) {
      const activity = activitiesById.get(String(row.activity_ids[0]));
      costCenterId = ensureCostCenter(store, centers, {
        type: 'activity', refTable: 'activities', refId: row.activity_ids[0], name: activity?.name,
      });
    }
    add({
      entry_date: row.date,
      period: monthOf(row.date),
      amount_agorot: amount,
      basis: 'cash',
      category_id: INCOME_CATEGORY_BY_SOURCE[row.source] || 'cat_income',
      cost_center_id: costCenterId,
      source_type: 'payment',
      source_id: String(row.id),
      description: row.description || '',
    });
    summary.cash_income += 1;
  }

  // ── הוצאות: תנועות בנק/אשראי הן האמת במזומן ─────────────────────────────
  const confirmedMatches = store.get('finance_matches').filter((match) => match.status === 'confirmed');
  const matchedDocIds = new Set(confirmedMatches.map((match) => String(match.document_id)));
  for (const transaction of store.get('finance_transactions')) {
    if (!countsTowardProfit(transaction.kind) || transaction.kind === 'income') continue;
    if (transaction.status === 'voided') continue;
    add({
      entry_date: transaction.booking_date,
      period: monthOf(transaction.booking_date),
      amount_agorot: transaction.amount_agorot, // כבר שלילי
      basis: 'cash',
      category_id: transaction.category_id || null,
      cost_center_id: transaction.cost_center_id || null,
      source_type: 'transaction',
      source_id: String(transaction.id),
      description: transaction.raw_description || '',
    });
    summary.cash_expense += 1;
  }

  // ── הוצאות מהמסמכים: בצבירה תמיד; במזומן רק כשאין תנועה שמכסה אותן ──────
  const expenses = chooseExpenseRows(store.get('finance_expenses'));
  for (const expense of expenses) {
    const gross = Number(expense.amount_gross);
    if (!(gross > 0) || !expense.expense_date) continue;
    const amount = -toAgorot(gross);
    const category = expense.categories?.length
      ? categoryForLegacyLabel(categories, expense.categories[0])
      : null;
    const net = Number(expense.amount_net);
    const base = {
      entry_date: String(expense.expense_date).slice(0, 10),
      period: monthOf(expense.expense_date),
      amount_agorot: amount,
      net_agorot: Number.isFinite(net) ? -toAgorot(net) : null,
      category_id: category?.id || null,
      cost_center_id: null,
      source_type: 'expense',
      source_id: String(expense.id),
      description: expense.name || expense.supplier_name || '',
    };
    add({ ...base, basis: 'accrual' });
    summary.accrual_expense += 1;
    // במזומן: רק אם שולמה ואין תנועת בנק/אשראי מאושרת שהיא אותו כסף.
    if (expense.paid !== false && !matchedDocIds.has(String(expense.id))) {
      add({ ...base, basis: 'cash', entry_date: String(expense.paid_date || expense.expense_date).slice(0, 10), period: monthOf(expense.paid_date || expense.expense_date) });
      summary.cash_expense += 1;
    }
  }

  // ── הכנסה בצבירה: מסמכים מוכרים ─────────────────────────────────────────
  for (const doc of store.get('finance_documents')) {
    const classification = classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross });
    if (!classification.recognized || !doc.document_date) continue;
    const gross = toAgorot(Math.abs(Number(doc.total_gross) || 0)) * classification.sign;
    const net = toAgorot(Math.abs(Number(doc.total_net) || 0)) * classification.sign;
    if (!gross) continue;
    add({
      entry_date: String(doc.document_date).slice(0, 10),
      period: monthOf(doc.document_date),
      amount_agorot: gross,
      net_agorot: net || null,
      vat_agorot: gross - (net || gross),
      basis: 'accrual',
      category_id: 'cat_income',
      cost_center_id: null,
      source_type: 'document',
      source_id: String(doc.id),
      description: doc.client_name || doc.docnum || '',
    });
    summary.accrual_income += 1;
  }

  // ── הכנסה נדחית: מנוי תקופתי נפרס ליניארית על חלון התוקף ─────────────────
  for (const pass of store.get('customer_passes')) {
    if (pass.status === 'void') continue;
    const paid = Number(pass.paid_price);
    const from = String(pass.valid_from || '').slice(0, 10);
    const until = String(pass.valid_until || '').slice(0, 10);
    if (!(paid > 0) || !from || !until || until <= from) continue;
    const startMonth = monthOf(from);
    const endMonth = monthOf(until);
    const months = [];
    const cursor = new Date(`${startMonth}-01T00:00:00Z`);
    while (cursor.toISOString().slice(0, 7) <= endMonth && months.length < 36) {
      months.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    if (months.length < 2) continue; // מנוי חודשי — אין מה לפרוס
    const totalAgorot = toAgorot(paid);
    // היפוך ההכרה המיידית + פריסה: הסכום כולו יוצא מחודש המכירה ונפרס שווה.
    add({
      entry_date: from,
      period: startMonth,
      amount_agorot: -totalAgorot,
      basis: 'accrual',
      category_id: 'cat_income_entries',
      cost_center_id: null,
      source_type: 'deferral',
      source_id: `pass:${pass.id}:reversal`,
      description: `דחיית הכנסה: מנוי ${pass.id}`,
    });
    const perMonth = Math.floor(totalAgorot / months.length);
    months.forEach((month, index) => {
      const amount = index === months.length - 1 ? totalAgorot - perMonth * (months.length - 1) : perMonth;
      add({
        entry_date: `${month}-01`,
        period: month,
        amount_agorot: amount,
        basis: 'accrual',
        category_id: 'cat_income_entries',
        cost_center_id: null,
        source_type: 'deferral',
        source_id: `pass:${pass.id}:${month}`,
        description: `הכרה חודשית: מנוי ${pass.id}`,
      });
    });
    summary.deferrals += 1;
  }

  // ── שכר: עלות מעביד מהשורות הקפואות, בצבירה לפי חודש העבודה ─────────────
  const factor = employerCostFactor(store.get('finance_center_settings'));
  const { rows: labor } = laborCostRows({ workAssignments: store.get('work_assignments'), factor });
  const laborByMonth = new Map();
  for (const row of labor) {
    const entry = laborByMonth.get(row.month) || { wage: 0, extra: 0, byCenter: new Map() };
    entry.wage += row.wage_agorot;
    entry.extra += row.employer_cost_agorot - row.wage_agorot;
    if (row.group_id) {
      const centerId = ensureCostCenter(store, centers, {
        type: 'class', refTable: 'groups', refId: row.group_id, name: groupsById.get(row.group_id)?.name,
      });
      entry.byCenter.set(centerId, (entry.byCenter.get(centerId) || 0) + row.employer_cost_agorot);
    }
    laborByMonth.set(row.month, entry);
  }
  for (const [month, entry] of laborByMonth) {
    add({
      entry_date: `${month}-01`,
      period: month,
      amount_agorot: -entry.wage,
      basis: 'accrual',
      category_id: 'cat_hr_wages',
      cost_center_id: null,
      source_type: 'payroll',
      source_id: `wages:${month}`,
      description: `שכר עבודה ${month} (סכומים קפואים)`,
    });
    add({
      entry_date: `${month}-01`,
      period: month,
      amount_agorot: -entry.extra,
      basis: 'accrual',
      category_id: 'cat_hr_social',
      cost_center_id: null,
      source_type: 'payroll',
      source_id: `employer:${month}`,
      description: `עלויות מעביד ${month} (מקדם ${factor})`,
    });
    summary.payroll += 2;
  }
  // במזומן: תשלומי שכר שנרשמו בפועל במעקב התשלומים.
  for (const period of store.get('payroll_periods')) {
    const paid = Number(period.salary_amount);
    if (!(paid > 0) || !period.salary_paid_at) continue;
    add({
      entry_date: String(period.salary_paid_at).slice(0, 10),
      period: monthOf(period.salary_paid_at),
      amount_agorot: -toAgorot(paid),
      basis: 'cash',
      category_id: 'cat_hr_wages',
      cost_center_id: null,
      source_type: 'payroll',
      source_id: `paid:${period.employee_id}:${period.period}`,
      description: `שכר ששולם (${period.period})`,
    });
    summary.payroll += 1;
  }

  // ── שורות שהמקור שלהן נעלם — voided, לא נמחקות ──────────────────────────
  let voided = 0;
  for (const id of beforeIds) {
    if (touched.has(id)) continue;
    const row = existingById.get(id);
    if (row.voided_at) continue;
    store.update('finance_ledger_entries', id, { ...row, voided_at: now });
    voided += 1;
  }
  return { ...summary, entries: touched.size, voided };
}

// ─── רווח והפסד מדורג ───────────────────────────────────────────────────────

export function plStatement({ entries = [], categories = [], from, to, basis = 'cash' } = {}) {
  const categoryById = new Map(categories.map((category) => [String(category.id), category]));
  const rootOf = (categoryId) => {
    let current = categoryById.get(String(categoryId || ''));
    while (current?.parent_id) current = categoryById.get(String(current.parent_id));
    return current || null;
  };
  const rows = entries.filter((entry) =>
    entry.basis === basis && !entry.voided_at
    && (!from || entry.entry_date >= from) && (!to || entry.entry_date <= to));

  let revenue = 0;
  let credits = 0;
  let cogs = 0;
  let wages = 0;
  let opex = 0;
  const byCategory = new Map();
  for (const entry of rows) {
    const category = categoryById.get(String(entry.category_id || ''));
    const root = rootOf(entry.category_id);
    const isIncome = category?.is_income || root?.is_income || (!category && entry.amount_agorot > 0 && ['payment', 'document', 'deferral'].includes(entry.source_type));
    const key = category?.id || (isIncome ? 'cat_income' : 'uncategorized');
    byCategory.set(key, (byCategory.get(key) || 0) + entry.amount_agorot);
    if (isIncome) {
      if (entry.amount_agorot >= 0) revenue += entry.amount_agorot;
      else credits += -entry.amount_agorot;
      continue;
    }
    const expenseAmount = -entry.amount_agorot; // הוצאות שליליות בספר
    if (category?.is_cogs || root?.is_cogs) cogs += expenseAmount;
    else if (root?.id === 'cat_hr' || entry.source_type === 'payroll') wages += expenseAmount;
    else opex += expenseAmount;
  }
  const netRevenue = revenue - credits;
  const grossProfit = netRevenue - cogs;
  const ebitda = grossProfit - wages - opex;
  return {
    basis,
    from,
    to,
    revenue_agorot: revenue,
    credits_agorot: credits,
    net_revenue_agorot: netRevenue,
    cogs_agorot: cogs,
    gross_profit_agorot: grossProfit,
    wages_agorot: wages,
    opex_agorot: opex,
    ebitda_agorot: ebitda,
    depreciation_agorot: 0, // אין נתוני רכוש קבוע — DECISIONS #8
    net_profit_agorot: ebitda,
    by_category: [...byCategory.entries()].map(([category_id, amount_agorot]) => ({
      category_id,
      name: categoryById.get(category_id)?.name || (category_id === 'uncategorized' ? 'לא מסווג' : category_id),
      amount_agorot,
    })).sort((a, b) => Math.abs(b.amount_agorot) - Math.abs(a.amount_agorot)),
  };
}

/** סדרת חודשים לגרפים: הכנסה/הוצאה/רווח פר חודש בבסיס נתון. */
export function monthlySeries({ entries = [], basis = 'cash', months = 12, now } = {}) {
  const rows = entries.filter((entry) => entry.basis === basis && !entry.voided_at);
  const map = new Map();
  for (const entry of rows) {
    const bucket = map.get(entry.period) || { period: entry.period, income_agorot: 0, expense_agorot: 0 };
    if (entry.amount_agorot >= 0) bucket.income_agorot += entry.amount_agorot;
    else bucket.expense_agorot += -entry.amount_agorot;
    map.set(entry.period, bucket);
  }
  const endMonth = monthOf(now || new Date().toISOString());
  return [...map.values()]
    .filter((bucket) => bucket.period <= endMonth)
    .sort((a, b) => a.period.localeCompare(b.period))
    .slice(-months)
    .map((bucket) => ({ ...bucket, profit_agorot: bucket.income_agorot - bucket.expense_agorot }));
}
