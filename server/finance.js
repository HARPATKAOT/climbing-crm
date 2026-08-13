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
  from,
  to,
} = {}) {
  const linesByDocument = new Map();
  for (const line of lines) {
    const rows = linesByDocument.get(line.document_id) || [];
    rows.push(line);
    linesByDocument.set(line.document_id, rows);
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
  const activityByHostPayment = new Map(activities
    .filter((row) => row.host_payment_id)
    .map((row) => [String(row.host_payment_id), row]));

  const daily = new Map();
  const events = new Map();
  const products = new Map();
  const methods = new Map();
  const customers = new Map();
  const deals = [];

  for (const document of documents) {
    if (!dateInRange(document.document_date, from, to)) continue;
    const classification = classifyDocument(document.doctype, {
      isStorno: document.is_storno,
      total: document.total_gross,
    });
    if (!classification.recognized) continue;
    const amount = roundFinance(Math.abs(Number(document.total_gross) || 0) * classification.sign);
    const linkedPayment = paymentsByDocnum.get(String(document.docnum || '')) || null;
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
      ...registrationsForPayment.map((row) => activityById.get(String(row.activity_id))).filter(Boolean),
    ].map((row) => [String(row.id), row])).values()];
    const documentLines = linesByDocument.get(document.id) || [];
    const eventLabels = linkedActivities.map((row) => row.name || 'אירוע ללא שם');
    const itemLabels = (sale?.items || documentLines)
      .map((row) => row.name || row.description)
      .filter(Boolean);
    const paymentMethods = paymentEventsByDocument.get(document.id) || [];
    const fallbackMethod = linkedPayment?.payment_method || sale?.payment_method || '';

    const deal = {
      id: document.id,
      date: document.document_date,
      document_number: document.docnum || '',
      doctype: document.doctype,
      customer_id: document.client_id || linkedPayment?.parent_id || null,
      customer_name: document.client_name || sale?.customer_name || 'לקוח ללא שם',
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
    })) : documentLines
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
