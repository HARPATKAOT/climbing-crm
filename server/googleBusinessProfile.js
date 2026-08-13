/**
 * Google Business Profile opening-hours sync.
 *
 * The CRM calendar is the source of truth. Published `opening_hours` entries
 * become Google special hours for the next two weeks, including an explicit
 * "closed" day when the calendar has no published opening-hours entry.
 * Tokens and the selected Google location live in app_settings so they survive
 * deploys without ever reaching the browser.
 */

import { supa } from './supa.js';
import { israelDateStr } from './attendanceUtils.js';

const SETTINGS_KEY = 'google_business_profile';
const SCOPES = ['https://www.googleapis.com/auth/business.manage'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const ACCOUNT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const BUSINESS_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
export const DEFAULT_SYNC_DAYS = 14;

let memorySettings = null;
let pendingTimer = null;
let syncInFlight = false;
let rerunRequested = false;

function clientConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function backgroundSyncEnabled() {
  const flag = String(process.env.GOOGLE_BACKGROUND_SYNC || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return false;
  if (['1', 'true', 'on', 'yes'].includes(flag)) return true;
  return process.env.NODE_ENV === 'production';
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
    process.env.GOOGLE_BUSINESS_PROFILE_REDIRECT_URI ||
    `${publicApiBase()}/api/google-business-profile/oauth/callback`
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
  memorySettings = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await supa.setAppSetting(SETTINGS_KEY, memorySettings);
  return memorySettings;
}

async function clearSettings() {
  memorySettings = {};
  await supa.setAppSetting(SETTINGS_KEY, {});
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || 'החלפת קוד גוגל נכשלה');
  return data;
}

async function refreshAccessToken(settings) {
  if (!settings?.refreshToken) throw new Error('אין חיבור לפרופיל העסק בגוגל');
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error_description || data.error || 'רענון החיבור לגוגל נכשל';
    await saveSettings({ lastError: message }).catch(() => {});
    throw new Error(message);
  }
  const patch = {
    accessToken: data.access_token,
    accessTokenExpiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 60_000,
    lastError: null,
  };
  if (data.refresh_token) patch.refreshToken = data.refresh_token;
  return saveSettings(patch);
}

