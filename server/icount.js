/**
 * iCount API v3 client
 * Auth: Bearer token from ICOUNT_API_TOKEN
 * Body: application/x-www-form-urlencoded (not JSON)
 */

import crypto from 'crypto';
import { issuePublicRedirectToken } from './security.js';
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

/**
 * @param {string} endpoint
 * @param {object} [fields]
 * @param {{ timeoutMs?: number }} [options] תקרת זמן לקריאה. רלוונטית לקריאות
 *   שממתינות לאדם — סליקה במסוף EMV היא היחידה כזאת — ולא לשאר ה-API.
 */
export async function icountPost(endpoint, fields = {}, { timeoutMs = 0 } = {}) {
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

  let res;
  try {
    res = await fetch(`${BASE_URL}/${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
    });
  } catch (err) {
    // ניתוק או תום זמן אינם „העסקה נכשלה”: הצד השני אולי סיים בהצלחה ורק
    // התשובה אבדה. הקוד מבדיל בין השניים כדי שמי שקורא לא יסיק מסקנה
    // שאי אפשר להסיק. ראו chargeEmv.
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const wrapped = new Error(
      timedOut
        ? `iCount לא השיב בזמן (${endpoint})`
        : `החיבור ל-iCount נכשל (${endpoint}): ${err?.message || 'שגיאת רשת'}`
    );
    wrapped.code = timedOut ? 'timeout' : 'network';
    wrapped.cause = err;
    throw wrapped;
  }

  const raw = await res.text();
  // כשהקצב גבוה מדי iCount מחזיר טקסט חופשי ("Too may requests"), לא JSON.
  // בלי זיהוי מפורש זה נראה כמו תשובה פגומה, המתקשר מנסה שוב מיד — ונחסם
  // שוב. הקוד שמושך מסמכים בכמות (סנכרון) חייב להבדיל כדי להאט באמת.
  if (res.status === 429 || /too\s+ma\w+\s+requests/i.test(raw)) {
    const err = new Error(`iCount הגביל את קצב הקריאות (${endpoint})`);
    err.code = 'rate_limited';
    throw err;
  }

  let data;
  try {
    data = JSON.parse(raw);
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
export async function listClients(filters = {}) {
  const data = await icountPost('client/get_list', filters);
  return data.clients || {};
}

function normalizeContactPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  if (digits.startsWith('0') && digits.length >= 9) digits = `972${digits.slice(1)}`;
  return digits;
}

export function icountPhoneSearchVariants(value) {
  const raw = String(value || '').replace(/[^\d+]/g, '');
  const normalized = normalizeContactPhone(raw);
  if (!normalized) return [];
  const local = normalized.startsWith('972') ? `0${normalized.slice(3)}` : '';
  return [...new Set([raw.replace(/^\+/, ''), normalized, local].filter(Boolean))];
}

export function exactIcountContactMatches(clients, { phone = '', email = '' } = {}) {
  const wantedPhone = normalizeContactPhone(phone);
  const wantedEmail = String(email || '').trim().toLowerCase();
  const byId = new Map();

  for (const client of clients || []) {
    if (!client?.client_id) continue;
    const phones = [client.phone, client.mobile].map(normalizeContactPhone).filter(Boolean);
    const clientEmail = String(client.email || '').trim().toLowerCase();
    const phoneMatches = wantedPhone && phones.includes(wantedPhone);
    const emailMatches = wantedEmail && clientEmail === wantedEmail;
    if (phoneMatches || emailMatches) byId.set(String(client.client_id), client);
  }

  return [...byId.values()];
}

/** Exact, targeted iCount lookup so an event host can be linked without importing the whole ledger. */
export async function findClientsByContact({ phone = '', email = '' } = {}) {
  const searches = [];
  for (const variant of icountPhoneSearchVariants(phone)) {
    searches.push({ phone: variant });
    searches.push({ mobile: variant });
  }
  if (String(email || '').trim()) searches.push({ email: String(email).trim() });
  if (!searches.length) return [];

  const responses = await Promise.all(searches.map((filter) => listClients({
    ...filter,
    detail_level: 2,
    list_type: 'array',
    limit: 25,
  })));
  const candidates = responses.flatMap((rows) => Object.values(rows || {}));
  return exactIcountContactMatches(candidates, { phone, email });
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

function buildDocLineFields(items, { includesVat = false } = {}) {
  const fields = {};
  (items || []).forEach((item, i) => {
    fields[`items[${i}][description]`] = item.description || item.desc || 'פריט';
    // iCount's current API defines `unitprice` as excluding VAT. `vattype` is a
    // legacy document flag and does not change that field's meaning, so a gross
    // POS price must use the explicit inclusive field or iCount adds VAT again.
    fields[`items[${i}][${includesVat ? 'unitprice_incvat' : 'unitprice'}]`] =
      item.unitprice ?? item.price ?? 0;
    fields[`items[${i}][quantity]`] = item.quantity ?? 1;
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
  cc = null,
  sanityString = '',
}) {
  const fields = {
    doctype: 'invrec',
    doc_date: todayYyyymmdd(),
    currency: 'ILS',
    vattype,
    ...buildDocLineFields(items, { includesVat: Number(vattype) !== 1 }),
  };

  if (clientId) fields.client_id = clientId;
  else if (clientName) fields.client_name = clientName;
  else throw new Error('clientId or clientName required');

  if (comment) fields.comment = comment;
  if (emailTo) {
    fields.email_to = emailTo;
    fields.send_email = 1;
  }
  // מפתח ייחודי למסמך. ניסיון שני על אותה מכירה מחזיר את המסמך הקיים במקום
  // להוציא חשבונית שנייה על אותו כסף — מה שמאפשר לנסות שוב אחרי תקלת רשת.
  if (sanityString) fields.sanity_string = String(sanityString).slice(0, 64);

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
    // פרטי החיוב שכבר נעשה במסוף. בלעדיהם המסמך אומר „שולם באשראי” ולא אילו
    // ארבע ספרות ואיזה מספר אישור — בדיוק מה שמחפשים כשלקוח חוזר עם שאלה.
    if (cc?.numOfPayments != null) fields['cc[0][num_of_payments]'] = cc.numOfPayments;
    if (cc?.confirmationCode) fields['cc[0][confirmation_code]'] = cc.confirmationCode;
    if (cc?.last4) fields['cc[0][card_number]'] = cc.last4;
    if (cc?.cardType) fields['cc[0][card_type]'] = cc.cardType;
    if (cc?.holderName) fields['cc[0][holder_name]'] = cc.holderName;
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
    ...buildDocLineFields(items, { includesVat: Number(vattype) !== 1 }),
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

/* ── מסוף EMV פיזי ─────────────────────────────────────────────────────────
 *
 * `cc/emv` שולח את החיוב למכשיר הסליקה שמחובר לחשבון, והקריאה נשארת פתוחה עד
 * שהלקוח מעביר כרטיס במכשיר או שהעסקה נדחית. זו הקריאה היחידה ב-API שמחכה
 * לאדם, ולכן היא היחידה עם תקרת זמן משלה ועם מסלול התאוששות: תום זמן אינו
 * אומר שהכסף לא נגבה, אלא רק שהתשובה לא הגיעה.
 */

const EMV_DEFAULT_TIMEOUT_MS = 180000;

/** תקרת ההמתנה למכשיר, בשניות של לקוח שעומד מול הדלפק. */
export function emvTimeoutMs() {
  const raw = Number(process.env.ICOUNT_EMV_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 15000 && raw <= 600000) return Math.round(raw);
  return EMV_DEFAULT_TIMEOUT_MS;
}

export async function getCompanySettings() {
  const data = await icountPost('company/settings', {});
  return data.company_settings || {};
}

let _emvStatusCache = { at: 0, value: null };

/**
 * האם יש מכשיר סליקה שאפשר לשלוח אליו חיוב.
 * נקרא מהמסך בכל טעינה של הקופה, ולכן נשמר במטמון לכמה דקות.
 */
export async function emvStatus({ maxAgeMs = 5 * 60 * 1000, force = false } = {}) {
  if (!isConfigured()) {
    return { available: false, configured: false, reason: 'iCount לא מוגדר בשרת', devices: [] };
  }
  const now = Date.now();
  if (!force && _emvStatusCache.value && now - _emvStatusCache.at < maxAgeMs) {
    return _emvStatusCache.value;
  }
  try {
    const settings = await getCompanySettings();
    const devices = (Array.isArray(settings.emv_devices) ? settings.emv_devices : [])
      .map((id) => String(id).trim())
      .filter(Boolean);
    const ccEnabled = settings.cc_enabled !== false;
    const enabled = settings.emv_enabled === true;
    const value = {
      configured: true,
      available: enabled && ccEnabled && devices.length > 0,
      enabled,
      ccEnabled,
      refundEnabled: settings.cc_refund_enabled === true,
      devices,
      reason: !enabled
        ? 'מסוף EMV לא מופעל בחשבון iCount'
        : !ccEnabled
          ? 'סליקת אשראי כבויה בחשבון iCount'
          : !devices.length
            ? 'לא מחובר מכשיר סליקה לחשבון iCount'
            : '',
    };
    _emvStatusCache = { at: now, value };
    return value;
  } catch (err) {
    const value = {
      configured: true,
      available: false,
      devices: [],
      reason: `בדיקת מסוף הסליקה נכשלה: ${err.message}`,
    };
    // כישלון זמני לא ננעל למטמון ארוך — דקה, כדי לא להציף את ה-API.
    _emvStatusCache = { at: now - maxAgeMs + 60000, value };
    return value;
  }
}

/** שורת חיוב מיומן ה-cc, בשמות שאנחנו משתמשים בהם. */
function normalizeCcRow(row = {}) {
  const last4Digits = String(row.cc_cardnumber || '').replace(/\D/g, '');
  return {
    ccBillLogId: row.cc_bill_log_id != null ? String(row.cc_bill_log_id) : null,
    confirmationCode: row.confirmation_code ? String(row.confirmation_code).trim() : null,
    charged: Number(row.cctotal) || 0,
    cardLast4: last4Digits ? last4Digits.slice(-4) : null,
    cardType: row.cc_cardtype ? String(row.cc_cardtype).trim() : null,
    holderName: row.cc_holder_name ? String(row.cc_holder_name).trim() : null,
    numOfPayments: Number(row.cc_numofpayments) || 1,
    chargeDate: row.cc_charge_date ? String(row.cc_charge_date) : null,
    docnumber: row.docnumber != null && String(row.docnumber).trim() ? String(row.docnumber).trim() : null,
    alreadyRefunded: String(row.refunded || '0') !== '0',
    raw: row,
  };
}

function isoDay(value) {
  const d = value ? new Date(value) : new Date();
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10);
}

/** חיובי הכרטיסים ביום נתון. משמש גם לאיתור חיוב שהתשובה עליו אבדה. */
export async function listCcCharges({ date, confirmationCode } = {}) {
  const day = isoDay(date);
  const data = await icountPost('cc/transactions', {
    start_date: day,
    end_date: day,
    confirmation_code: confirmationCode || undefined,
  });
  const rows = Array.isArray(data?.results_list) ? data.results_list : [];
  return rows.map(normalizeCcRow);
}

/** חיוב לפי מספר האישור שהמסוף החזיר. */
export async function findCcChargeByConfirmation({ confirmationCode, date } = {}) {
  const code = String(confirmationCode || '').trim();
  if (!code) return null;
  let rows = [];
  try {
    rows = await listCcCharges({ date, confirmationCode: code });
  } catch (err) {
    if (!/אין תוצאות|no results/i.test(err.message || '')) throw err;
  }
  return rows.find((row) => row.confirmationCode === code) || null;
}

/**
 * חיוב במסוף ה-EMV.
 *
 * שגיאה שהיא ודאית — כרטיס שנדחה, סכום פסול — נזרקת עם `indeterminate=false`,
 * ואז מותר לומר ללקוח שלא חויב. תום זמן או ניתוק נזרקים עם `indeterminate=true`:
 * ייתכן מאוד שהכסף כן נגבה, ואסור להציע חיוב חוזר לפני בדיקה.
 */
export async function chargeEmv({
  clientId,
  clientName,
  email,
  sum,
  numOfPayments = 1,
  timeoutMs = emvTimeoutMs(),
} = {}) {
  const amount = roundMoney(sum);
  if (!Number.isFinite(amount) || amount <= 0) {
    const err = new Error('סכום החיוב חייב להיות גדול מאפס');
    err.code = 'bad_sum';
    err.indeterminate = false;
    throw err;
  }

  const fields = { sum: amount, currency_code: 'ILS' };
  if (Number(numOfPayments) > 1) fields.num_of_payments = Math.round(Number(numOfPayments));
  if (clientId) fields.client_id = clientId;
  else if (clientName) fields.client_name = clientName;
  if (email) fields.email = email;

  let data;
  try {
    data = await icountPost('cc/emv', fields, { timeoutMs });
  } catch (err) {
    err.indeterminate = err.code === 'timeout' || err.code === 'network';
    throw err;
  }

  if (data.success === false) {
    const err = new Error(
      data.error_description || data.reason || 'העסקה נדחתה במסוף הסליקה'
    );
    err.code = data.reason || 'declined';
    err.indeterminate = false;
    err.details = data;
    throw err;
  }

  const last4Digits = String(data.cc_last4 || data.card_number || data.cc_cardnumber || '')
    .replace(/\D/g, '');
  return {
    confirmationCode: data.confirmation_code != null && String(data.confirmation_code).trim()
      ? String(data.confirmation_code).trim()
      : null,
    cardType: data.cc_type || data.card_type || null,
    cardLast4: last4Digits ? last4Digits.slice(-4) : null,
    ccBillLogId: extractBillLogId(data),
    amount,
    raw: data,
  };
}

function extractBillLogId(raw = {}) {
  for (const [key, value] of Object.entries(raw || {})) {
    if (/bill_?log/i.test(key) && value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
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
    ...buildDocLineFields(
      [{ description: description || 'זיכוי', unitprice: gross, quantity: 1 }],
      { includesVat: true }
    ),
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
  const token = buildPaymentRedirectToken(paymentId);
  return token ? `${getPaymentRedirectBase()}/r/${encodeURIComponent(token)}` : '';
}

export function buildPaymentRedirectToken(paymentId) {
  try {
    return issuePublicRedirectToken('payment', paymentId);
  } catch {
    return '';
  }
}

/** Default Meta template name for POS payment links. */
export function getPaymentTemplateName() {
  return (process.env.WA_PAYMENT_TEMPLATE || 'payment_link').trim();
}

/** Server-to-server notify URL after payment-page success (IPN). */
export function signWebhookPaymentId(paymentId, secret = process.env.ICOUNT_WEBHOOK_SECRET || '') {
  const cleanSecret = String(secret || '').trim();
  const cleanPaymentId = String(paymentId || '').trim();
  if (!cleanSecret || !cleanPaymentId) return '';
  return crypto.createHmac('sha256', cleanSecret).update(`icount:${cleanPaymentId}`).digest('base64url');
}

export function buildIpnUrl({ paymentId } = {}) {
  const base = getPublicApiBase();
  const params = new URLSearchParams();
  if (paymentId) {
    params.set('payment_id', String(paymentId));
    const signature = signWebhookPaymentId(paymentId);
    if (signature) params.set('signature', signature);
  }
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
  findClientsByContact,
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
  getCompanySettings,
  emvStatus,
  emvTimeoutMs,
  chargeEmv,
  listCcCharges,
  findCcChargeByConfirmation,
  listInventoryItems,
  updateInventoryQty,
  buildPaymentUrl,
  resolvePayPageUrl,
  buildIpnUrl,
  signWebhookPaymentId,
  getPublicApiBase,
  isLocalPublicApiBase,
  isLocalHostname,
  getPaymentRedirectBase,
  buildPaymentRedirectUrl,
  buildPaymentRedirectToken,
  getPaymentTemplateName,
  getPayPage,
  getPayBaseUrl,
  icountPost,
};
