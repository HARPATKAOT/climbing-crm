/**
 * iCount API v3 client
 * Auth: Bearer token from ICOUNT_API_TOKEN
 * Body: application/x-www-form-urlencoded (not JSON)
 */

import { VAT_RATE, chargeAmount, icountVatType, roundMoney } from './vat.js';

const BASE_URL = 'https://api.icount.co.il/api/v3.php';

function getToken() {
  return (
    process.env.ICOUNT_API_TOKEN ||
    process.env.ICOUNT_API_KEY ||
    ''
  ).trim();
}

function getPayPage() {
  return (process.env.ICOUNT_PAY_PAGE || process.env.ICOUNT_PAY_PAGE_ID || '45')
    .trim()
    .replace(/^\//, '');
}

function getPayBaseUrl() {
  return (
    process.env.ICOUNT_PAY_BASE_URL ||
    'https://app.icount.co.il/m'
  )
    .trim()
    .replace(/\/$/, '');
}

let _payPageUrlCache = { key: null, url: null, at: 0 };

/**
 * Resolve the real iCount payment-page base URL (no query string).
 * Prefers ICOUNT_PAY_PAGE_URL; otherwise looks up paypage/get_list by id/slug.
 */
export async function resolvePayPageUrl() {
  const fullOverride = (process.env.ICOUNT_PAY_PAGE_URL || '').trim().replace(/\/$/, '');
  if (fullOverride) return fullOverride;

  const key = getPayPage();

  const now = Date.now();
  if (_payPageUrlCache.key === key && _payPageUrlCache.url && now - _payPageUrlCache.at < 5 * 60 * 1000) {
    return _payPageUrlCache.url;
  }

  // Already a full URL
  if (/^https?:\/\//i.test(key)) {
    _payPageUrlCache = { key, url: key.replace(/\/$/, ''), at: now };
    return _payPageUrlCache.url;
  }

  // Numeric page id or slug — resolve via iCount so we never invent dead hosts
  try {
    const data = await icountPost('paypage/get_list', {});
    const pages = data.paypages || {};
    const list = Object.values(pages);
    let match =
      pages[key] ||
      list.find((p) => String(p.page_id) === String(key)) ||
      list.find((p) => {
        const url = String(p.page_url || '');
        const slug = url.split('/').pop();
        return slug === key || url.endsWith(`/m/${key}`);
      });

    if (match?.page_url) {
      const url = String(match.page_url).replace(/\/$/, '');
      _payPageUrlCache = { key, url, at: now };
      return url;
    }
  } catch (err) {
    console.warn('⚠️ [iCount] paypage/get_list failed, falling back to constructed URL:', err.message);
  }

  // Fallback: app.icount.co.il/m/{slug-or-id}
  const url = `${getPayBaseUrl()}/${key}`;
  _payPageUrlCache = { key, url, at: now };
  return url;
}

export function isConfigured() {
  return !!getToken();
}

export async function icountPost(endpoint, fields = {}) {
  const token = getToken();
  if (!token) {
    const err = new Error('ICOUNT_API_TOKEN is not configured');
    err.code = 'not_configured';
    throw err;
  }

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }

  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    const err = new Error(`iCount returned non-JSON (${res.status})`);
    err.code = 'bad_response';
    throw err;
  }

  if (!data?.status) {
    const err = new Error(
      data?.error_description || data?.reason || 'iCount API error'
    );
    err.code = data?.reason || 'api_error';
    err.details = data;
    throw err;
  }

  return data;
}

export async function ping() {
  const data = await icountPost('client/get_list');
  return {
    ok: true,
    clientsCount: Number(data.clients_count || 0),
  };
}

function todayYyyymmdd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toYyyymmdd(dateStr) {
  if (!dateStr) return todayYyyymmdd();
  const cleaned = String(dateStr).replace(/-/g, '').slice(0, 8);
  if (/^\d{8}$/.test(cleaned)) return cleaned;
  return todayYyyymmdd();
}

/** כל תיקי הלקוחות ב-iCount, כמפה של client_id → תיק. */
export async function listClients() {
  const data = await icountPost('client/get_list');
  return data.clients || {};
}

