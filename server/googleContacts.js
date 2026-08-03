/**
 * Google Contacts (People API) one-way sync: CRM → phone address book.
 *
 * Purpose: when a customer calls, the phone shows who they are instead of a
 * bare number. Contact display names carry the funnel status, the parent name
 * and the children's names.
 *
 * State lives in Google, not here. Every synced contact carries a `userDefined`
 * marker with its CRM key, so each run rebuilds the mapping by listing the
 * dedicated contact group. That makes the sync self-healing: losing local
 * settings never creates duplicates. Only tokens and the group id are stored in
 * app_settings key `google_contacts`.
 */

import { supa } from './supa.js';

const SETTINGS_KEY = 'google_contacts';
const CONTACT_GROUP_NAME = 'קיר בועז';
const CRM_KEY_FIELD = 'crmKey';
const SCOPES = ['https://www.googleapis.com/auth/contacts'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const PEOPLE_API = 'https://people.googleapis.com/v1';

const CREATE_CHUNK = 100;
const UPDATE_CHUNK = 100;
const DELETE_CHUNK = 200;

/** Funnel status labels, most advanced first. Order drives the parent's headline status. */
const STATUS_RANK = [
  ['registered', 'חוג פעיל'],
  ['intro_paid', 'שילם - ממתין להכירות'],
  ['intro_scheduled', 'נקבע אימון הכירות'],
  ['health_signed', 'חתם הצהרה'],
  ['pending_signup', 'ממתין להרשמה'],
  ['waitlist', 'רשימת המתנה'],
  ['lead_new', 'ליד חדש'],
  ['archived', 'ארכיון'],
];
const STATUS_LABELS = Object.fromEntries(STATUS_RANK);
const STATUS_ORDER = new Map(STATUS_RANK.map(([key], idx) => [key, idx]));

const TRAINEE_PREFIX = 'מטפס';

/**
 * Safety valve: a sync that would remove more than this share of the group is
 * treated as a data-loading failure rather than a real change.
 */
const MAX_DELETE_RATIO = 0.5;
const MAX_DELETE_FLOOR = 5;

let memorySettings = null;

function clientConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function publicApiBase() {
  return (
    process.env.PUBLIC_API_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://climbing-crm-api.onrender.com'
      : `http://localhost:${process.env.PORT || 5000}`)
  );
}

function frontendBase() {
  return (
    process.env.FRONTEND_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://app.kirboaz.co.il'
      : 'http://localhost:3000')
  );
}

function redirectUri() {
  return (
    process.env.GOOGLE_CONTACTS_REDIRECT_URI ||
    `${publicApiBase()}/api/google-contacts/oauth/callback`
  );
}

async function loadSettings({ force = false } = {}) {
  if (!force && memorySettings) return memorySettings;
  const remote = await supa.getAppSetting(SETTINGS_KEY);
  memorySettings = remote && typeof remote === 'object' ? { ...remote } : {};
  return memorySettings;
}

async function saveSettings(patch) {
  const current = await loadSettings({ force: true });
  memorySettings = { ...current, ...patch, updated_at: new Date().toISOString() };
  await supa.setAppSetting(SETTINGS_KEY, memorySettings);
  return memorySettings;
}

async function clearSettings() {
  memorySettings = {};
  await supa.setAppSetting(SETTINGS_KEY, {});
  return memorySettings;
}

function isConnected(settings) {
  return !!settings?.refreshToken;
}

export function getAuthUrl(state = 'crm') {
  if (!clientConfigured()) throw new Error('חסרים מפתחות גוגל בשרת');
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'החלפת קוד נכשלה');
  }
  return data;
}

async function refreshAccessToken(settings) {
  if (!settings?.refreshToken) throw new Error('אין חיבור לאנשי הקשר בגוגל');
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: settings.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'רענון מפתח נכשל');
  }
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000 - 60_000;
  return saveSettings({
    accessToken: data.access_token,
    accessTokenExpiresAt: expiresAt,
  });
}

