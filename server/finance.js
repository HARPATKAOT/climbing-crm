import { hostChargeBreakdown } from './activityPricing.js';

const REVENUE_DOC_TYPES = new Set(['invoice', 'invrec']);
const PIPELINE_DOC_TYPES = new Set(['deal', 'offer', 'proforma']);
const CREDIT_DOC_TYPES = new Set(['refund', 'credit', 'creditinvoice', 'credit_invoice']);
const COMPLETED_PAYMENT_STATUSES = new Set(['paid', 'completed']);

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

function israelDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function operationalPaymentMethod(payment, sale) {
  const explicit = payment?.payment_method || sale?.payment_method;
  if (explicit) return explicit;
  if (payment?.cc_confirmation_code || payment?.cc_card_type || payment?.cc_last4 || payment?.payment_url) {
    return 'online';
  }
  return '';
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

const paymentMethodLabel = (method) => ({
  credit_card: 'אשראי',
  card: 'אשראי',
  cc: 'אשראי',
  online: 'אשראי אונליין',
  emv: 'אשראי בקופה',
  cash: 'מזומן',
  bank_transfer: 'העברה בנקאית',
  banktransfer: 'העברה בנקאית',
  cheque: 'המחאה',
  paypal: 'PayPal',
  barter: 'ברטר',
}[String(method || '').toLowerCase()] || String(method || 'לא ידוע'));

function financeDocumentKey(document) {
  const docnum = String(document?.docnum || '').trim();
  const doctype = String(document?.doctype || '').trim().toLowerCase();
  return docnum ? `${doctype || 'document'}:${docnum}` : String(document?.id || '');
}

function financeDocumentScore(document, linesByDocument = new Map()) {
  return (
    (document?.source_url ? 8 : 0) +
    (document?.client_id ? 4 : 0) +
    (document?.client_name ? 2 : 0) +
    ((linesByDocument.get(String(document?.id || '')) || []).length ? 6 : 0) +
    (document?.updated_at ? 1 : 0)
  );
}

/**
 * iCount syncs can occasionally return the same document more than once with
 * different source ids. A receipt must only contribute once to totals.
 */
function uniqueFinanceDocuments(documents = [], linesByDocument = new Map()) {
  const unique = new Map();
  for (const document of documents) {
    const key = financeDocumentKey(document);
    if (!key) continue;
    const current = unique.get(key);
    if (!current || financeDocumentScore(document, linesByDocument) > financeDocumentScore(current, linesByDocument)) {
      unique.set(key, document);
    }
  }
  return [...unique.values()];
}

export function normalizePaymentStatus(status, { amount = 0, refundAmount = 0 } = {}) {
  const raw = String(status || '').trim().toLowerCase();
  if (['pending', 'pending_payment', 'waiting', 'open'].includes(raw)) return raw === 'open' ? 'open' : 'pending';
  if (['cancelled', 'canceled', 'void'].includes(raw)) return 'cancelled';
  if (['failed', 'declined', 'error'].includes(raw)) return 'failed';
  if (['quoted', 'quote', 'offer'].includes(raw)) return 'quoted';
  if (['refunded', 'refund', 'credit'].includes(raw)) {
    const paid = Math.abs(Number(amount) || 0);
    const refunded = Math.abs(Number(refundAmount) || 0);
    return refunded > 0 && paid > 0 && refunded + 0.005 < paid ? 'partial_refund' : 'refunded';
  }
  if (['paid', 'completed', 'success', 'succeeded'].includes(raw)) return 'paid';
  return raw || 'unknown';
}

function normalizedItem(row, fallbackAmount = 0) {
  const quantity = Math.abs(Number(row?.quantity) || 1);
  const unitPrice = Number(row?.unitprice ?? row?.unit_price);
  const explicitTotal = Number(row?.line_gross ?? row?.total ?? row?.amount);
  const total = Number.isFinite(explicitTotal)
    ? explicitTotal
    : (Number.isFinite(unitPrice) ? unitPrice * quantity : Number(fallbackAmount) || 0);
  return {
    id: row?.pricelist_id || row?.item_id || row?.sku || row?.id || row?.name || row?.description || null,
    name: row?.name || row?.description || 'מוצר ללא שם',
    quantity,
    unit_price: Number.isFinite(unitPrice) ? unitPrice : (quantity ? total / quantity : total),
    total: roundFinance(total),
  };
}

function paymentSource(payment, sale, linkedActivities) {
  if (payment?.equipment_checkout_token || payment?.equipment_payment || payment?.equipment_family_payment || payment?.equipment_shoes_upgrade) {
    return 'equipment';
  }
  if (linkedActivities.length || payment?.activity_id || payment?.activity_registration_id || payment?.activity_host_payment) {
    return 'activity';
  }
  if (payment?.pos_sale_id || sale) return 'pos';
  return 'customer';
}

const OPEN_PAYMENT_STATUSES = new Set(['pending', 'open', 'quoted']);

/**
 * A live payment link is only a collection task when there is already a
 * business obligation behind it. Product browsing, quotes and reservations
 * that become real only after payment must never inflate receivables.
 */
function openDebtClassification({ payment = {}, sale = null, registrations = [] } = {}) {
  if (payment?.activity_host_payment) {
    return { is_debt: true, debt_reason: 'אירוע בהתחייבות המזמין' };
  }
  if (
    payment?.equipment_checkout_token
    || payment?.equipment_payment
    || payment?.equipment_family_payment
    || payment?.equipment_shoes_upgrade
  ) {
    return { is_debt: false, debt_reason: 'קישור רכישת ציוד ללא התחייבות' };
  }
  if (String(sale?.status || '').toLowerCase() === 'quoted') {
    return { is_debt: false, debt_reason: 'הצעת מחיר' };
  }
  if (payment?.activity_registration_order_id) {
    const confirmed = registrations.some((row) => ['confirmed', 'active'].includes(String(row?.status || '').toLowerCase()));
    return confirmed
      ? { is_debt: true, debt_reason: 'השתתפות שאושרה' }
      : { is_debt: false, debt_reason: 'הרשמה שטרם אושרה' };
  }
  if (payment?.intro_booking_id || sale?.source === 'intro_booking') {
    return { is_debt: false, debt_reason: 'שריון אימון שמותנה בתשלום' };
  }
  if (sale?.source === 'shop' || payment?.shop_item_id) {
    return { is_debt: false, debt_reason: 'רכישה שטרם הושלמה' };
  }
  // קישור תשלום מהדלפק נשלח רק על דבר שכבר מחייב. בעבר נשאל בקופה אם הקישור
  // הוא חוב או „אפשרות לרכישה” (`pos_offer`); זו החלטה עסקית שהתבטלה —
  // אפשרויות לרכישה נשלחות כהצעת מחיר, שממילא אינה חוב.
  if (sale?.source === 'pos_debt') {
    return { is_debt: true, debt_reason: 'קישור תשלום מהקופה' };
  }
  if (sale) return { is_debt: true, debt_reason: 'עסקה שנפתחה בקופה' };
  return { is_debt: true, debt_reason: 'דרישת תשלום יזומה' };
}

function unpaidHostActivityDebt(activity, registrations = []) {
  if (activity?.registration_mode !== 'host_pays') return null;
  if (['paid', 'refunded', 'cancelled'].includes(String(activity.payment_status || '').toLowerCase())) return null;
  if (['draft', 'cancelled', 'archived'].includes(String(activity.status || '').toLowerCase())) return null;
  if (!(activity.host_parent_id || activity.host_name || activity.contact_name)) return null;

  const frozen = Number(activity.host_charge_amount);
  const registeredCount = registrations.filter((row) => (
    ['confirmed', 'active'].includes(String(row?.status || '').toLowerCase())
  )).length;
  const calculated = hostChargeBreakdown(activity, { registeredCount }).gross;
  const amount = Number.isFinite(frozen) && frozen > 0 ? frozen : calculated;
  return {
    amount: roundFinance(amount),
    registered_count: registeredCount,
  };
}

function paymentRowAmounts(status, amount, explicitRefund = 0, { accountingCredit = false, collected = null } = {}) {
  const absoluteAmount = Math.abs(Number(amount) || 0);
  let refund = Math.abs(Number(explicitRefund) || 0);
  let gross = 0;
  let open = 0;

  if (accountingCredit) {
    refund = refund || absoluteAmount;
  } else if (status === 'paid' || status === 'partial_refund' || status === 'refunded') {
    gross = collected == null ? absoluteAmount : Math.min(absoluteAmount, Math.abs(Number(collected) || 0));
    if (status === 'refunded' && !refund) refund = absoluteAmount;
  } else if (status === 'pending' || status === 'open' || status === 'quoted') {
    gross = Math.min(absoluteAmount, Math.abs(Number(collected) || 0));
    open = Math.max(0, absoluteAmount - gross);
  }

  return {
    amount: roundFinance(absoluteAmount),
    gross_collected: roundFinance(gross),
    open_amount: roundFinance(open),
    refund_amount: roundFinance(refund),
    net_amount: roundFinance(gross - refund),
  };
}

/**
 * גבייה והחזרים הם תזרים — נספרים רק בתוך התקופה. חוב פתוח הוא מלאי —
 * נספר תמיד (שורות חוב נכנסות לדוח גם מחוץ לטווח, עם in_period=false).
 */
function summarizePaymentRows(rows) {
  const inPeriod = rows.filter((row) => row.in_period !== false);
  return {
    records: rows.length,
    customers: new Set(rows.map((row) => row.customer_id || row.customer_name).filter(Boolean)).size,
    paid_count: inPeriod.filter((row) => ['paid', 'partial_refund', 'refunded'].includes(row.status)).length,
    open_count: rows.filter((row) => ['pending', 'open', 'quoted'].includes(row.status)).length,
    refunded_count: inPeriod.filter((row) => Number(row.refund_amount) > 0).length,
    gross_collected: roundFinance(inPeriod.reduce((sum, row) => sum + Number(row.gross_collected || 0), 0)),
    open_amount: roundFinance(rows.reduce((sum, row) => sum + Number(row.open_amount || 0), 0)),
    refunds: roundFinance(inPeriod.reduce((sum, row) => sum + Number(row.refund_amount || 0), 0)),
    net_collected: roundFinance(inPeriod.reduce((sum, row) => sum + Number(row.net_amount || 0), 0)),
  };
}

function operationalStatusScore(status) {
  const normalized = normalizePaymentStatus(status);
  return ({ refunded: 100, partial_refund: 90, cancelled: 80, paid: 40, pending: 20, open: 20, quoted: 10 }[normalized] || 0);
}

function mergeMeaningful(fallback, preferred) {
  const merged = { ...(fallback || {}) };
  Object.entries(preferred || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') merged[key] = value;
  });
  return merged;
}