/** פרטי תיק לקוח יחיד — get_list מחזיר שם ומייל בלבד, בלי טלפון. */
export async function getClientInfo(clientId) {
  const data = await icountPost('client/info', { client_id: clientId });
  return data?.client_info || data?.client || data || null;
}

/** Find client by custom_client_id (CRM parent id) among get_list results */
export async function findClientByCustomId(customClientId) {
  const data = await icountPost('client/get_list');
  const clients = data.clients || {};
  for (const client of Object.values(clients)) {
    if (String(client.custom_client_id || '') === String(customClientId)) {
      return client;
    }
  }
  return null;
}

/**
 * Ensure parent exists as an iCount client.
 * Returns { clientId, created }
 */
export async function ensureClient(parent) {
  if (!parent?.id) throw new Error('parent.id required');

  if (parent.icount_client_id) {
    try {
      await icountPost('client/info', { client_id: parent.icount_client_id });
      await icountPost('client/update', {
        client_id: parent.icount_client_id,
        client_name: parent.name || 'לקוח',
        phone: parent.phone || '',
        mobile: parent.phone || '',
        email: parent.email || '',
        custom_client_id: parent.id,
      });
      return { clientId: String(parent.icount_client_id), created: false };
    } catch {
      // fall through to recreate / find
    }
  }

  const existing = await findClientByCustomId(parent.id);
  if (existing?.client_id) {
    return { clientId: String(existing.client_id), created: false };
  }

  const created = await icountPost('client/create', {
    client_name: parent.name || 'לקוח',
    phone: parent.phone || '',
    mobile: parent.phone || '',
    email: parent.email || '',
    custom_client_id: parent.id,
    notes: parent.notes || '',
  });

  return {
    clientId: String(created.client_id),
    created: true,
  };
}

function buildDocLineFields(items) {
  const fields = {};
  (items || []).forEach((item, i) => {
    fields[`desc[${i}]`] = item.description || item.desc || 'פריט';
    fields[`unitprice[${i}]`] = item.unitprice ?? item.price ?? 0;
    fields[`quantity[${i}]`] = item.quantity ?? 1;
  });
  return fields;
}

/**
 * The rate and the rounding both come from vat.js — a second copy of the VAT
 * rate here is a second place to forget when the rate changes, and it has
 * already drifted into a second copy of a bug.
 */
const DEFAULT_VAT_RATE = VAT_RATE;

function lineItemsNetTotal(items) {
  return (items || []).reduce((sum, item) => {
    const qty = Number(item.quantity) || 1;
    const price = Number(item.unitprice ?? item.price) || 0;
    return sum + qty * price;
  }, 0);
}



/**
 * Create tax invoice + receipt (חשבונית מס קבלה)
 * items: [{ description, unitprice, quantity? }]
 * paymentMethod: cash | emv | credit | online (default cash)
 *
 * iCount requires an explicit payment line for invrec:
 *   cash[sum]=AMOUNT  OR  cc[0][sum]=amount
 */
export async function createInvRec({
  clientId,
  clientName,
  items,
  comment,
  emailTo,
  paymentMethod = 'cash',
  vattype = icountVatType(),
  vatRate = DEFAULT_VAT_RATE,
}) {
  const fields = {
    doctype: 'invrec',
    doc_date: todayYyyymmdd(),
    currency: 'ILS',
    vattype,
    ...buildDocLineFields(items),
  };

  if (clientId) fields.client_id = clientId;
  else if (clientName) fields.client_name = clientName;
  else throw new Error('clientId or clientName required');

  if (comment) fields.comment = comment;
  if (emailTo) {
    fields.email_to = emailTo;
    fields.send_email = 1;
  }

  const net = lineItemsNetTotal(items);
  // vattype 1 means the line prices are net, so VAT is added on top. This line
  // used to read `net * (1 + Number(vatRate) || DEFAULT_VAT_RATE)`, where `+`
  // binds tighter than `||` — an unreadable rate made the invoice total 18% of
  // its face value. chargeAmount now owns that arithmetic, and rejects a rate
  // it cannot read rather than inventing one.
  const paid = Number(vattype) === 1
    ? chargeAmount(net, false, vatRate)
    : roundMoney(net);

  const method = String(paymentMethod || 'cash').toLowerCase();
  if (method === 'emv' || method === 'credit' || method === 'cc' || method === 'card') {
    fields['cc[0][sum]'] = paid;
  } else {
    // cash, online confirmation, or unknown → record as cash payment on the document
    fields['cash[sum]'] = paid;
  }

  const result = await icountPost('doc/create', fields);
  return {
    docId: result.doc_id != null ? String(result.doc_id) : null,
    docnum: result.docnum != null ? String(result.docnum) : null,
    docUrl: result.doc_url || result.docurl || null,
    paidAmount: paid,
    raw: result,
  };
}