async function getAccessToken() {
  let settings = await loadSettings({ force: true });
  if (!settings.refreshToken) throw new Error('אין חיבור לפרופיל העסק בגוגל');
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

async function googleFetch(urlOrPath, { method = 'GET', body, query, base = BUSINESS_INFO_API } = {}) {
  const token = await getAccessToken();
  const url = new URL(urlOrPath.startsWith('http') ? urlOrPath : `${base}${urlOrPath}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
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
    const message = data?.error?.message || data?.error_description || text || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function addressLabel(address) {
  if (!address || typeof address !== 'object') return '';
  return [
    ...(Array.isArray(address.addressLines) ? address.addressLines : []),
    address.locality,
    address.postalCode,
  ].filter(Boolean).join(', ');
}

/** All locations the connected account is allowed to manage. */
export async function listLocations() {
  const locations = new Map();
  let successfulLocationLists = 0;
  let firstLocationError = null;
  let accountPageToken = null;
  do {
    const page = await googleFetch('/accounts', {
      base: ACCOUNT_API,
      query: { pageSize: 20, pageToken: accountPageToken || undefined },
    });
    for (const account of page?.accounts || []) {
      if (!account?.name) continue;
      let locationPageToken = null;
      do {
        try {
          const locationPage = await googleFetch(`/${account.name}/locations`, {
            query: {
              pageSize: 100,
              pageToken: locationPageToken || undefined,
              readMask: 'name,title,storeCode,storefrontAddress',
            },
          });
          successfulLocationLists += 1;
          for (const location of locationPage?.locations || []) {
            if (!location?.name) continue;
            locations.set(location.name, {
              name: location.name,
              title: location.title || location.storeCode || location.name,
              address: addressLabel(location.storefrontAddress),
              accountName: account.accountName || '',
            });
          }
          locationPageToken = locationPage?.nextPageToken || null;
        } catch (err) {
          // Personal and organization containers can legitimately have no direct
          // locations. Continue through the remaining accessible accounts.
          if ([403, 404].includes(err.status)) {
            firstLocationError ||= err;
            locationPageToken = null;
          }
          else throw err;
        }
      } while (locationPageToken);
    }
    accountPageToken = page?.nextPageToken || null;
  } while (accountPageToken);
  // When every locations request failed, this is usually missing GBP API access
  // or a zero quota. Returning an empty list would hide the actionable Google
  // error behind a misleading "no profile found" message.
  if (!successfulLocationLists && firstLocationError) throw firstLocationError;
  return [...locations.values()].sort((a, b) => a.title.localeCompare(b.title, 'he'));
}

function parseIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function isoFromGoogleDate(value) {
  if (!value?.year || !value?.month || !value?.day) return '';
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function timeObject(value, fallback) {
  const match = String(value || fallback || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
  return { hours, minutes };
}

function minutesOf(value) {
  const time = timeObject(value);
  return time ? time.hours * 60 + time.minutes : null;
}

/** Convert the public calendar contract into Google's SpecialHourPeriod shape. */
export function buildSpecialHourPeriods(activities, {
  today = israelDateStr(),
  days = DEFAULT_SYNC_DAYS,
} = {}) {
  const byDate = new Map();
  for (const activity of activities || []) {
    if (!activity || activity.cancelled) continue;
    if (activity.type !== 'opening_hours') continue;
    if (['draft', 'cancelled', 'archived'].includes(String(activity.status || '').toLowerCase())) continue;
    const date = String(activity.date || '').slice(0, 10);
    if (!parseIsoDate(date)) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(activity);
  }

  const periods = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(today, offset);
    const startDate = parseIsoDate(date);
    const slots = (byDate.get(date) || []).slice().sort(
      (a, b) => String(a.start_time || '').localeCompare(String(b.start_time || ''))
    );
    if (!slots.length) {
      periods.push({ startDate, closed: true });
      continue;
    }
    for (const slot of slots) {
      if (slot.all_day) {
        periods.push({
          startDate,
          openTime: { hours: 0, minutes: 0 },
          closeTime: { hours: 24, minutes: 0 },
          closed: false,
        });
        continue;
      }
      const openTime = timeObject(slot.start_time);
      const closeTime = timeObject(slot.end_time);
      if (!openTime || !closeTime) continue;
      const overnight = minutesOf(slot.end_time) <= minutesOf(slot.start_time);
      periods.push({
        startDate,
        ...(overnight ? { endDate: parseIsoDate(addDays(date, 1)) } : {}),
        openTime,
        closeTime,
        closed: false,
      });
    }
    // Invalid time data must never silently turn a day into "open all day".
    if (!periods.some((period) => isoFromGoogleDate(period.startDate) === date)) {
      periods.push({ startDate, closed: true });
    }
  }
  return periods;
}

/** Replace only the CRM-owned rolling window; keep Google's other exceptions. */
export function mergeSpecialHourPeriods(existing, replacement, {
  today = israelDateStr(),
  days = DEFAULT_SYNC_DAYS,
} = {}) {
  const endExclusive = addDays(today, days);
  const preserved = (existing || []).filter((period) => {
    const date = isoFromGoogleDate(period?.startDate);
    return !date || date < today || date >= endExclusive;
  });
  return [...preserved, ...(replacement || [])].sort((a, b) =>
    isoFromGoogleDate(a?.startDate).localeCompare(isoFromGoogleDate(b?.startDate))
  );
}

export async function completeOAuth(code) {
  if (!clientConfigured()) throw new Error('חסרים מפתחות גוגל בשרת');
  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) throw new Error('לא התקבל מפתח רענון מגוגל. נסו להתחבר שוב');
  let settings = await saveSettings({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in || 3600) * 1000 - 60_000,
    connectedAt: new Date().toISOString(),
    lastError: null,
  });
  try {
    const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((res) => res.json());
    if (me?.email) settings = await saveSettings({ connectedEmail: me.email });
  } catch {
    // Email is helpful UI metadata, not a condition for synchronization.
  }

  const locations = await listLocations();
  const stillAvailable = locations.find((location) => location.name === settings.locationName);
  const selected = stillAvailable || (locations.length === 1 ? locations[0] : null);
  await saveSettings({
    locations,
    locationName: selected?.name || null,
    locationTitle: selected?.title || null,
    locationAddress: selected?.address || null,
    lastError: locations.length ? null : 'לא נמצא פרופיל עסק שהחשבון רשאי לנהל',
  });
  return getStatus();
}

export async function selectLocation(locationName) {
  const locations = await listLocations();
  const selected = locations.find((location) => location.name === String(locationName || ''));
  if (!selected) throw new Error('פרופיל העסק שנבחר אינו זמין לחשבון הזה');
  await saveSettings({
    locations,
    locationName: selected.name,
    locationTitle: selected.title,
    locationAddress: selected.address,
    lastError: null,
  });
  return getStatus();
}

export async function syncOpeningHours(activities, {
  today = israelDateStr(),
  days = DEFAULT_SYNC_DAYS,
} = {}) {
  const settings = await loadSettings({ force: true });
  if (!isConnected(settings)) return { skipped: true, reason: 'not_connected' };
  if (!settings.locationName) throw new Error('יש לבחור פרופיל עסק בגוגל לפני הסנכרון');
  const locationPath = `/${settings.locationName}`;
  try {
    const location = await googleFetch(locationPath, {
      query: { readMask: 'name,title,specialHours' },
    });
    const replacement = buildSpecialHourPeriods(activities, { today, days });
    const merged = mergeSpecialHourPeriods(
      location?.specialHours?.specialHourPeriods || [],
      replacement,
      { today, days }
    );
    await googleFetch(locationPath, {
      method: 'PATCH',
      query: { updateMask: 'specialHours' },
      body: {
        name: settings.locationName,
        specialHours: { specialHourPeriods: merged },
      },
    });
    await saveSettings({
      lastSyncAt: new Date().toISOString(),
      lastSyncStartDate: today,
      lastSyncEndDate: addDays(today, days - 1),
      lastSyncPeriods: replacement.length,
      lastError: null,
    });
    return { success: true, days, periods: replacement.length, startDate: today, endDate: addDays(today, days - 1) };
  } catch (err) {
    await saveSettings({ lastError: err.message }).catch(() => {});
    throw err;
  }
}

/** Debounced automatic sync after calendar edits or Google Calendar pulls. */
export function scheduleSync(getActivities, delayMs = 20_000) {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  pendingTimer = setTimeout(async () => {
    pendingTimer = null;
    if (syncInFlight) {
      rerunRequested = true;
      return;
    }
    syncInFlight = true;
    try {
      do {
        rerunRequested = false;
        await syncOpeningHours(getActivities() || []);
      } while (rerunRequested);
    } catch (err) {
      console.error('Google Business Profile hours sync failed:', err.message);
    } finally {
      syncInFlight = false;
    }
  }, delayMs);
  if (typeof pendingTimer.unref === 'function') pendingTimer.unref();
}

export async function getStatus() {
  const settings = await loadSettings({ force: true });
  return {
    configured: clientConfigured(),
    connected: isConnected(settings),
    ready: isConnected(settings) && !!settings.locationName,
    connectedEmail: settings.connectedEmail || null,
    connectedAt: settings.connectedAt || null,
    locationName: settings.locationName || null,
    locationTitle: settings.locationTitle || null,
    locationAddress: settings.locationAddress || null,
    locations: Array.isArray(settings.locations) ? settings.locations : [],
    lastSyncAt: settings.lastSyncAt || null,
    lastSyncStartDate: settings.lastSyncStartDate || null,
    lastSyncEndDate: settings.lastSyncEndDate || null,
    lastSyncPeriods: Number(settings.lastSyncPeriods) || 0,
    syncDays: DEFAULT_SYNC_DAYS,
    error: settings.lastError || null,
  };
}

export async function disconnect() {
  await clearSettings();
  return { success: true, connected: false, ready: false };
}

export function oauthCallbackRedirectUrl() {
  return `${frontendBase()}/business-settings?tab=integrations&googleBusiness=connected`;
}

export const googleBusinessProfileService = {
  clientConfigured,
  backgroundSyncEnabled,
  getAuthUrl,
  getStatus,
  completeOAuth,
  disconnect,
  listLocations,
  selectLocation,
  syncOpeningHours,
  scheduleSync,
  oauthCallbackRedirectUrl,
  frontendBase,
  loadSettings,
};
