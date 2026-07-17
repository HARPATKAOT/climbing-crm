/**
 * iCount API v3 client
 * Auth: Bearer token from ICOUNT_API_TOKEN
 * Body: application/x-www-form-urlencoded (not JSON)
 */

const BASE_URL = 'https://api.icount.co.il/api/v3.php';

function getToken() {
  return (
    process.env.ICOUNT_API_TOKEN ||
    process.env.ICOUNT_API_KEY ||
    ''
  ).trim();
}

function getPayPage() {
  return (process.env.ICOUNT_PAY_PAGE || 'mywall').trim().replace(/^\//, '');
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

/**
 * Create tax invoice + receipt (חשבונית מס קבלה)
 * items: [{ description, unitprice, quantity? }]
 */
export async function createInvRec({ clientId, clientName, items, comment }) {
  const fields = {
    doctype: 'invrec',
    doc_date: todayYyyymmdd(),
    currency: 'NIS',
    vattype: 1,
  };

  if (clientId) fields.client_id = clientId;
  else if (clientName) fields.client_name = clientName;
  else throw new Error('clientId or clientName required');

  if (comment) fields.comment = comment;

  (items || []).forEach((item, i) => {
    fields[`desc[${i}]`] = item.description || item.desc || 'פריט';
    fields[`unitprice[${i}]`] = item.unitprice ?? item.price ?? 0;
    fields[`quantity[${i}]`] = item.quantity ?? 1;
  });

  const result = await icountPost('doc/create', fields);
  return {
    docId: result.doc_id != null ? String(result.doc_id) : null,
    docnum: result.docnum != null ? String(result.docnum) : null,
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

  const data = await icountPost('doc/search', {
    start_date: start,
    end_date: end,
  });

  const list = data.results_list || data.documents || data.docs || [];
  return Array.isArray(list) ? list : Object.values(list);
}

export async function getDoc(docId) {
  return icountPost('doc/get', { doc_id: docId });
}

export function buildPaymentUrl({ amount, description, name, phone }) {
  const page = getPayPage();
  const params = new URLSearchParams();
  if (amount != null && amount !== '') params.set('cs', String(amount));
  if (description) params.set('cd', description);
  if (name) params.set('ccfname', name);
  if (phone) {
    const clean = String(phone).replace(/[-\s]/g, '');
    if (clean) params.set('contact_phone', clean);
  }
  return `https://pay.icount.co.il/${page}?${params.toString()}`;
}

export const icount = {
  isConfigured,
  ping,
  ensureClient,
  createInvRec,
  searchDocs,
  getDoc,
  buildPaymentUrl,
  icountPost,
};