/**
 * Create price quote (הצעת מחיר)
 */
export async function createOffer({
  clientId,
  clientName,
  items,
  comment,
  emailTo,
  vattype = icountVatType(),
}) {
  const fields = {
    doctype: 'offer',
    doc_date: todayYyyymmdd(),
    currency: 'NIS',
    vattype,
    ...buildDocLineFields(items),
  };

  if (clientId) fields.client_id = clientId;
  else if (clientName) fields.client_name = clientName;
  else throw new Error('clientId or clientName required');

  if (comment) fields.comment = comment;
  if (emailTo) {
    fields.email_to = emailTo;
    fields.send_email = 1;
  }

  const result = await icountPost('doc/create', fields);
  return {
    docId: result.doc_id != null ? String(result.doc_id) : null,
    docnum: result.docnum != null ? String(result.docnum) : null,
    docUrl: result.doc_url || result.docurl || null,
    raw: result,
  };
}

export async function searchDocs({ startDate, endDate } = {}) {
  const end = endDate ? toYyyymmdd(endDate) : todayYyyymmdd();
  let start = startDate ? toYyyymmdd(startDate) : null;
  if (!start) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    start = toYyyymmdd(d.toISOString().slice(0, 10));
  }

  let data;
  try {
    data = await icountPost('doc/search', { start_date: start, end_date: end });
  } catch (error) {
    if (/אין תוצאות|no results/i.test(error.message || '')) return [];
    throw error;
  }

  const list = data.results_list || data.documents || data.docs || [];
  return Array.isArray(list) ? list : Object.values(list);
}