function addAggregate(map, key, base, amount, customerId) {
  const current = map.get(key) || { ...base, deals: 0, revenue: 0, refunds: 0, customers: new Set() };
  current.deals += 1;
  current.revenue += amount;
  if (amount < 0) current.refunds += Math.abs(amount);
  if (customerId) current.customers.add(String(customerId));
  map.set(key, current);
}

function finalizeAggregate(map, sort = 'revenue') {
  return [...map.values()]
    .map((row) => ({
      ...row,
      revenue: roundFinance(row.revenue),
      refunds: roundFinance(row.refunds),
      customers: row.customers.size,
    }))
    .sort((a, b) => sort === 'date'
      ? String(b.date).localeCompare(String(a.date))
      : Math.abs(b.revenue) - Math.abs(a.revenue));
}

/**
 * Build operational sales views from the accounting documents and the CRM
 * links that already connect a receipt to a POS sale or event registration.
 * No fuzzy matching is used here: an event is shown only when its payment is
 * explicitly linked, so the financial report never invents attribution.
 */
export function buildSalesBreakdown({
  documents = [],
  lines = [],
  paymentEvents = [],
  payments = [],
  posSales = [],
  registrations = [],
  activities = [],
  parents = [],
  from,
  to,
} = {}) {
  const linesByDocument = new Map();
  for (const line of lines) {
    const key = String(line.document_id || '');
    const rows = linesByDocument.get(key) || [];
    rows.push(line);
    linesByDocument.set(key, rows);
  }
  const paymentEventsByDocument = new Map();
  for (const payment of paymentEvents) {
    const rows = paymentEventsByDocument.get(payment.document_id) || [];
    rows.push(payment);
    paymentEventsByDocument.set(payment.document_id, rows);
  }
  const paymentsByDocnum = new Map(payments
    .filter((row) => row.icount_doc_number)
    .map((row) => [String(row.icount_doc_number), row]));
  const salesByPayment = new Map(posSales.filter((row) => row.payment_id).map((row) => [String(row.payment_id), row]));
  const salesByDocnum = new Map(posSales.filter((row) => row.icount_doc_number).map((row) => [String(row.icount_doc_number), row]));
  const registrationsByPayment = new Map();
  for (const registration of registrations) {
    if (!registration.payment_id) continue;
    const rows = registrationsByPayment.get(String(registration.payment_id)) || [];
    rows.push(registration);
    registrationsByPayment.set(String(registration.payment_id), rows);
  }
  const activityById = new Map(activities.map((row) => [String(row.id), row]));
  const parentById = new Map(parents.map((row) => [String(row.id), row]));
  const activityByHostPayment = new Map(activities
    .filter((row) => row.host_payment_id)
    .map((row) => [String(row.host_payment_id), row]));

  const daily = new Map();
  const events = new Map();
  const products = new Map();
  const methods = new Map();
  const customers = new Map();
  const deals = [];

  const uniqueDocuments = uniqueFinanceDocuments(documents, linesByDocument);
  const recognizedDocumentNumbers = new Set(uniqueDocuments
    .filter((document) => classifyDocument(document.doctype, {
      isStorno: document.is_storno,
      total: document.total_gross,
    }).recognized)
    .map((document) => String(document.docnum || ''))
    .filter(Boolean));
  const operationalDocuments = payments
    .filter((payment) => COMPLETED_PAYMENT_STATUSES.has(String(payment.status || '').trim().toLowerCase()))
    .filter((payment) => dateInRange(israelDate(payment.paid_at || payment.completed_at || payment.updated_at || payment.created_at), from, to))
    .filter((payment) => !payment.icount_doc_number || !recognizedDocumentNumbers.has(String(payment.icount_doc_number)))
    .map((payment) => ({
      id: `payment:${payment.id}`,
      document_date: israelDate(payment.paid_at || payment.completed_at || payment.updated_at || payment.created_at),
      docnum: payment.icount_doc_number || payment.id,
      doctype: 'payment',
      total_gross: Number(payment.amount ?? payment.total ?? 0),
      client_id: payment.parent_id || null,
      client_name: parentById.get(String(payment.parent_id || ''))?.name || '',
      source_url: payment.icount_doc_url || null,
      operational_payment: payment,
    }));

  for (const document of [...uniqueDocuments, ...operationalDocuments]) {
    if (!dateInRange(document.document_date, from, to)) continue;
    const classification = classifyDocument(document.doctype, {
      isStorno: document.is_storno,
      total: document.total_gross,
    });
    if (!classification.recognized && !document.operational_payment) continue;
    const amount = roundFinance(Math.abs(Number(document.total_gross) || 0) * classification.sign);
    const linkedPayment = document.operational_payment || paymentsByDocnum.get(String(document.docnum || '')) || null;
    const sale = (linkedPayment && salesByPayment.get(String(linkedPayment.id)))
      || salesByDocnum.get(String(document.docnum || ''))
      || null;
    const registrationsForPayment = linkedPayment
      ? registrationsByPayment.get(String(linkedPayment.id)) || []
      : [];
    const linkedActivities = [...new Map([
      ...(linkedPayment && activityByHostPayment.get(String(linkedPayment.id))
        ? [activityByHostPayment.get(String(linkedPayment.id))]
        : []),
      ...(linkedPayment?.activity_id && activityById.get(String(linkedPayment.activity_id))
        ? [activityById.get(String(linkedPayment.activity_id))]
        : []),
      ...registrationsForPayment.map((row) => activityById.get(String(row.activity_id))).filter(Boolean),
    ].map((row) => [String(row.id), row])).values()];
    const documentLines = linesByDocument.get(String(document.id || '')) || [];
    const eventLabels = linkedActivities.map((row) => row.name || 'אירוע ללא שם');
    const detailRows = sale?.items?.length
      ? sale.items
      : (documentLines.length ? documentLines : (linkedPayment?.description ? [{ description: linkedPayment.description }] : []));
    const itemLabels = detailRows
      .map((row) => row.name || row.description)
      .filter(Boolean);
    const paymentMethods = paymentEventsByDocument.get(document.id) || [];
    const fallbackMethod = operationalPaymentMethod(linkedPayment, sale);

    const deal = {
      id: document.id,
      date: document.document_date,
      document_number: document.docnum || '',
      doctype: document.doctype,
      customer_id: document.client_id || linkedPayment?.parent_id || null,
      customer_name: document.client_name || sale?.customer_name || parentById.get(String(linkedPayment?.parent_id || ''))?.name || 'לקוח ללא שם',
      amount,
      event_ids: linkedActivities.map((row) => row.id),
      events: eventLabels,
      products: itemLabels,
      payment_methods: paymentMethods.length
        ? [...new Set(paymentMethods.map((row) => paymentMethodLabel(row.method)))]
        : [paymentMethodLabel(fallbackMethod)],
      source_url: document.source_url || sale?.icount_doc_url || linkedPayment?.icount_doc_url || null,
      kind: linkedActivities.length ? 'event' : (sale || documentLines.length ? 'product' : 'general'),
    };
    deals.push(deal);

    addAggregate(daily, document.document_date, { date: document.document_date, label: document.document_date }, amount, deal.customer_id);
    const customerKey = String(deal.customer_id || deal.customer_name);
    addAggregate(customers, customerKey, { id: deal.customer_id, name: deal.customer_name }, amount, deal.customer_id || deal.customer_name);

    if (linkedActivities.length) {
      const share = amount / linkedActivities.length;
      linkedActivities.forEach((activity) => addAggregate(events, String(activity.id), {
        id: activity.id,
        name: activity.name || 'אירוע ללא שם',
        event_date: activity.date || null,
        event_type: activity.event_kind || activity.type || '',
      }, share, deal.customer_id));
    }

    const rawItems = sale?.items?.length ? sale.items.map((item) => ({
      id: item.pricelist_id || item.name,
      name: item.name || item.description || 'מוצר ללא שם',
      quantity: Number(item.quantity) || 1,
      amount: (Number(item.unitprice) || 0) * (Number(item.quantity) || 1),
    })) : (documentLines.length ? documentLines : (linkedPayment?.description ? [{
      item_id: linkedPayment.description,
      description: linkedPayment.description,
      quantity: 1,
      line_gross: amount,
    }] : []))
      .filter((line) => Number(line.line_gross) > 0 && !/^הנחה\s*:/i.test(String(line.description || '')))
      .map((line) => ({
        id: line.item_id || line.sku || line.description,
        name: line.description || 'מוצר ללא שם',
        quantity: Number(line.quantity) || 1,
        amount: Number(line.line_gross) || 0,
      }));
    const itemTotal = rawItems.reduce((sum, row) => sum + Math.abs(row.amount), 0);
    rawItems.forEach((item) => {
      const itemAmount = itemTotal ? amount * Math.abs(item.amount) / itemTotal : amount / Math.max(1, rawItems.length);
      const key = String(item.id || item.name);
      const current = products.get(key) || { id: item.id || null, name: item.name, quantity: 0, deals: 0, revenue: 0, refunds: 0, customers: new Set() };
      current.quantity += amount < 0 ? -Math.abs(item.quantity) : Math.abs(item.quantity);
      current.deals += 1;
      current.revenue += itemAmount;
      if (itemAmount < 0) current.refunds += Math.abs(itemAmount);
      if (deal.customer_id) current.customers.add(String(deal.customer_id));
      products.set(key, current);
    });

    if (paymentMethods.length) {
      const totalPayments = paymentMethods.reduce((sum, row) => sum + Math.abs(Number(row.amount) || 0), 0);
      paymentMethods.forEach((payment) => {
        const methodAmount = totalPayments ? amount * Math.abs(Number(payment.amount) || 0) / totalPayments : amount / paymentMethods.length;
        const key = paymentMethodLabel(payment.method);
        addAggregate(methods, key, { method: key }, methodAmount, deal.customer_id);
      });
    } else {
      const key = paymentMethodLabel(fallbackMethod);
      addAggregate(methods, key, { method: key }, amount, deal.customer_id);
    }
  }

  return {
    summary: {
      deals: deals.length,
      revenue: roundFinance(deals.reduce((sum, row) => sum + row.amount, 0)),
      refunds: roundFinance(deals.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0)),
      customers: new Set(deals.map((row) => row.customer_id || row.customer_name).filter(Boolean)).size,
      linked_to_event: deals.filter((row) => row.events.length).length,
      with_product_detail: deals.filter((row) => row.products.length).length,
    },
    deals: deals.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.document_number).localeCompare(String(a.document_number))),
    daily: finalizeAggregate(daily, 'date'),
    events: finalizeAggregate(events),
    products: [...products.values()].map((row) => ({
      ...row,
      quantity: roundFinance(row.quantity),
      revenue: roundFinance(row.revenue),
      refunds: roundFinance(row.refunds),
      customers: row.customers.size,
    })).sort((a, b) => Math.abs(b.revenue) - Math.abs(a.revenue)),
    payment_methods: finalizeAggregate(methods),
    customers: finalizeAggregate(customers).slice(0, 20),
  };
}

