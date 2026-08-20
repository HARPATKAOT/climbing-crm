import fs from 'fs';
import path from 'path';
import { db } from './db.js';
import { supa } from './supa.js';
import { icount } from './icount.js';
import { expenseFingerprint, reconcileExpenses, roundFinance } from './finance.js';

export const NOTION_FINANCE_DATABASES = {
  expenses: process.env.NOTION_EXPENSES_DATABASE_ID || 'deebc501-ec4b-4a81-b2d7-29ea1f53198f',
  suppliers: process.env.NOTION_SUPPLIERS_DATABASE_ID || '5155301f-6ee3-44cf-b064-de1f4deebe59',
};

let activeSync = null;

function notionToken() {
  if (process.env.NOTION_API_TOKEN) return process.env.NOTION_API_TOKEN.trim();
  const candidates = [
    path.resolve(process.cwd(), '../../make-integration/.env'),
    path.resolve(process.cwd(), '../make-integration/.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const match = fs.readFileSync(envPath, 'utf8').match(/^NOTION_API_TOKEN\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return '';
}

async function queryNotionDatabase(databaseId) {
  const token = notionToken();
  if (!token) throw Object.assign(new Error('NOTION_API_TOKEN אינו מוגדר'), { code: 'notion_not_configured' });
  const rows = [];
  let cursor;
  do {
    const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    if (!response.ok) throw new Error(`Notion ${response.status}: ${await response.text()}`);
    const body = await response.json();
    rows.push(...(body.results || []));
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return rows;
}

const property = (page, names) => {
  for (const name of names) if (page?.properties?.[name]) return page.properties[name];
  return null;
};
const richText = (prop) => (prop?.title || prop?.rich_text || []).map((item) => item.plain_text || item.text?.content || '').join('').trim();
const select = (prop) => prop?.select?.name || '';
const multiSelect = (prop) => (prop?.multi_select || []).map((item) => item.name).filter(Boolean);
const relations = (prop) => (prop?.relation || []).map((item) => item.id).filter(Boolean);
const files = (prop) => (prop?.files || []).map((item) => ({ name: item.name || 'מסמך', type: item.type || 'unknown' }));
const pageIdFromRelation = (value) => String(value || '').replace(/-/g, '');

export function normalizeNotionSupplier(page) {
  return {
    id: `notion:${page.id}`,
    source: 'notion',
    source_id: page.id,
    source_url: page.url,
    name: richText(property(page, ['Name', 'שם'])) || 'ספק ללא שם',
    status: select(property(page, ['סטטוס'])),
    supplier_type: select(property(page, ['סוג ספק ', 'סוג ספק'])),
    vat_id: richText(property(page, ['עוסק מורשה'])),
    last_edited_at: page.last_edited_time || null,
  };
}

export function normalizeNotionExpense(page, supplierBySourceId = new Map()) {
  const supplierIds = relations(property(page, ['🚛 ספק', 'ספק']));
  const supplier = supplierIds.map((id) => supplierBySourceId.get(pageIdFromRelation(id))).find(Boolean);
  const amount = property(page, [' סכום', 'סכום'])?.number;
  const date = property(page, ['תאריך'])?.date?.start || null;
  const categories = multiSelect(property(page, ['סיווג הוצאה']));
  const name = richText(property(page, ['שם ', 'שם', 'Name'])) || 'הוצאה ללא שם';
  const row = {
    id: `notion:${page.id}`,
    source: 'notion',
    source_id: page.id,
    source_url: page.url,
    name,
    expense_date: date ? String(date).slice(0, 10) : null,
    amount_gross: amount == null ? null : roundFinance(amount),
    amount_net: null,
    vat_amount: null,
    currency: 'ILS',
    categories,
    supplier_id: supplier?.id || null,
    supplier_name: supplier?.name || richText(property(page, ['שם ספק'])) || '',
    document_number: richText(property(page, ['מספר מסמך'])),
    payment_method: select(property(page, ['תשלום ב ', 'תשלום ב'])),
    card_label: select(property(page, ['שולם בכרטיס ', 'שולם בכרטיס'])),
    sent_to_icount: Boolean(property(page, [''])?.checkbox),
    for_sale: Boolean(property(page, ['למכירה'])?.checkbox),
    attachments: files(property(page, [' חשבונית מס / מסמך', 'חשבונית מס / מסמך'])),
    paid: true,
    last_edited_at: page.last_edited_time || null,
  };
  return { ...row, fingerprint: expenseFingerprint(row) };
}

function loadBundledNotionSnapshot() {
  const directory = path.resolve(process.cwd(), 'data/notion-finance-v2');
  if (!fs.existsSync(directory)) return null;
  const suppliersPath = path.join(directory, 'suppliers.json');
  const expenseFiles = fs.readdirSync(directory).filter((name) => /^expenses-\d+\.json$/.test(name)).sort();
  if (!fs.existsSync(suppliersPath) || !expenseFiles.length) return null;
  const suppliers = JSON.parse(fs.readFileSync(suppliersPath, 'utf8'));
  const expenses = expenseFiles.flatMap((name) => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
  return { suppliers, expenses };
}

function normalizeIcountExpense(row) {
  const gross = Number(row.nis_sum ?? row.expense_sum ?? row.total ?? 0);
  const net = Number(row.expense_sum_exc_vat_nis ?? row.expense_sum_exc_vat ?? gross);
  return {
    id: `icount:${row.expense_id ?? row.id}`,
    source: 'icount',
    source_id: String(row.expense_id ?? row.id),
    name: row.expense_type_name || row.description || 'הוצאה מ־iCount',
    expense_date: String(row.expense_date || row.invoice_date || row.vat_date || '').slice(0, 10),
    amount_gross: roundFinance(gross),
    amount_net: roundFinance(net),
    vat_amount: roundFinance(gross - net),
    currency: row.currency || 'ILS',
    categories: [row.expense_type_name].filter(Boolean),
    supplier_id: row.supplier_id ? `icount:${row.supplier_id}` : null,
    supplier_name: row.supplier_name || row.vendor_name || '',
    document_number: String(row.invoice_num || row.document_number || ''),
    paid: row.paid === true || Number(row.paid) === 1 || Number(row.remainingsum || 0) === 0,
    paid_date: row.paid_date || null,
    is_storno: Boolean(row.is_storno),
  };
}

async function persistCollection(table, rows) {
  db.set(table, rows);
  if (supa.isEnabled()) {
    const result = await supa.upsertMany(table, rows);
    if (!result.ok) throw new Error(result.error || `שמירת ${table} נכשלה`);
  }
}

export async function syncNotionFinance() {
  let suppliers;
  let expenses;
  let mode = 'live';
  try {
    const [supplierPages, expensePages] = await Promise.all([
      queryNotionDatabase(NOTION_FINANCE_DATABASES.suppliers),
      queryNotionDatabase(NOTION_FINANCE_DATABASES.expenses),
    ]);
    suppliers = supplierPages.map(normalizeNotionSupplier);
    const supplierBySourceId = new Map(suppliers.map((row) => [pageIdFromRelation(row.source_id), row]));
    expenses = expensePages.map((page) => normalizeNotionExpense(page, supplierBySourceId));
  } catch (error) {
    const snapshot = loadBundledNotionSnapshot();
    if (!snapshot) throw error;
    ({ suppliers, expenses } = snapshot);
    mode = 'snapshot';
  }
  // מיזוג, לא דריסה: המרכז הפיננסי כותב על שורות הספקים שדות משלו
  // (aliases נלמדים, קטגוריית ברירת מחדל, תנאי תשלום) — סנכרון Notion שרץ
  // כל 15 דקות אסור לו למחוק אותם.
  const existingSuppliers = new Map(db.get('finance_suppliers').map((row) => [String(row.id), row]));
  const mergedSuppliers = suppliers.map((supplier) => {
    const existing = existingSuppliers.get(String(supplier.id));
    if (!existing) return supplier;
    return {
      ...supplier,
      aliases: existing.aliases || supplier.aliases,
      default_category_id: existing.default_category_id ?? supplier.default_category_id ?? null,
      payment_terms: existing.payment_terms ?? supplier.payment_terms ?? null,
      is_recurring: existing.is_recurring ?? supplier.is_recurring ?? false,
      tax_id: existing.tax_id ?? supplier.tax_id,
    };
  });
  const notionIds = new Set(mergedSuppliers.map((row) => String(row.id)));
  const nonNotionSuppliers = db.get('finance_suppliers').filter((row) => !notionIds.has(String(row.id)));
  await persistCollection('finance_suppliers', [...mergedSuppliers, ...nonNotionSuppliers]);
  const existingIcount = db.get('finance_expenses').filter((row) => row.source === 'icount');
  const reconciled = reconcileExpenses([...existingIcount, ...expenses]);
  await persistCollection('finance_expenses', [...existingIcount, ...reconciled]);
  return { suppliers: suppliers.length, expenses: expenses.length, mode };
}

function monthRanges(from, to) {
  const result = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const last = new Date(`${to}T00:00:00Z`);
  cursor.setUTCDate(1);
  while (cursor <= last) {
    const start = cursor.toISOString().slice(0, 10);
    const endDate = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    result.push({ startDate: start, endDate: endDate.toISOString().slice(0, 10) > to ? to : endDate.toISOString().slice(0, 10) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

function normalizeIcountDoc(row, detail = null) {
  const info = detail?.doc_info || detail?.doc || row;
  // רק doc/info מחזיק את נתוני הפירעון. בלעדיו יש בידינו סכום בלבד, ואסור
  // להסיק ממנו ששולם או שלא שולם.
  const hasPaymentDetail = Boolean(detail?.doc_info || detail?.doc);
  const doctype = String(row.doctype || row.doc_type || '').toLowerCase();
  const gross = Number(info.totalwithvat ?? info.total ?? row.total ?? 0);
  const net = Number(info.totalsum ?? info.afterdiscount ?? row.total_before_vat ?? row.total_net ?? gross);
  const paidAmount = Number(info.totalpaid ?? info.paid ?? 0);
  const reportedRemaining = Number(info.remainingsum ?? row.remainingsum);
  return {
    id: `icount:${doctype}:${row.docnum ?? row.doc_num ?? row.doc_id}`,
    source: 'icount',
    source_id: String(row.doc_id ?? ''),
    doctype,
    docnum: String(row.docnum ?? row.doc_num ?? ''),
    document_date: String(info.dateissued || info.doc_date || row.dateissued || row.doc_date || row.date || '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3').slice(0, 10),
    client_id: row.client_id ? String(row.client_id) : null,
    client_name: info.client_name || row.client_name || '',
    total_gross: roundFinance(gross),
    total_net: roundFinance(net),
    vat_amount: roundFinance(gross - net),
    currency: info.currency_code || row.currency_code || row.currency || 'ILS',
    exchange_rate: Number(info.rate || row.rate || 1),
    paid: paidAmount !== 0 || row.paid === true || Number(row.paid) === 1,
    paid_amount: roundFinance(paidAmount),
    payment_status_known: hasPaymentDetail,
    // gross פחות המשולם הוא יתרה אמיתית רק כשידוע כמה שולם. כשה-doc/info לא
    // הגיע, החישוב הזה הפך כל מסמך למלוא סכומו „חוב” — ראו documentOpenBalance.
    remaining_sum: roundFinance(
      Number.isFinite(reportedRemaining)
        ? Math.max(0, reportedRemaining)
        : (hasPaymentDetail ? Math.max(0, gross - paidAmount) : 0)
    ),
    is_storno: Boolean(info.is_cancellation || row.is_cancellation),
    is_cancelled: Boolean(info.is_cancelled || row.is_cancelled),
    source_url: info.doc_url || null,
  };
}

async function mapConcurrency(rows, limit, worker) {
  const output = new Array(rows.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

/**
 * הגבלת קצב אינה תקלה אלא בקשה להאט. המתנה של מאיות שנייה רק שורפת ניסיון
 * נוסף — וכך מסמכים נשמרו בלי פרטי הפירעון שלהם והוצגו כ„חוב פתוח”.
 * משיכה מלאה עוברת מאות חודשים ואלפי מסמכים, ולכן כל קריאה ל-iCount בזרם
 * הזה חייבת לדעת להמתין באמת.
 */
async function icountWithBackoff(call, { attempts = 6, rateLimitOnly = false } = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      lastError = error;
      const rateLimited = error?.code === 'rate_limited';
      // „יותר מדי תוצאות” נפתר בחלוקת הטווח, לא בהמתנה — המתקשר מטפל בו.
      if (attempt >= attempts - 1 || (rateLimitOnly && !rateLimited)) break;
      await new Promise((resolve) => setTimeout(resolve, rateLimited ? 3000 * (attempt + 1) : 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function docInfoWithRetry(row) {
  return icountWithBackoff(() => icount.getDocInfo({ doctype: row.doctype, docnum: row.docnum }));
}

function normalizePaymentList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function docDetailRecords(row, detail) {
  const info = detail?.doc_info || detail?.doc || {};
  const document = normalizeIcountDoc(row, detail);
  const lines = (info.items || []).map((item, index) => {
    const quantity = Number(item.quantity) || 1;
    const unitNet = Number(item.unitprice) || 0;
    const taxRate = Number(item.tax_rate ?? item.taxes?.[0] ?? info.vat_percent ?? 0);
    const lineNet = unitNet * quantity;
    return {
      id: `${document.id}:line:${index + 1}`,
      document_id: document.id,
      line_number: index + 1,
      item_id: item.item_id ? String(item.item_id) : null,
      inventory_item_id: item.inventory_item_id ? String(item.inventory_item_id) : null,
      sku: item.sku || '',
      description: item.description || '',
      quantity,
      unit_price_net: roundFinance(unitNet),
      line_net: roundFinance(lineNet),
      vat_amount: roundFinance(lineNet * taxRate / 100),
      line_gross: roundFinance(lineNet * (1 + taxRate / 100)),
      income_type: item.income_type_id ? String(item.income_type_id) : null,
    };
  });
  const payments = [];
  for (const [method, values] of [
    ['credit_card', info.cc], ['cash', info.cash], ['bank_transfer', info.banktransfer],
    ['cheque', info.cheques], ['paypal', info.paypal], ['barter', info.barter],
  ]) {
    normalizePaymentList(values).forEach((payment, index) => {
      const amount = Number(payment?.sum ?? payment?.amount ?? 0);
      if (!amount) return;
      const cardDigits = String(payment?.card_number || '').replace(/\D/g, '');
      payments.push({
        id: `${document.id}:payment:${method}:${index + 1}`,
        document_id: document.id,
        source: 'icount',
        payment_date: String(payment?.date || document.document_date).slice(0, 10),
        method,
        amount: roundFinance(amount),
        currency: document.currency,
        card_last4: cardDigits ? cardDigits.slice(-4) : null,
        confirmation_code: payment?.confirmation_code ? String(payment.confirmation_code) : null,
        is_refund: amount < 0 || document.is_storno,
      });
    });
  }
  return { document, lines, payments };
}

async function searchAdaptive(search, startDate, endDate) {
  try {
    return await icountWithBackoff(() => search({ startDate, endDate }), { rateLimitOnly: true });
  } catch (error) {
    if (!/יותר מדי תוצאות|too many results/i.test(error.message || '') || startDate >= endDate) throw error;
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const middle = new Date((start.getTime() + end.getTime()) / 2);
    const leftEnd = middle.toISOString().slice(0, 10);
    const rightStartDate = new Date(`${leftEnd}T00:00:00Z`);
    rightStartDate.setUTCDate(rightStartDate.getUTCDate() + 1);
    const rightStart = rightStartDate.toISOString().slice(0, 10);
    const [left, right] = await Promise.all([
      searchAdaptive(search, startDate, leftEnd),
      searchAdaptive(search, rightStart, endDate),
    ]);
    return [...left, ...right];
  }
}

export async function syncIcountFinance({ from = '2010-01-01', to = new Date().toISOString().slice(0, 10) } = {}) {
  const rawDocs = [];
  const expenses = [];
  for (const range of monthRanges(from, to)) {
    const [monthDocs, monthExpenses] = await Promise.all([
      searchAdaptive(icount.searchDocs, range.startDate, range.endDate),
      searchAdaptive(icount.searchExpenses, range.startDate, range.endDate),
    ]);
    rawDocs.push(...monthDocs);
    expenses.push(...monthExpenses.map(normalizeIcountExpense));
  }
  const uniqueRawDocs = [...new Map(rawDocs.map((row) => [`${row.doctype}:${row.docnum}`, row])).values()];
  const detailSets = await mapConcurrency(uniqueRawDocs, 1, async (row) => {
    try {
      const detail = await docInfoWithRetry(row);
      return docDetailRecords(row, detail);
    } catch (error) {
      return { document: normalizeIcountDoc(row), lines: [], payments: [], detail_error: error.message };
    }
  });
  const fetchedDocs = detailSets.map((set) => set.document);
  const fetchedLines = detailSets.flatMap((set) => set.lines);
  const fetchedPayments = detailSets.flatMap((set) => set.payments);
  const previousDocs = from <= '2010-01-01' ? [] : db.get('finance_documents').filter((row) => !dateInSyncRange(row.document_date, from, to));
  const previousLines = from <= '2010-01-01' ? [] : db.get('finance_document_lines').filter((row) => previousDocs.some((doc) => doc.id === row.document_id));
  const previousPayments = from <= '2010-01-01' ? [] : db.get('finance_payment_events').filter((row) => previousDocs.some((doc) => doc.id === row.document_id));
  const uniqueDocs = [...new Map([...previousDocs, ...fetchedDocs].map((row) => [row.id, row])).values()];
  const previousIcountExpenses = from <= '2010-01-01'
    ? []
    : db.get('finance_expenses').filter((row) => row.source === 'icount' && !dateInSyncRange(row.expense_date, from, to));
  const uniqueExpenses = [...new Map([...previousIcountExpenses, ...expenses].map((row) => [row.id, row])).values()];
  const existingNotion = db.get('finance_expenses').filter((row) => row.source === 'notion');
  const reconciledNotion = reconcileExpenses([...uniqueExpenses, ...existingNotion]);
  await persistCollection('finance_documents', uniqueDocs);
  await persistCollection('finance_document_lines', [...previousLines, ...fetchedLines]);
  await persistCollection('finance_payment_events', [...previousPayments, ...fetchedPayments]);
  await persistCollection('finance_expenses', [...uniqueExpenses, ...reconciledNotion]);
  return { documents: uniqueDocs.length, lines: fetchedLines.length, payments: fetchedPayments.length, expenses: uniqueExpenses.length };
}

function dateInSyncRange(value, from, to) {
  const date = String(value || '').slice(0, 10);
  return date && date >= from && date <= to;
}

export function financeSyncStatus() {
  const runs = db.get('finance_sync_runs');
  return {
    running: Boolean(activeSync),
    notionConfigured: Boolean(notionToken() || loadBundledNotionSnapshot()),
    icountConfigured: icount.isConfigured(),
    lastRun: runs.slice().sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0] || null,
    counts: {
      documents: db.get('finance_documents').length,
      // מסמכים שלא נמשכו עבורם פרטי פירעון. אלה לא נספרים כחוב (ראו
      // documentOpenBalance), ולכן חוב אמיתי שביניהם עדיין לא מוצג —
      // משיכה מלאה מאפסת את המספר הזה.
      documents_without_payment_detail: db.get('finance_documents')
        .filter((row) => row.source === 'icount' && row.payment_status_known !== true).length,
      expenses: db.get('finance_expenses').length,
      suppliers: db.get('finance_suppliers').length,
    },
  };
}

export async function runFinanceSync({ full = false, sources = ['notion', 'icount'], days = 45 } = {}) {
  if (activeSync) return activeSync;
  const run = {
    id: `finance-sync-${Date.now()}`,
    started_at: new Date().toISOString(),
    status: 'running',
    full: Boolean(full),
    window_days: full ? null : Math.max(1, days),
    sources,
    results: {},
    errors: [],
  };
  db.insert('finance_sync_runs', run);
  activeSync = (async () => {
    try {
      if (sources.includes('notion')) {
        try { run.results.notion = await syncNotionFinance(); }
        catch (error) { run.errors.push({ source: 'notion', message: error.message }); }
      }
      if (sources.includes('icount')) {
        const to = new Date().toISOString().slice(0, 10);
        const from = full ? '2010-01-01' : new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
        try { run.results.icount = await syncIcountFinance({ from, to }); }
        catch (error) { run.errors.push({ source: 'icount', message: error.message }); }
      }
      run.status = run.errors.length ? (Object.keys(run.results).length ? 'partial' : 'failed') : 'completed';
      run.finished_at = new Date().toISOString();
      db.update('finance_sync_runs', run.id, run);
      return run;
    } finally {
      activeSync = null;
    }
  })();
  return activeSync;
}