/** Search supplier expenses for a date range. */
export async function searchExpenses({ startDate, endDate } = {}) {
  const end = endDate ? toYyyymmdd(endDate) : todayYyyymmdd();
  const start = startDate ? toYyyymmdd(startDate) : toYyyymmdd(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  let data;
  try {
    data = await icountPost('expense/search', { start_date: start, end_date: end });
  } catch (error) {
    if (/אין תוצאות|no results/i.test(error.message || '')) return [];
    throw error;
  }
  const list = data.results_list || data.expenses || data.results || [];
  return Array.isArray(list) ? list : Object.values(list);
}

export async function getDoc(docId) {
  return icountPost('doc/get', { doc_id: docId });
}

export async function getDocInfo({ doctype, docnum } = {}) {
  return icountPost('doc/info', { doctype, docnum });
}

/**
 * Pull clearing / card fields from doc/info (or IPN-like payload).
 * confirmation_code is the approval number from the terminal/clearing house.
 */
export function extractCcClearing(source = {}) {
  const root = source?.doc_info || source?.doc || source || {};
  const ccList = Array.isArray(root.cc)
    ? root.cc
    : Array.isArray(source?.cc)
      ? source.cc
      : [];
  const first = ccList[0] || null;

  const codeRaw =
    first?.confirmation_code ||
    root.confirmation_code ||
    source?.confirmation_code ||
    source?.cc_confirmation_code ||
    null;
  const last4Raw =
    first?.card_number ||
    root.card_number ||
    source?.card_number ||
    source?.cc_last4 ||
    null;
  const typeRaw =
    first?.card_type ||
    root.card_type ||
    source?.card_type ||
    source?.cc_card_type ||
    null;

  const cc_confirmation_code = codeRaw != null && String(codeRaw).trim()
    ? String(codeRaw).trim()
    : null;
  const digits = last4Raw != null ? String(last4Raw).replace(/\D/g, '') : '';
  const cc_last4 = digits ? digits.slice(-4) : null;
  const cc_card_type = typeRaw != null && String(typeRaw).trim()
    ? String(typeRaw).trim()
    : null;
  const has_cc = !!(
    root.has_cc ||
    source?.has_cc ||
    first ||
    cc_confirmation_code
  );

  return { cc_confirmation_code, cc_last4, cc_card_type, has_cc };
}

/**
 * Cancel / credit an existing document in iCount.
 * Creates a cancellation document linked to the original.
 *
 * refundCc (refund_cc=1): also reverse the card charge on the linked terminal
 * (Max via iCount). Without it, only the accounting document is cancelled.
 */
/**
 * זיכוי חלקי — מה שביטול מסמך שלם לא יודע לעשות.
 *
 * שני הצדדים נפרדים ב-iCount ושניהם נדרשים: `cc/refund` מחזיר כסף לכרטיס,
 * ו-`doc/create` בסוג `refund` מוציא חשבונית זיכוי. אומת ב-8.8.26 שזיכוי
 * חלקי **אינו** יוצר מסמך מעצמו — הכסף חוזר והספרים נשארים בלי רישום — ולכן
 * מי שקורא לכאן חייב את שניהם.
 */

/** מינימום שהסולק אוכף: „סכום החיוב חייב להיות מעל שקל”. */
export const MIN_PARTIAL_REFUND = 1;

/**
 * מזהה החיוב בכרטיס עבור מסמך. אינו מופיע ב-doc/info, ולכן מאתרים אותו
 * ביומן החיובים סביב מועד התשלום.
 *
 * @param {string} docnum מספר המסמך
 * @param {string|Date} around מועד התשלום — היומן נסרק בחלון סביבו
 */
export async function findCcCharge({ docnum, around, windowDays = 3 } = {}) {
  if (!docnum) throw new Error('docnum required');
  const ref = around ? new Date(around) : new Date();
  const day = (offset) => {
    const d = new Date(ref.getTime() + offset * 864e5);
    return d.toISOString().slice(0, 10);
  };
  // `from_date` נדחה עם empty_query — השמות הנכונים הם start_date/end_date.
  const data = await icountPost('cc/transactions', {
    start_date: day(-windowDays),
    end_date: day(windowDays),
  });
  const rows = Array.isArray(data?.results_list) ? data.results_list : [];
  const match = rows.find((row) => String(row.docnumber) === String(docnum));
  if (!match) return null;
  return {
    ccBillLogId: String(match.cc_bill_log_id),
    charged: Number(match.cctotal) || 0,
    alreadyRefunded: String(match.refunded || '0') !== '0',
    confirmationCode: match.confirmation_code || null,
    cardLast4: match.cc_cardnumber || null,
  };
}

/** מחזיר סכום לכרטיס. `sum` חובה — בלעדיו עלול לזכות את החיוב במלואו. */
export async function refundCcAmount({ ccBillLogId, sum } = {}) {
  if (!ccBillLogId) throw new Error('ccBillLogId required');
  const amount = Number(sum);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('sum required');
  if (amount < MIN_PARTIAL_REFUND) {
    const err = new Error('סכום הזיכוי חייב להיות מעל שקל');
    err.code = 'below_min_refund';
    throw err;
  }
  const data = await icountPost('cc/refund', { cc_bill_log_id: ccBillLogId, sum: amount });
  return {
    confirmationCode: data.confirmation_code || null,
    refundType: data.refund_type || null,
    refundAmount: Number(data.refund_amount) || amount,
    remainingAmount: Number(data.remaining_amount) || 0,
    raw: data,
  };
}

/**
 * חשבונית זיכוי על הסכום שהוחזר. הסכומים כאן הם ברוטו — מה שבאמת חזר לכרטיס —
 * ולכן `vattype: 0`, אחרת המע״מ היה נוסף פעם שנייה על סכום שכבר כולל אותו.
 */
export async function createRefundDoc({
  clientId,
  clientName,
  amount,
  description,
  comment,
  emailTo,
} = {}) {
  const gross = Number(amount);
  if (!Number.isFinite(gross) || gross <= 0) throw new Error('amount required');
  const fields = {
    doctype: 'refund',
    doc_date: todayYyyymmdd(),
    currency: 'ILS',
    vattype: 0,
    ...buildDocLineFields([{ description: description || 'זיכוי', unitprice: gross, quantity: 1 }]),
  };
  if (clientId) fields.client_id = clientId;
  else if (clientName) fields.client_name = clientName;
  else throw new Error('clientId or clientName required');
  if (comment) fields.comment = comment;
  if (emailTo) {
    fields.email_to = emailTo;
    fields.send_email = 1;
  }
  const result = await icountPost('doc/create', fields);
  return {
    docId: result.doc_id != null ? String(result.doc_id) : null,
    docnum: result.docnum != null ? String(result.docnum) : null,
    docUrl: result.doc_url || result.docurl || null,
    amount: gross,
    raw: result,
  };
}

export async function cancelDoc({
  doctype = 'invrec',
  docnum,
  reason,
  refundCc = false,
} = {}) {
  if (!docnum) throw new Error('docnum required');
  const fields = {
    doctype,
    docnum,
    refund_cc: refundCc ? 1 : 0,
  };
  if (reason) {
    fields.cancellation_reason = reason;
    fields.reason = reason;
  }
  const data = await icountPost('doc/cancel', fields);
  return {
    doctype: data.cancellation_doctype || doctype,
    docnum: data.cancellation_docnum || data.docnum || null,
    docUrl:
      data.cancellation_doc_url ||
      data.doc_url ||
      data.docurl ||
      null,
    raw: data,
  };
}

/**
 * Build iCount payment-page URL.
 * After successful payment, iCount issues the document configured on the page
 * (typically חשבונית מס קבלה) and can notify us via ipn_url.
 *
 * Custom fields with m__ prefix are echoed back on the IPN without the prefix.
 *
 * pageKind:
 *   - default: intro / general pay page (ICOUNT_PAY_PAGE_URL)
 *   - event: dedicated events page when ICOUNT_EVENT_PAY_PAGE_URL is set
 */
export async function buildPaymentUrl({
  amount,
  description,
  name,
  lastName,
  idNumber,
  phone,
  email,
  paymentId,
  ipnUrl,
  successUrl,
  failureUrl,
  cancelUrl,
  pageKind = 'default',
} = {}) {
  const eventOverride = (process.env.ICOUNT_EVENT_PAY_PAGE_URL || '').trim().replace(/\/$/, '');
  const base =
    pageKind === 'event' && eventOverride
      ? eventOverride
      : await resolvePayPageUrl();
  const params = new URLSearchParams();
  if (amount != null && amount !== '') params.set('cs', String(amount));
  if (description) params.set('cd', description);
  const fullName = String(name || '').trim();
  let familyName = String(lastName || '').trim();
  let firstName = fullName;
  if (familyName) {
    const suffix = ` ${familyName}`;
    if (firstName.endsWith(suffix)) firstName = firstName.slice(0, -suffix.length).trim();
  } else {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      familyName = parts.pop();
      firstName = parts.join(' ');
    }
  }
  if (fullName) params.set('full_name', fullName);
  if (firstName) params.set('ccfname', firstName);
  if (familyName) params.set('cclname', familyName);
  const cleanIdNumber = String(idNumber || '').replace(/\D/g, '');
  if (cleanIdNumber) {
    params.set('ccid', cleanIdNumber);
  }
  if (phone) {
    const clean = String(phone).replace(/[-\s]/g, '');
    if (clean) params.set('contact_phone', clean);
  }
  if (email) params.set('contact_email', String(email).trim());
  if (paymentId) params.set('m__payment_id', String(paymentId));
  if (ipnUrl) params.set('ipn_url', ipnUrl);
  if (successUrl) params.set('success_url', successUrl);
  if (failureUrl) params.set('failure_url', failureUrl);
  if (cancelUrl) params.set('cancel_url', cancelUrl);
  return `${base}?${params.toString()}`;
}