async function getAccessToken() {
  let settings = await loadSettings({ force: true });
  if (!settings.refreshToken) throw new Error('אין חיבור לאנשי הקשר בגוגל');
  if (
    settings.accessToken &&
    settings.accessTokenExpiresAt &&
    Date.now() < Number(settings.accessTokenExpiresAt)
  ) {
    return settings.accessToken;
  }
  settings = await refreshAccessToken(settings);
  return settings.accessToken;
}

async function peopleFetch(path, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken();
  const url = new URL(path.startsWith('http') ? path : `${PEOPLE_API}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || text || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ─── Contact shaping ─────────────────────────────────────────────────────────

/** Israeli numbers to E.164 so the dialer matches them against incoming calls. */
export function toE164(phone) {
  let digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits.length >= 11 ? digits : '';
  digits = digits.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) {
    // 9720xxxxxxxx — a local zero survived the country code
    if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
    return digits.length >= 11 ? `+${digits}` : '';
  }
  if (digits.startsWith('0')) {
    const local = digits.slice(1);
    return local.length >= 8 ? `+972${local}` : '';
  }
  return '';
}

function collapseSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** Append the family name when the record only carries a first name. */
function fullName(name, lastName) {
  const first = collapseSpaces(name);
  const last = collapseSpaces(lastName);
  if (!first) return last;
  if (!last) return first;
  if (first.includes(' ')) return first;
  return `${first} ${last}`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.lead_new;
}

/** Most advanced status across the parent and their children. */
export function headlineStatus(parent, children = []) {
  const candidates = [parent?.status, ...children.map((c) => c?.status)]
    .map((s) => String(s || '').trim())
    .filter((s) => STATUS_ORDER.has(s));
  if (!candidates.length) return 'lead_new';
  return candidates.reduce((best, s) =>
    STATUS_ORDER.get(s) < STATUS_ORDER.get(best) ? s : best
  );
}

/**
 * Build the contacts the address book should hold, keyed by CRM key.
 * Parents read `סטטוס - הורה - ילדים`; trainees with their own line read
 * `מטפס - שם מלא`.
 */
export function buildDesiredContacts(parents = [], students = []) {
  const safeParents = (Array.isArray(parents) ? parents : []).filter(Boolean);
  const safeStudents = (Array.isArray(students) ? students : []).filter(Boolean);

  const childrenByParent = new Map();
  for (const student of safeStudents) {
    const pid = student.parentId == null ? '' : String(student.parentId);
    if (!pid) continue;
    if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
    childrenByParent.get(pid).push(student);
  }

  const desired = new Map();
  const parentPhones = new Map();

  for (const parent of safeParents) {
    if (parent.id == null) continue;
    const phone = toE164(parent.phone);
    const parentId = String(parent.id);
    if (phone) parentPhones.set(parentId, phone);
    if (!phone) continue;

    const children = childrenByParent.get(parentId) || [];
    const listed = children
      .filter((c) => c.status !== 'archived' && collapseSpaces(c.name))
      .map((c) => fullName(c.name, parent.lastName));

    const parts = [
      statusLabel(headlineStatus(parent, children)),
      fullName(parent.name, parent.lastName) || 'ללא שם',
    ];
    if (listed.length) parts.push(listed.join(', '));

    desired.set(`parent:${parentId}`, {
      key: `parent:${parentId}`,
      name: parts.join(' - '),
      phone,
    });
  }

  for (const student of safeStudents) {
    if (student.id == null) continue;
    const phone = toE164(student.phone);
    if (!phone) continue;
    // Children reachable only through a parent already appear on the parent card.
    const pid = student.parentId == null ? '' : String(student.parentId);
    if (pid && parentPhones.get(pid) === phone) continue;

    const parent = safeParents.find((p) => String(p.id) === pid) || null;
    const name = fullName(student.name, parent?.lastName);
    if (!name) continue;

    desired.set(`student:${student.id}`, {
      key: `student:${student.id}`,
      name: `${TRAINEE_PREFIX} - ${name}`,
      phone,
    });
  }

  return desired;
}

// ─── Google-side state ───────────────────────────────────────────────────────

async function ensureContactGroup(settings) {
  if (settings?.contactGroupResourceName) {
    try {
      const group = await peopleFetch(`/${settings.contactGroupResourceName}`);
      return { resourceName: group.resourceName, name: group.name };
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  let pageToken = null;
  do {
    const page = await peopleFetch('/contactGroups', {
      query: { pageSize: 200, pageToken: pageToken || undefined },
    });
    const found = (page.contactGroups || []).find(
      (g) => g.groupType === 'USER_CONTACT_GROUP' && g.name === CONTACT_GROUP_NAME
    );
    if (found) return { resourceName: found.resourceName, name: found.name };
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  const created = await peopleFetch('/contactGroups', {
    method: 'POST',
    body: { contactGroup: { name: CONTACT_GROUP_NAME } },
  });
  return { resourceName: created.resourceName, name: created.name };
}

function crmKeyOf(person) {
  const field = (person?.userDefined || []).find((f) => f?.key === CRM_KEY_FIELD);
  return field?.value ? String(field.value) : null;
}

/** Every contact this CRM owns, keyed by CRM key. Duplicates are surfaced for cleanup. */
async function listManagedContacts() {
  const managed = new Map();
  const duplicates = [];
  let pageToken = null;

  do {
    const page = await peopleFetch('/people/me/connections', {
      query: {
        personFields: 'names,phoneNumbers,userDefined',
        pageSize: 1000,
        pageToken: pageToken || undefined,
      },
    });
    for (const person of page.connections || []) {
      const key = crmKeyOf(person);
      if (!key) continue;
      const entry = {
        key,
        resourceName: person.resourceName,
        etag: person.etag,
        name: person.names?.[0]?.givenName || person.names?.[0]?.displayName || '',
        phone: person.phoneNumbers?.[0]?.value || '',
      };
      if (managed.has(key)) duplicates.push(entry);
      else managed.set(key, entry);
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  return { managed, duplicates };
}

function toPerson(contact, { groupResourceName } = {}) {
  const person = {
    names: [{ givenName: contact.name }],
    phoneNumbers: [{ value: contact.phone, type: 'mobile' }],
    userDefined: [{ key: CRM_KEY_FIELD, value: contact.key }],
  };
  if (groupResourceName) {
    person.memberships = [{ contactGroupMembership: { contactGroupResourceName: groupResourceName } }];
  }
  return person;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Decide what to create, update and delete. Pure, so the rules stay testable
 * without touching Google.
 */
export function planSync(desired, managed) {
  const toCreate = [];
  const toUpdate = [];
  const toDelete = [];

  for (const [key, contact] of desired) {
    const current = managed.get(key);
    if (!current) {
      toCreate.push(contact);
    } else if (current.name !== contact.name || current.phone !== contact.phone) {
      toUpdate.push({ ...contact, resourceName: current.resourceName, etag: current.etag });
    }
  }

  for (const [key, current] of managed) {
    if (!desired.has(key)) toDelete.push(current);
  }

  return { toCreate, toUpdate, toDelete };
}

// ─── Public surface ──────────────────────────────────────────────────────────

export async function getStatus() {
  const settings = await loadSettings();
  return {
    configured: clientConfigured(),
    connected: isConnected(settings),
    connectedEmail: settings.connectedEmail || null,
    connectedAt: settings.connectedAt || null,
    contactGroupName: settings.contactGroupName || null,
    lastSyncAt: settings.lastSyncAt || null,
    lastSyncStats: settings.lastSyncStats || null,
    error: settings.lastError || null,
  };
}

export async function completeOAuth(code) {
  if (!clientConfigured()) throw new Error('חסרים מפתחות גוגל בשרת');
  const tokens = await exchangeCode(code);
  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000 - 60_000;
  const previous = await loadSettings();
  let settings = await saveSettings({
    refreshToken: tokens.refresh_token || previous.refreshToken || '',
    accessToken: tokens.access_token,
    accessTokenExpiresAt: expiresAt,
    connectedAt: new Date().toISOString(),
    lastError: null,
  });

  if (!settings.refreshToken) {
    throw new Error('לא התקבל מפתח רענון מגוגל. נסו להתחבר שוב');
  }

  try {
    const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${settings.accessToken}` },
    }).then((r) => r.json());
    if (me.email) settings = await saveSettings({ connectedEmail: me.email });
  } catch {
    // optional
  }

  const group = await ensureContactGroup(settings);
  await saveSettings({
    contactGroupResourceName: group.resourceName,
    contactGroupName: group.name,
  });

  return { success: true, ...(await getStatus()) };
}

