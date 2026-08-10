const REVENUE_DOC_TYPES = new Set(['invoice', 'invrec']);
const PIPELINE_DOC_TYPES = new Set(['deal', 'offer', 'proforma']);
const CREDIT_DOC_TYPES = new Set(['refund', 'credit', 'creditinvoice', 'credit_invoice']);

export function roundFinance(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function cleanText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function classifyDocument(doctype, { isStorno = false, total = 0 } = {}) {
  const type = cleanText(doctype).replace(/ /g, '_');
  if (CREDIT_DOC_TYPES.has(type)) return { bucket: 'revenue', sign: -1, recognized: true };
  if (REVENUE_DOC_TYPES.has(type)) return { bucket: 'revenue', sign: (isStorno || Number(total) < 0) ? -1 : 1, recognized: true };
  if (PIPELINE_DOC_TYPES.has(type)) return { bucket: 'pipeline', sign: Number(total) < 0 ? -1 : 1, recognized: false };
  return { bucket: 'other', sign: 1, recognized: false };
}

export function dateInRange(value, from, to) {
  const date = String(value || '').slice(0, 10);
  if (!date) return false;
  return (!from || date >= from) && (!to || date <= to);
}

export function expenseFingerprint(expense = {}) {
  const supplier = cleanText(expense.supplier_name || expense.name);
  const date = String(expense.expense_date || '').slice(0, 10);
  const amount = roundFinance(expense.amount_gross ?? expense.amount ?? expense.total).toFixed(2);
  const doc = cleanText(expense.document_number);
  return doc
    ? `doc|${supplier}|${doc}|${amount}`
    : `soft|${supplier}|${date}|${amount}`;
}

export function reconcileExpenses(expenses = []) {
  const notion = expenses.filter((row) => row.source === 'notion');
  const icount = expenses.filter((row) => row.source === 'icount');
  const byStrong = new Map();
  const bySoft = new Map();
  const byDateAmount = new Map();
  for (const row of icount) {
    const key = expenseFingerprint(row);
    (key.startsWith('doc|') ? byStrong : bySoft).set(key, row);
    const dateAmountKey = `${String(row.expense_date || '').slice(0, 10)}|${roundFinance(row.amount_gross).toFixed(2)}`;
    const matches = byDateAmount.get(dateAmountKey) || [];
    matches.push(row);
    byDateAmount.set(dateAmountKey, matches);
  }

  return notion.map((row) => {
    const key = expenseFingerprint(row);
    const exactSupplierMatch = key.startsWith('doc|') ? byStrong.get(key) : bySoft.get(key);
    const dateAmountKey = `${String(row.expense_date || '').slice(0, 10)}|${roundFinance(row.amount_gross).toFixed(2)}`;
    const amountMatches = byDateAmount.get(dateAmountKey) || [];
    const match = exactSupplierMatch || (amountMatches.length === 1 ? amountMatches[0] : null);
    return {
      ...row,
      reconciliation_status: match ? (key.startsWith('doc|') && exactSupplierMatch ? 'matched' : 'review') : 'notion_only',
      matched_expense_id: match?.id || null,
    };
  });
}

export function chooseExpenseRows(expenses = []) {
  const reconciled = reconcileExpenses(expenses);
  const matchedIcountIds = new Set(
    reconciled.filter((row) => row.reconciliation_status === 'matched').map((row) => row.matched_expense_id)
  );
  return [
    ...expenses.filter((row) => row.source === 'icount'),
    ...expenses.filter((row) => !['icount', 'notion'].includes(row.source)),
    ...reconciled.filter((row) => !['matched', 'review'].includes(row.reconciliation_status)),
  ].filter((row, index, all) => {
    if (row.source !== 'icount' || !matchedIcountIds.has(row.id)) return true;
    return all.findIndex((candidate) => candidate.id === row.id) === index;
  });
}

export function buildDashboard({ documents = [], expenses = [], payments = [], from, to } = {}) {
  const docs = documents.filter((row) => dateInRange(row.document_date, from, to));
  const reconciledPeriod = reconcileExpenses(expenses)
    .filter((row) => dateInRange(row.expense_date, from, to));
  const periodExpenses = chooseExpenseRows(expenses)
    .filter((row) => dateInRange(row.expense_date, from, to));
  const periodPayments = payments.filter((row) => dateInRange(row.payment_date, from, to));

  let revenueNet = 0;
  let revenueGross = 0;
  let credits = 0;
  let pipeline = 0;
  const monthly = new Map();
  for (const doc of docs) {
    const cls = classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross });
    const gross = Math.abs(Number(doc.total_gross) || 0) * cls.sign;
    const net = Math.abs(Number(doc.total_net) || 0) * cls.sign;
    if (cls.bucket === 'revenue') {
      revenueGross += gross;
      revenueNet += net;
      if (cls.sign < 0) credits += Math.abs(gross);
      const month = String(doc.document_date || '').slice(0, 7);
      const current = monthly.get(month) || { month, revenue: 0, collected: 0, expenses: 0 };
      current.revenue += net;
      monthly.set(month, current);
    } else if (cls.bucket === 'pipeline') pipeline += Math.abs(Number(doc.total_gross) || 0);
  }

  let collected = 0;
  const documentPayments = docs
    .filter((doc) => classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).recognized)
    .filter((doc) => Number(doc.paid_amount) !== 0 || doc.doctype === 'invrec')
    .map((doc) => ({
      payment_date: doc.document_date,
      amount: Number(doc.paid_amount) || Number(doc.total_gross) || 0,
    }));
  // doc/info's totalpaid is the authoritative aggregate. Detailed events are
  // retained for payment-method analysis, but old cancellation documents do
  // not always expose every reversing event and must not distort collections.
  const effectivePayments = documentPayments.length ? documentPayments : periodPayments;
  for (const payment of effectivePayments) {
    collected += Number(payment.amount) || 0;
    const month = String(payment.payment_date || '').slice(0, 7);
    const current = monthly.get(month) || { month, revenue: 0, collected: 0, expenses: 0 };
    current.collected += Number(payment.amount) || 0;
    monthly.set(month, current);
  }

  let expenseGross = 0;
  let expenseNet = 0;
  let paidExpenses = 0;
  for (const expense of periodExpenses) {
    expenseGross += Number(expense.amount_gross) || 0;
    expenseNet += Number(expense.amount_net ?? expense.amount_gross) || 0;
    if (expense.paid !== false) paidExpenses += Number(expense.amount_gross) || 0;
    const month = String(expense.expense_date || '').slice(0, 7);
    const current = monthly.get(month) || { month, revenue: 0, collected: 0, expenses: 0 };
    current.expenses += Number(expense.amount_net ?? expense.amount_gross) || 0;
    monthly.set(month, current);
  }

  const recognizedDocs = docs.filter((doc) => classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).recognized);
  const customerIds = new Set(recognizedDocs.map((doc) => doc.client_id).filter(Boolean));
  const openDebt = recognizedDocs.reduce((sum, doc) => sum + Math.max(0, Number(doc.remaining_sum) || 0), 0);
  const mapped = reconciledPeriod.filter((row) => row.reconciliation_status === 'matched').length;
  const needsReview = reconciledPeriod.filter((row) => row.reconciliation_status === 'review').length;

  return {
    from,
    to,
    kpis: {
      revenue_net: roundFinance(revenueNet),
      revenue_gross: roundFinance(revenueGross),
      collected: roundFinance(collected),
      open_debt: roundFinance(openDebt),
      credits: roundFinance(credits),
      pipeline: roundFinance(pipeline),
      expenses_net: roundFinance(expenseNet),
      expenses_gross: roundFinance(expenseGross),
      operating_profit: roundFinance(revenueNet - expenseNet),
      cash_flow: roundFinance(collected - paidExpenses),
      average_transaction: roundFinance(recognizedDocs.length ? revenueGross / recognizedDocs.length : 0),
      paying_customers: customerIds.size,
    },
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)).map((row) => ({
      month: row.month,
      revenue: roundFinance(row.revenue),
      collected: roundFinance(row.collected),
      expenses: roundFinance(row.expenses),
      profit: roundFinance(row.revenue - row.expenses),
    })),
    quality: {
      documents: docs.length,
      expenses: periodExpenses.length,
      matched: mapped,
      needs_review: needsReview,
      unclassified: periodExpenses.filter((row) => !(row.categories || []).length).length,
    },
  };
}