const LIVE_API_BASE = 'https://climbing-crm-api.onrender.com';

export function isLocalHostname(hostname) {
  const host = String(hostname || '')
    .trim()
    .toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Public base used for short payment redirects / IPN callbacks.
 * Honors PUBLIC_API_URL / RENDER_EXTERNAL_URL; otherwise matches the current environment
 * (localhost in local dev, live API in production).
 * Meta WhatsApp template buttons are still fixed to the live host — see isLocalPublicApiBase.
 */
export function getPublicApiBase() {
  const explicit = String(
    process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || ''
  )
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;

  if (process.env.NODE_ENV === 'production') return LIVE_API_BASE;

  const port = process.env.PORT || 5000;
  return `http://localhost:${port}`;
}

/** True when short /r/ links would point at this machine (not reachable from customer phones). */
export function isLocalPublicApiBase() {
  try {
    return isLocalHostname(new URL(getPublicApiBase()).hostname);
  } catch {
    return true;
  }
}

export function getPaymentRedirectBase() {
  return getPublicApiBase();
}

export function buildPaymentRedirectUrl(paymentId) {
  if (!paymentId) return '';
  return `${getPaymentRedirectBase()}/r/${encodeURIComponent(String(paymentId))}`;
}

/** Default Meta template name for POS payment links. */
export function getPaymentTemplateName() {
  return (process.env.WA_PAYMENT_TEMPLATE || 'payment_link').trim();
}

/** Server-to-server notify URL after payment-page success (IPN). */
export function buildIpnUrl({ paymentId } = {}) {
  const base = getPublicApiBase();
  const secret = (process.env.ICOUNT_WEBHOOK_SECRET || '').trim();
  const params = new URLSearchParams();
  if (secret) params.set('secret', secret);
  if (paymentId) params.set('payment_id', String(paymentId));
  const qs = params.toString();
  return `${base}/api/icount/webhook${qs ? `?${qs}` : ''}`;
}

/**
 * Inventory module is not exposed on this iCount account (all inventory/* methods fail).
 * Local pricelist.stock_qty is the source of truth until the module is enabled.
 */
export async function listInventoryItems() {
  const err = new Error('מודול המלאי ב-iCount לא זמין בחשבון זה');
  err.code = 'inventory_unavailable';
  throw err;
}

export async function updateInventoryQty() {
  const err = new Error('מודול המלאי ב-iCount לא זמין בחשבון זה');
  err.code = 'inventory_unavailable';
  throw err;
}

/**
 * Deep links into the iCount web interface, for work we do not do ourselves —
 * a partial credit, for example, which the API cannot express.
 *
 * The exact paths differ between accounts, so both are templates in the
 * environment. When a template is missing we return null and the button
 * simply does not appear, instead of sending staff to a dead address.
 *
 * Placeholders: {clientId} / {doctype} / {docnum} / {docId}
 */
/** הכתובת שנבדקה בחשבון שלנו; משתנה סביבה גובר עליה אם החשבון ישתנה. */
export const ICOUNT_CLIENT_URL_DEFAULT = 'https://app.icount.co.il/reports/fullclient.php?id={clientId}';

export function clientCardUrl(clientId) {
  const template = (process.env.ICOUNT_CLIENT_URL_TEMPLATE || '').trim() || ICOUNT_CLIENT_URL_DEFAULT;
  if (!clientId) return null;
  return template.replace(/\{clientId\}/g, encodeURIComponent(clientId));
}

export function docAppUrl({ doctype, docnum, docId } = {}) {
  const template = (process.env.ICOUNT_DOC_URL_TEMPLATE || '').trim();
  if (!template || (!docnum && !docId)) return null;
  return template
    .replace(/\{doctype\}/g, encodeURIComponent(doctype || ''))
    .replace(/\{docnum\}/g, encodeURIComponent(docnum || ''))
    .replace(/\{docId\}/g, encodeURIComponent(docId || ''));
}

export const icount = {
  isConfigured,
  ping,
  clientCardUrl,
  docAppUrl,
  ensureClient,
  createInvRec,
  createOffer,
  searchDocs,
  searchExpenses,
  getDoc,
  getDocInfo,
  extractCcClearing,
  cancelDoc,
  findCcCharge,
  refundCcAmount,
  createRefundDoc,
  MIN_PARTIAL_REFUND,
  listInventoryItems,
  updateInventoryQty,
  buildPaymentUrl,
  resolvePayPageUrl,
  buildIpnUrl,
  getPublicApiBase,
  isLocalPublicApiBase,
  isLocalHostname,
  getPaymentRedirectBase,
  buildPaymentRedirectUrl,
  getPaymentTemplateName,
  getPayPage,
  getPayBaseUrl,
  icountPost,
};
