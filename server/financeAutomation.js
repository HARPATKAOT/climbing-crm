import crypto from 'crypto';

const DATE_HEADERS = ['date', 'transaction date', 'charge date', 'תאריך', 'תאריך עסקה', 'תאריך חיוב'];
const DESCRIPTION_HEADERS = ['description', 'details', 'merchant', 'business', 'name', 'תיאור', 'פירוט', 'בית עסק', 'שם בית עסק'];
const AMOUNT_HEADERS = ['amount', 'charged amount', 'debit', 'סכום', 'סכום חיוב', 'חובה'];
const ID_HEADERS = ['id', 'reference', 'transaction id', 'אסמכתא', 'מספר עסקה'];

const round = (value) => Math.round((Number(value) || 0) * 100) / 100;
const clean = (value) => String(value ?? '').replace(/^\uFEFF/, '').trim();
const normalizedHeader = (value) => clean(value).toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ');

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => clean(value))) rows.push(row);
  return rows;
}

function pickColumn(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function parseDate(value) {
  const raw = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function parseAmount(value) {
  let raw = clean(value).replace(/[₪$€\s]/g, '');
  if (!raw) return null;
  if (/^\(.*\)$/.test(raw)) raw = `-${raw.slice(1, -1)}`;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma > dot) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(/,/g, '');
  const number = Number(raw);
  return Number.isFinite(number) && number !== 0 ? Math.abs(round(number)) : null;
}

function transactionId(row) {
  return `ft-${crypto.createHash('sha256').update([
    row.provider, row.account_last4, row.transaction_date, row.amount, row.description, row.external_id,
  ].join('|')).digest('hex').slice(0, 24)}`;
}

export function parseFinanceCsv(csvText, defaults = {}) {
  const rows = csvRows(csvText);
  if (rows.length < 2) return { rows: [], errors: ['הקובץ אינו מכיל תנועות'] };
  const headers = rows[0].map(normalizedHeader);
  const dateIndex = pickColumn(headers, DATE_HEADERS);
  const descriptionIndex = pickColumn(headers, DESCRIPTION_HEADERS);
  const amountIndex = pickColumn(headers, AMOUNT_HEADERS);
  const idIndex = pickColumn(headers, ID_HEADERS);
  if (dateIndex < 0 || amountIndex < 0) {
    return { rows: [], errors: ['לא נמצאו עמודות תאריך וסכום. יש לייצא CSV רגיל מאתר הבנק או האשראי.'] };
  }
  const parsed = [];
  const errors = [];
  rows.slice(1).forEach((values, index) => {
    const date = parseDate(values[dateIndex]);
    const amount = parseAmount(values[amountIndex]);
    if (!date || !amount) {
      errors.push(`שורה ${index + 2}: תאריך או סכום אינם תקינים`);
      return;
    }
    const rawAmountCell = clean(values[amountIndex]);
    const row = {
      provider: clean(defaults.provider) || 'manual_csv',
      account_type: defaults.account_type === 'bank' ? 'bank' : 'credit_card',
      account_last4: clean(defaults.account_last4).replace(/\D/g, '').slice(-4),
      transaction_date: date,
      description: clean(values[descriptionIndex]) || 'תנועה ללא תיאור',
      amount,
      // כיוון הכסף לצרכני המשך (המרכז הפיננסי): amount נשאר מוחלט לתאימות,
      // אבל הסימן המקורי והכותרת נשמרים כדי שזיכוי לא ייקלט כחיוב.
      amount_negative: /^\(|^-/.test(rawAmountCell),
      amount_header: headers[amountIndex] || '',
      currency: clean(defaults.currency) || 'ILS',
      external_id: idIndex >= 0 ? clean(values[idIndex]) : '',
      source: 'csv',
      imported_at: new Date().toISOString(),
    };
    parsed.push({ ...row, id: transactionId(row) });
  });
  return { rows: parsed, errors };
}

function words(value) {
  return new Set(clean(value).toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !['בעמ', 'בע״מ', 'ישראל', 'חיוב'].includes(word)));
}

function nameScore(expense, transaction) {
  const a = words(`${expense.supplier_name || ''} ${expense.name || ''}`);
  const b = words(transaction.description);
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter((word) => b.has(word)).length;
  if (overlap === 0) return 0;
  return Math.min(20, Math.round((overlap / Math.min(a.size, b.size)) * 20));
}

function daysBetween(a, b) {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(Math.round((left - right) / 86400000)) : 999;
}

export function scoreExpenseTransaction(expense, transaction) {
  const expenseAmount = Math.abs(Number(expense.amount_gross) || 0);
  const transactionAmount = Math.abs(Number(transaction.amount) || 0);
  const difference = Math.abs(expenseAmount - transactionAmount);
  let amountPoints = 0;
  if (difference <= 0.02) amountPoints = 55;
  else if (difference <= 1) amountPoints = 45;
  else if (expenseAmount && difference / expenseAmount <= 0.01) amountPoints = 35;

  const days = daysBetween(expense.expense_date, transaction.transaction_date);
  const datePoints = days <= 1 ? 25 : days <= 3 ? 20 : days <= 7 ? 12 : days <= 14 ? 5 : 0;
  const supplierPoints = nameScore(expense, transaction);
  const methodPoints = expense.payment_method === transaction.account_type ? 5 : 0;
  const score = amountPoints + datePoints + supplierPoints + methodPoints;
  return {
    score,
    confidence: Math.min(1, score / 100),
    difference: round(difference),
    days,
    reasons: [amountPoints ? 'סכום' : null, datePoints ? 'תאריך' : null, supplierPoints ? 'ספק' : null, methodPoints ? 'אמצעי תשלום' : null].filter(Boolean),
  };
}

export function matchExpenseTransactions(expenses = [], transactions = []) {
  const candidates = [];
  for (const expense of expenses) {
    if (!expense?.expense_date || !Number(expense?.amount_gross)) continue;
    for (const transaction of transactions) {
      if (!transaction?.transaction_date || !Number(transaction?.amount)) continue;
      const scored = scoreExpenseTransaction(expense, transaction);
      if (scored.score >= 60) candidates.push({ expense, transaction, ...scored });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const usedExpenses = new Set();
  const usedTransactions = new Set();
  const matches = [];
  for (const candidate of candidates) {
    if (usedExpenses.has(candidate.expense.id) || usedTransactions.has(candidate.transaction.id)) continue;
    const runnerUp = candidates.find((other) => other.expense.id === candidate.expense.id && other.transaction.id !== candidate.transaction.id && !usedTransactions.has(other.transaction.id));
    const decisive = !runnerUp || candidate.score - runnerUp.score >= 10;
    const status = candidate.score >= 85 && decisive ? 'matched' : 'review';
    matches.push({
      id: `fm-${candidate.expense.id}-${candidate.transaction.id}`,
      expense_id: candidate.expense.id,
      transaction_id: candidate.transaction.id,
      status,
      confidence: candidate.confidence,
      score: candidate.score,
      reasons: candidate.reasons,
      amount_difference: candidate.difference,
      date_difference_days: candidate.days,
      matched_at: status === 'matched' ? new Date().toISOString() : null,
      method: status === 'matched' ? 'automatic' : 'suggested',
    });
    usedExpenses.add(candidate.expense.id);
    usedTransactions.add(candidate.transaction.id);
  }
  return matches;
}

export function financeAutomationSummary(expenses = [], transactions = [], matches = [], deliveries = []) {
  const matchedExpenseIds = new Set(matches.filter((row) => row.status === 'matched').map((row) => row.expense_id));
  const reviewExpenseIds = new Set(matches.filter((row) => row.status === 'review').map((row) => row.expense_id));
  const attached = expenses.filter((row) => Array.isArray(row.attachment_metadata) && row.attachment_metadata.length > 0);
  return {
    transactions: transactions.length,
    invoices: attached.length,
    matched: matchedExpenseIds.size,
    review: reviewExpenseIds.size,
    missing_invoice: transactions.filter((row) => !matches.some((match) => match.transaction_id === row.id && match.status === 'matched')).length,
    missing_payment: attached.filter((row) => !matchedExpenseIds.has(row.id)).length,
    sent_to_accountant: new Set(deliveries.filter((row) => row.status === 'sent').map((row) => row.expense_id)).size,
  };
}