export async function disconnect() {
  await clearSettings();
  return { success: true, connected: false };
}

export function oauthCallbackRedirectUrl() {
  return `${frontendBase()}/business-settings?googleContacts=connected`;
}

/**
 * Push the CRM address book into Google.
 * @param {object} deps - { getParents, getStudents }
 * @param {object} [opts] - { force } skips the mass-delete guard.
 */
export async function syncContacts(deps, { force = false } = {}) {
  const settings = await loadSettings();
  if (!isConnected(settings)) return { skipped: true, reason: 'not_connected' };

  const group = await ensureContactGroup(settings);
  if (group.resourceName !== settings.contactGroupResourceName) {
    await saveSettings({
      contactGroupResourceName: group.resourceName,
      contactGroupName: group.name,
    });
  }

  const parents = deps.getParents() || [];
  const students = deps.getStudents() || [];
  const desired = buildDesiredContacts(parents, students);
  const { managed, duplicates } = await listManagedContacts();
  managedCache = null; // whatever this run writes makes a cached read wrong
  const { toCreate, toUpdate, toDelete } = planSync(desired, managed);

  // A CRM read that came back empty must never wipe the address book.
  const deleteAllowance = Math.max(MAX_DELETE_FLOOR, Math.ceil(managed.size * MAX_DELETE_RATIO));
  const removals = [...toDelete, ...duplicates];
  const blockedDeletes = !force && toDelete.length > deleteAllowance;
  if (blockedDeletes) {
    console.warn(
      `Google Contacts sync: refusing to delete ${toDelete.length} of ${managed.size} contacts`
    );
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  const errors = [];

  for (const batch of chunk(toCreate, CREATE_CHUNK)) {
    try {
      await peopleFetch('/people:batchCreateContacts', {
        method: 'POST',
        body: {
          contacts: batch.map((c) => ({
            contactPerson: toPerson(c, { groupResourceName: group.resourceName }),
          })),
          readMask: 'names',
        },
      });
      created += batch.length;
    } catch (err) {
      errors.push(`יצירה: ${err.message}`);
    }
  }

  for (const batch of chunk(toUpdate, UPDATE_CHUNK)) {
    try {
      const contacts = {};
      for (const c of batch) {
        // Memberships stay untouched on update so manual grouping survives.
        contacts[c.resourceName] = { etag: c.etag, ...toPerson(c) };
      }
      await peopleFetch('/people:batchUpdateContacts', {
        method: 'POST',
        body: {
          contacts,
          updateMask: 'names,phoneNumbers,userDefined',
          readMask: 'names',
        },
      });
      updated += batch.length;
    } catch (err) {
      errors.push(`עדכון: ${err.message}`);
    }
  }

  const removeList = blockedDeletes ? duplicates : removals;
  for (const batch of chunk(removeList, DELETE_CHUNK)) {
    try {
      await peopleFetch('/people:batchDeleteContacts', {
        method: 'POST',
        body: { resourceNames: batch.map((c) => c.resourceName) },
      });
      deleted += batch.length;
    } catch (err) {
      errors.push(`מחיקה: ${err.message}`);
    }
  }

  const stats = {
    created,
    updated,
    deleted,
    total: desired.size,
    blockedDeletes: blockedDeletes ? toDelete.length : 0,
  };
  await saveSettings({
    lastSyncAt: new Date().toISOString(),
    lastSyncStats: stats,
    lastError: errors.length ? errors.join(' | ') : null,
  });

  return { success: !errors.length, ...stats, errors };
}

// ─── Per-customer status ─────────────────────────────────────────────────────

/**
 * The address book read is the expensive part, and the customer screen asks for
 * one record at a time, so the managed map is cached and shared across records.
 * Any sync drops it, since a sync is exactly what makes it wrong.
 */
const MANAGED_CACHE_MS = Number(process.env.GOOGLE_CONTACTS_CACHE_MS || 5 * 60_000);
let managedCache = null;

async function getManagedContacts({ refresh = false } = {}) {
  if (!refresh && managedCache && Date.now() - managedCache.at < MANAGED_CACHE_MS) {
    return managedCache;
  }
  const { managed } = await listManagedContacts();
  managedCache = { at: Date.now(), managed };
  return managedCache;
}

const SYNC_STATE_LABELS = {
  not_configured: 'סנכרון אנשי קשר לא מוגדר',
  not_connected: 'לא מחובר לאנשי קשר בגוגל',
  no_phone: 'אין מספר טלפון לסנכרון',
  missing: 'ממתין לסנכרון',
  stale: 'ממתין לעדכון',
  synced: 'מסונכרן',
};

/**
 * Compare one record against the contact Google actually holds.
 * `stale` means the contact exists but its name or number drifted from the
 * template — the next sync fixes it.
 */
export function contactSyncState(wanted, current) {
  if (!wanted) return 'no_phone';
  if (!current) return 'missing';
  if (current.name !== wanted.name || current.phone !== wanted.phone) return 'stale';
  return 'synced';
}

/** The same comparison for one record, against the live address book. */
export async function getContactSyncStatus(deps, key, { refresh = false } = {}) {
  const settings = await loadSettings();
  const base = { key, expectedName: null, currentName: null, phone: null };
  if (!clientConfigured()) return { ...base, state: 'not_configured', label: SYNC_STATE_LABELS.not_configured };
  if (!isConnected(settings)) return { ...base, state: 'not_connected', label: SYNC_STATE_LABELS.not_connected };

  const desired = buildDesiredContacts(deps.getParents() || [], deps.getStudents() || []);
  const wanted = desired.get(key) || null;
  const lastSyncAt = settings.lastSyncAt || null;
  if (!wanted) return { ...base, state: 'no_phone', label: SYNC_STATE_LABELS.no_phone, lastSyncAt };

  const { managed, at } = await getManagedContacts({ refresh });
  const current = managed.get(key) || null;
  const state = contactSyncState(wanted, current);

  return {
    key,
    state,
    label: SYNC_STATE_LABELS[state],
    expectedName: wanted.name,
    currentName: current?.name || null,
    phone: wanted.phone,
    lastSyncAt,
    checkedAt: new Date(at).toISOString(),
  };
}

// ─── Debounced trigger from CRM write paths ──────────────────────────────────

let pendingTimer = null;
let inFlight = false;
let rerunRequested = false;
const DEBOUNCE_MS = Number(process.env.GOOGLE_CONTACTS_DEBOUNCE_MS || 45_000);

/**
 * Coalesce many CRM edits into one sync shortly after the last change, so a
 * status change shows up on the phone without a request per keystroke.
 */
export function scheduleSync(deps) {
  if (!clientConfigured()) return;
  // Same shared-settings guard as calendar: local process must not rewrite live tokens.
  const flag = String(process.env.GOOGLE_BACKGROUND_SYNC || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return;
  if (!['1', 'true', 'on', 'yes'].includes(flag)) {
    const redirect = String(
      process.env.GOOGLE_CONTACTS_REDIRECT_URI ||
      process.env.GOOGLE_REDIRECT_URI ||
      ''
    );
    if (/localhost|127\.0\.0\.1/i.test(redirect) || process.env.NODE_ENV !== 'production') {
      return;
    }
  }
  if (pendingTimer) return;
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    if (inFlight) {
      rerunRequested = true;
      return;
    }
    inFlight = true;
    try {
      do {
        rerunRequested = false;
        await syncContacts(deps);
      } while (rerunRequested);
    } catch (err) {
      console.error('Google Contacts sync failed:', err.message);
      await saveSettings({ lastError: err.message }).catch(() => {});
    } finally {
      inFlight = false;
    }
  }, DEBOUNCE_MS);
  if (typeof pendingTimer.unref === 'function') pendingTimer.unref();
}

export const googleContactsService = {
  clientConfigured,
  getAuthUrl,
  getStatus,
  completeOAuth,
  disconnect,
  syncContacts,
  getContactSyncStatus,
  scheduleSync,
  oauthCallbackRedirectUrl,
  frontendBase,
  loadSettings,
};