/**
 * Unified operational payment centre. Payments are the source of truth for
 * actionable records; accounting documents fill historical gaps only. That
 * keeps open links visible without counting the same iCount receipt twice.
 */
export function buildPaymentsReport({
  documents = [],
  lines = [],
  paymentEvents = [],
  payments = [],
  posSales = [],
  registrations = [],
  activities = [],
  parents = [],
  students = [],
  customerPasses = [],
  from,
  to,
} = {}) {
  const linesByDocument = new Map();
  for (const line of lines) {
    const key = String(line.document_id || '');
    const rows = linesByDocument.get(key) || [];
    rows.push(line);
    linesByDocument.set(key, rows);
  }
  const eventsByDocument = new Map();
  for (const event of paymentEvents) {
    const key = String(event.document_id || '');
    const rows = eventsByDocument.get(key) || [];
    rows.push(event);
    eventsByDocument.set(key, rows);
  }

  const uniqueDocuments = uniqueFinanceDocuments(documents, linesByDocument);
  const documentByNumber = new Map();
  uniqueDocuments.forEach((document) => {
    if (!document.docnum) return;
    const key = String(document.docnum);
    const rows = documentByNumber.get(key) || [];
    rows.push(document);
    documentByNumber.set(key, rows);
  });
  const saleById = new Map(posSales.map((sale) => [String(sale.id), sale]));
  const saleByPayment = new Map(posSales.filter((sale) => sale.payment_id).map((sale) => [String(sale.payment_id), sale]));
  const parentById = new Map(parents.map((parent) => [String(parent.id), parent]));
  const studentById = new Map(students.map((student) => [String(student.id), student]));
  const activityById = new Map(activities.map((activity) => [String(activity.id), activity]));
  const registrationsByPayment = new Map();
  const registrationsByActivity = new Map();
  for (const registration of registrations) {
    if (registration.activity_id) {
      const activityKey = String(registration.activity_id);
      const activityRows = registrationsByActivity.get(activityKey) || [];
      activityRows.push(registration);
      registrationsByActivity.set(activityKey, activityRows);
    }
    if (!registration.payment_id) continue;
    const key = String(registration.payment_id);
    const rows = registrationsByPayment.get(key) || [];
    rows.push(registration);
    registrationsByPayment.set(key, rows);
  }
  const hostActivityByPayment = new Map(activities
    .filter((activity) => activity.host_payment_id)
    .map((activity) => [String(activity.host_payment_id), activity]));
  const passSaleIds = new Set(customerPasses.map((pass) => String(pass.sale_id || '')).filter(Boolean));

  const rows = [];
  const claimedDocuments = new Set();
  const paymentGroups = new Map();
  for (const candidate of payments) {
    const candidateSale = (candidate.pos_sale_id && saleById.get(String(candidate.pos_sale_id)))
      || saleByPayment.get(String(candidate.id))
      || null;
    const docnum = candidate.icount_doc_number || candidateSale?.icount_doc_number || '';
    const doctype = candidate.icount_doctype || candidateSale?.icount_doctype || 'invrec';
    const key = docnum
      ? `document:${String(doctype).toLowerCase()}:${docnum}`
      : (candidateSale?.id || candidate.pos_sale_id
        ? `sale:${candidateSale?.id || candidate.pos_sale_id}`
        : `payment:${candidate.id}`);
    const score = operationalStatusScore(candidate.status)
      + (candidateSale ? 30 : 0)
      + (candidate.pos_sale_id ? 15 : 0)
      + (candidate.icount_doc_number ? 6 : 0)
      + (candidate.payment_url ? 2 : 0);
    const current = paymentGroups.get(key);
    if (!current) {
      paymentGroups.set(key, { payment: candidate, sale: candidateSale, score });
      continue;
    }
    const candidateWins = score > current.score;
    const preferred = candidateWins ? candidate : current.payment;
    const fallback = candidateWins ? current.payment : candidate;
    paymentGroups.set(key, {
      payment: mergeMeaningful(fallback, preferred),
      sale: candidateWins ? (candidateSale || current.sale) : (current.sale || candidateSale),
      score: Math.max(score, current.score),
    });
  }
  const paymentRows = [...paymentGroups.values()]
    .sort((a, b) => String(b.payment.created_at || '').localeCompare(String(a.payment.created_at || '')));

  for (const paymentEntry of paymentRows) {
    const payment = paymentEntry.payment;
    const sale = paymentEntry.sale;
    const matchingDocuments = payment.icount_doc_number
      ? documentByNumber.get(String(payment.icount_doc_number)) || []
      : [];
    const documentCandidates = uniqueFinanceDocuments(matchingDocuments, linesByDocument);
    const document = documentCandidates.find((candidate) => classifyDocument(candidate.doctype, {
      isStorno: candidate.is_storno,
      total: candidate.total_gross,
    }).sign > 0) || documentCandidates[0] || null;

    const date = israelDate(payment.paid_at || payment.completed_at || payment.created_at || payment.updated_at || document?.document_date);
    // חוב פתוח הוא מלאי, לא תזרים: הוא מוצג תמיד, בלי קשר לטווח התאריכים —
    // סינון של השבוע הנוכחי אסור לו להעלים חוב שנוצר לפני שבועיים.
    const explicitRefund = Number(payment.refund_amount ?? sale?.refund_amount ?? 0);
    const status = normalizePaymentStatus(payment.status || sale?.status, {
      amount: payment.amount ?? sale?.total,
      refundAmount: explicitRefund,
    });
    const debt = OPEN_PAYMENT_STATUSES.has(status)
      ? openDebtClassification({
        payment,
        sale,
        registrations: registrationsByPayment.get(String(payment.id)) || [],
      })
      : { is_debt: false, debt_reason: '' };
    const isOpenDebt = debt.is_debt && OPEN_PAYMENT_STATUSES.has(status);
    if (!isOpenDebt && !dateInRange(date, from, to)) continue;
    if (document) claimedDocuments.add(financeDocumentKey(document));
    const refundDocumentNumber = payment.refund_doc_number || sale?.refund_doc_number || '';
    if (refundDocumentNumber) {
      const matchingRefundDocuments = uniqueFinanceDocuments(
        documentByNumber.get(String(refundDocumentNumber)) || [],
        linesByDocument,
      );
      matchingRefundDocuments
        .filter((candidate) => classifyDocument(candidate.doctype, {
          isStorno: candidate.is_storno,
          total: candidate.total_gross,
        }).sign < 0)
        .forEach((candidate) => claimedDocuments.add(financeDocumentKey(candidate)));
    }

    const linkedActivities = [...new Map([
      ...(hostActivityByPayment.get(String(payment.id)) ? [hostActivityByPayment.get(String(payment.id))] : []),
      ...(payment.activity_id && activityById.get(String(payment.activity_id)) ? [activityById.get(String(payment.activity_id))] : []),
      ...(registrationsByPayment.get(String(payment.id)) || [])
        .map((registration) => activityById.get(String(registration.activity_id)))
        .filter(Boolean),
    ].map((activity) => [String(activity.id), activity])).values()];
    const parent = parentById.get(String(payment.parent_id || sale?.parent_id || '')) || null;
    const student = studentById.get(String(payment.student_id || sale?.student_id || '')) || null;
    const detailRows = sale?.items?.length
      ? sale.items
      : (document ? (linesByDocument.get(String(document.id)) || []) : []);
    const items = detailRows.length
      ? detailRows.map((item) => normalizedItem(item))
      : (payment.description ? [normalizedItem({ description: payment.description, amount: payment.amount })] : []);
    const amounts = paymentRowAmounts(status, payment.amount ?? sale?.total ?? document?.total_gross, explicitRefund);
    const customerId = payment.parent_id || sale?.parent_id || document?.client_id || null;
    const paymentMethod = operationalPaymentMethod(payment, sale);

    rows.push({
      in_period: dateInRange(date, from, to),
      id: `payment:${payment.id}`,
      payment_id: payment.id,
      sale_id: sale?.id || payment.pos_sale_id || null,
      date,
      created_at: payment.created_at || sale?.created_at || payment.paid_at || null,
      paid_at: payment.paid_at || payment.completed_at || null,
      customer_id: customerId,
      customer_name: parent?.name || sale?.customer_name || document?.client_name || student?.name || 'לקוח ללא שם',
      customer_phone: parent?.phone || sale?.customer_phone || student?.phone || '',
      customer_email: parent?.email || sale?.customer_email || student?.email || '',
      student_id: payment.student_id || sale?.student_id || null,
      student_name: student?.name || '',
      icount_client_id: payment.icount_client_id || sale?.icount_client_id || parent?.icount_client_id || document?.client_id || null,
      description: payment.description || items.map((item) => item.name).join(', ') || 'תשלום',
      items,
      product_names: items.map((item) => item.name),
      activity_ids: linkedActivities.map((activity) => activity.id),
      activities: linkedActivities.map((activity) => activity.name || 'אירוע ללא שם'),
      source: paymentSource(payment, sale, linkedActivities),
      payment_method: paymentMethod || (document ? eventsByDocument.get(String(document.id))?.[0]?.method : '') || '',
      payment_method_label: paymentMethodLabel(paymentMethod || (document ? eventsByDocument.get(String(document.id))?.[0]?.method : '')),
      status,
      original_status: payment.status || sale?.status || '',
      ...debt,
      ...amounts,
      document_number: payment.icount_doc_number || sale?.icount_doc_number || document?.docnum || '',
      document_type: payment.icount_doctype || sale?.icount_doctype || document?.doctype || 'invrec',
      document_id: payment.icount_doc_id || sale?.icount_doc_id || null,
      document_url: payment.icount_doc_url || sale?.icount_doc_url || document?.source_url || null,
      refund_document_number: refundDocumentNumber,
      refund_document_url: payment.refund_doc_url || sale?.refund_doc_url || null,
      payment_url: payment.payment_url || sale?.payment_url || '',
      sold_by: sale?.sold_by || payment.created_by || '',
      confirmation_code: payment.cc_confirmation_code || sale?.cc_confirmation_code || '',
      card_last4: payment.cc_last4 || sale?.cc_last4 || '',
      has_passes: !!payment.pos_sale_id && passSaleIds.has(String(payment.pos_sale_id)),
      equipment_payment: !!(
        payment.equipment_checkout_token || payment.equipment_payment || payment.equipment_family_payment || payment.equipment_shoes_upgrade
      ),
      equipment_policy_refund: !!payment.equipment_checkout_token,
      refund_reason: payment.refund_reason || sale?.refund_reason || '',
      refunded_at: payment.refunded_at || sale?.refunded_at || null,
      accounting_only: false,
    });
  }

  // The hosted-event debt exists when the event is booked, not when the host
  // happens to open the payment page. Build the missing receivable directly
  // from the activity so an untouched link cannot hide a real debt.
  // הבדיקה מול כל התשלומים במערכת — לא רק אלה שעברו את סינון התאריך — אחרת
  // תשלום פתוח שמחוץ לטווח היה גם נעלם וגם חוסם את השורה הסינתטית.
  const paymentIdsInSystem = new Set(payments.map((payment) => String(payment.id)));
  for (const activity of activities) {
    if (activity.host_payment_id && paymentIdsInSystem.has(String(activity.host_payment_id))) continue;
    // חוב פתוח מוצג תמיד; התאריך (יום האירוע) נשאר לתצוגה בלבד.
    const date = String(activity.date || activity.created_at || '').slice(0, 10);
    const activityRegistrations = registrationsByActivity.get(String(activity.id)) || [];
    const debt = unpaidHostActivityDebt(activity, activityRegistrations);
    if (!debt) continue;
    const parent = parentById.get(String(activity.host_parent_id || '')) || null;
    const amount = debt.amount;
    rows.push({
      in_period: dateInRange(date, from, to),
      id: `activity-debt:${activity.id}`,
      payment_id: null,
      sale_id: null,
      date,
      created_at: activity.updated_at || activity.created_at || `${date}T00:00:00`,
      paid_at: null,
      customer_id: activity.host_parent_id || null,
      customer_name: parent?.name || activity.host_name || activity.contact_name || 'מזמין לא משויך',
      customer_phone: parent?.phone || activity.host_phone || activity.contact_phone || '',
      customer_email: parent?.email || activity.host_email || '',
      student_id: null,
      student_name: '',
      icount_client_id: parent?.icount_client_id || null,
      description: `תשלום אירוע: ${activity.name || 'אירוע'}`,
      items: [{ id: activity.id, name: activity.name || 'אירוע', quantity: 1, unit_price: amount, total: amount }],
      product_names: [activity.name || 'אירוע'],
      activity_ids: [activity.id],
      activities: [activity.name || 'אירוע'],
      source: 'activity',
      payment_method: 'online',
      payment_method_label: paymentMethodLabel('online'),
      status: 'open',
      original_status: activity.payment_status || 'unpaid',
      is_debt: true,
      debt_reason: 'אירוע בהתחייבות המזמין',
      ...paymentRowAmounts('open', amount),
      document_number: '',
      document_type: '',
      document_id: null,
      document_url: null,
      refund_document_number: '',
      refund_document_url: null,
      payment_url: activity.payment_link || '',
      sold_by: '',
      confirmation_code: '',
      card_last4: '',
      has_passes: false,
      equipment_payment: false,
      equipment_policy_refund: false,
      refund_reason: '',
      refunded_at: null,
      accounting_only: false,
    });
  }

  for (const document of uniqueDocuments) {
    const classification = classifyDocument(document.doctype, {
      isStorno: document.is_storno,
      total: document.total_gross,
    });
    if (!classification.recognized || claimedDocuments.has(financeDocumentKey(document))) continue;
    const total = Math.abs(Number(document.total_gross) || 0);
    // חשבונית iCount שטרם נפרעה במלואה היא חוב פתוח — לא "שולם": היתרה
    // נשארת פתוחה, ורק מה שבאמת נגבה נספר כגבייה. חוב מוצג תמיד.
    const isCredit = classification.sign < 0;
    const remaining = isCredit ? 0 : Math.max(0, Math.min(Number(document.remaining_sum) || 0, total));
    if (!(remaining > 0) && !dateInRange(document.document_date, from, to)) continue;
    const documentLines = linesByDocument.get(String(document.id)) || [];
    const events = eventsByDocument.get(String(document.id)) || [];
    const items = documentLines.map((line) => normalizedItem(line));
    const status = isCredit ? 'refunded' : (remaining > 0 ? 'open' : 'paid');
    const amounts = isCredit
      ? paymentRowAmounts('refunded', total, total, { accountingCredit: true })
      : paymentRowAmounts(status, total, 0, { collected: total - remaining });
    rows.push({
      in_period: dateInRange(document.document_date, from, to),
      id: `document:${financeDocumentKey(document)}`,
      payment_id: null,
      sale_id: null,
      date: document.document_date,
      created_at: document.created_at || `${document.document_date}T00:00:00`,
      paid_at: isCredit || remaining > 0 ? null : document.document_date,
      customer_id: document.client_id || null,
      customer_name: document.client_name || 'לקוח ללא שם',
      customer_phone: '',
      customer_email: '',
      student_id: null,
      student_name: '',
      icount_client_id: document.client_id || null,
      description: items.map((item) => item.name).join(', ') || 'מסמך iCount',
      items,
      product_names: items.map((item) => item.name),
      activity_ids: [],
      activities: [],
      source: 'icount',
      payment_method: events[0]?.method || '',
      payment_method_label: events.length
        ? [...new Set(events.map((event) => paymentMethodLabel(event.method)))].join(', ')
        : 'לא ידוע',
      status,
      original_status: status,
      is_debt: remaining > 0,
      debt_reason: remaining > 0 ? 'חשבונית iCount שטרם נפרעה' : '',
      ...amounts,
      document_number: document.docnum || '',
      document_type: document.doctype || '',
      document_id: document.source_id || null,
      document_url: document.source_url || null,
      refund_document_number: '',
      refund_document_url: null,
      payment_url: '',
      sold_by: '',
      confirmation_code: '',
      card_last4: '',
      has_passes: false,
      equipment_payment: false,
      equipment_policy_refund: false,
      refund_reason: '',
      refunded_at: isCredit ? document.document_date : null,
      accounting_only: true,
    });
  }

  const reportRows = rows.filter((row) => !OPEN_PAYMENT_STATUSES.has(row.status) || row.is_debt === true);
  reportRows.sort((a, b) => String(b.created_at || b.date || '').localeCompare(String(a.created_at || a.date || '')));
  const statusCounts = {};
  const methodCounts = {};
  const sourceCounts = {};
  reportRows.forEach((row) => {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    methodCounts[row.payment_method_label] = (methodCounts[row.payment_method_label] || 0) + 1;
    sourceCounts[row.source] = (sourceCounts[row.source] || 0) + 1;
  });

  return {
    summary: summarizePaymentRows(reportRows),
    rows: reportRows,
    filters: {
      statuses: statusCounts,
      payment_methods: methodCounts,
      sources: sourceCounts,
      products: [...new Set(reportRows.flatMap((row) => row.product_names).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')),
      events: [...new Set(reportRows.flatMap((row) => row.activities).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')),
      customers: [...new Map(reportRows.filter((row) => row.customer_name).map((row) => [String(row.customer_id || row.customer_name), {
        id: row.customer_id || null,
        name: row.customer_name,
      }])).values()].sort((a, b) => a.name.localeCompare(b.name, 'he')),
    },
  };
}
