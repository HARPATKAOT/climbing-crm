/**
 * Google Calendar two-way sync for CRM activities.
 * Tokens + calendar id live in app_settings key `google_calendar`.
 */

import crypto from 'crypto';
import { supa } from './supa.js';

const SETTINGS_KEY = 'google_calendar';
const WALL_CALENDAR_NAME = 'יומן';
const LEGACY_CALENDAR_NAMES = [
  'הרפתקאות',
  'My Wall — פעילויות',
  'My Wall - פעילויות',
  'יומן פעילויות',
];
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CAL_API = 'https://www.googleapis.com/calendar/v3';

const TYPE_COLOR = {
  event: '6', // orange
  trip: '9', // blue
  personal_training: '2', // green
  route_building: '3', // purple
  opening_hours: '7', // cyan
  training_vacation: '4', // flamingo / pink
  other: '8', // gray
};

/**
 * A colour on an event that came from Google is a guess, not a fact — whoever
 * set it was picking a colour, not classifying anything. It is used only to
 * seed a type on first sync; anything unrecognised lands on "other" and staff
 * set it properly. A real event is one created here, with a payer, participants
 * and a price behind it.
 */
const COLOR_TO_TYPE = {
  '6': 'event',
  '9': 'trip',
  '1': 'trip',
  '2': 'personal_training',
  '7': 'opening_hours',
  '8': 'other',
  '3': 'route_building',
  '4': 'training_vacation',
};

let memorySettings = null;
let pushInFlight = new Set(); // google_event_id / activity id being pushed

function clientConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Background pull/push must not run on a local API that shares the live
 * Supabase row — that was overwriting fresh OAuth tokens every few minutes.
 * Override with GOOGLE_BACKGROUND_SYNC=1 (force on) or =0 (force off).
 */
export function backgroundSyncEnabled() {
  const flag = String(process.env.GOOGLE_BACKGROUND_SYNC || '').trim().toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(flag)) return false;
  if (['1', 'true', 'on', 'yes'].includes(flag)) return true;
  const redirect = String(process.env.GOOGLE_REDIRECT_URI || redirectUri());
  if (/localhost|127\.0\.0\.1/i.test(redirect)) return false;
  return process.env.NODE_ENV === 'production';
}

function connectionMode() {
  if (clientConfigured()) return 'oauth';
  return null;
}

function redirectUri() {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${publicApiBase()}/api/google-calendar/oauth/callback`
  );
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

async function loadSettings({ force = false } = {}) {
  // Always re-read before mutating: a local server + the live API share one
  // app_settings row. Stale in-memory tokens were overwriting fresh OAuth reconnects.
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
  return !!(settings?.refreshToken && settings?.calendarId);
}

export function getAuthUrl(state = 'crm') {
  if (!clientConfigured()) {
    throw new Error('חסרים מפתחות גוגל בשרת');
  }
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

async function refreshAccessToken(settings, { retried = false } = {}) {
  if (!settings?.refreshToken) throw new Error('אין חיבור לגוגל');
  const triedToken = settings.refreshToken;
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: triedToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error_description || data.error || 'רענון מפתח נכשל';
    // Another process may have just reconnected — pick up its token once.
    if (!retried) {
      const fresh = await loadSettings({ force: true });
      if (fresh.refreshToken && fresh.refreshToken !== triedToken) {
        return refreshAccessToken(fresh, { retried: true });
      }
    }
    // Persist so status/UI can show «דורש טיפול» without waiting for a full sync.
    // saveSettings re-reads remote first so we never write an older refreshToken back.
    try {
      await saveSettings({ lastError: msg });
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000 - 60_000;
  const patch = {
    accessToken: data.access_token,
    accessTokenExpiresAt: expiresAt,
    lastError: null,
  };
  // Google sometimes rotates the refresh token — persist the new one.
  if (data.refresh_token) patch.refreshToken = data.refresh_token;
  return saveSettings(patch);
}

async function getAccessToken() {
  let settings = await loadSettings({ force: true });
  if (!settings.refreshToken) throw new Error('אין חיבור לגוגל');
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

async function googleFetch(path, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken();
  const url = new URL(path.startsWith('http') ? path : `${CAL_API}${path}`);
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

async function ensureWallCalendar(settings) {
  if (settings.calendarId) {
    try {
      const cal = await googleFetch(`/calendars/${encodeURIComponent(settings.calendarId)}`);
      return { calendarId: cal.id, calendarName: cal.summary || WALL_CALENDAR_NAME };
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  const list = await googleFetch('/users/me/calendarList');
  const existing = (list.items || []).find(
    (c) => c.summary === WALL_CALENDAR_NAME || LEGACY_CALENDAR_NAMES.includes(c.summary)
  );
  if (existing) {
    // Rename legacy calendar to the current product name
    if (existing.summary !== WALL_CALENDAR_NAME) {
      try {
        await googleFetch(`/calendars/${encodeURIComponent(existing.id)}`, {
          method: 'PUT',
          body: {
            summary: WALL_CALENDAR_NAME,
            description: 'יומן אירועים — ימי הולדת, טיולים ואירועים (לא חוגים)',
            timeZone: 'Asia/Jerusalem',
          },
        });
      } catch (err) {
        console.warn('Could not rename Google calendar:', err.message);
      }
    }
    return { calendarId: existing.id, calendarName: WALL_CALENDAR_NAME };
  }

  const created = await googleFetch('/calendars', {
    method: 'POST',
    body: {
      summary: WALL_CALENDAR_NAME,
      description: 'יומן אירועים — ימי הולדת, טיולים ואירועים (לא חוגים)',
      timeZone: 'Asia/Jerusalem',
    },
  });
  return { calendarId: created.id, calendarName: created.summary };
}

async function startWatch(calendarId) {
  const channelId = crypto.randomUUID();
  const address = `${publicApiBase()}/api/google-calendar/webhook`;
  try {
    const watch = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST',
      body: {
        id: channelId,
        type: 'web_hook',
        address,
        // ~7 days (Google max ~1 week for calendar watch)
        expiration: String(Date.now() + 6.5 * 24 * 60 * 60 * 1000),
      },
    });
    return {
      channelId: watch.id || channelId,
      channelResourceId: watch.resourceId || null,
      channelExpiration: watch.expiration ? Number(watch.expiration) : null,
    };
  } catch (err) {
    console.warn('Google Calendar watch setup failed:', err.message);
    return {
      channelId: null,
      channelResourceId: null,
      channelExpiration: null,
      watchError: err.message,
    };
  }
}

async function stopWatch(settings) {
  if (!settings?.channelId || !settings?.channelResourceId) return;
  try {
    await googleFetch('/channels/stop', {
      method: 'POST',
      body: {
        id: settings.channelId,
        resourceId: settings.channelResourceId,
      },
    });
  } catch (err) {
    console.warn('Google Calendar stop watch failed:', err.message);
  }
}

export function daysInclusive(startDate, endDate) {
  const start = String(startDate || '').slice(0, 10);
  const end = String(endDate || '').slice(0, 10);
  if (!start) return 1;
  if (!end || end <= start) return 1;
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  const diff = Math.round((b - a) / (24 * 60 * 60 * 1000));
  return Math.max(1, diff + 1);
}

function activityToGoogleEvent(activity) {
  const type = activity.type || 'other';
  const colorId = TYPE_COLOR[type] || TYPE_COLOR.other;
  const descriptionParts = [];
  if (activity.description) descriptionParts.push(activity.description);
  if (activity.contact_name || activity.contact_phone) {
    descriptionParts.push(
      `איש קשר: ${[activity.contact_name, activity.contact_phone].filter(Boolean).join(' · ')}`
    );
  }
  if (activity.price) descriptionParts.push(`מחיר: ${activity.price}`);
  if (activity.max_participants) descriptionParts.push(`מקסימום משתתפים: ${activity.max_participants}`);
  if (activity.notes) descriptionParts.push(`הערות: ${activity.notes}`);
  descriptionParts.push(`סוג: ${type}`);

  const event = {
    summary: activity.name || 'פעילות',
    description: descriptionParts.join('\n'),
    location: activity.location || '',
    colorId,
    extendedProperties: {
      private: {
        crmActivityId: String(activity.id),
        crmActivityType: type,
      },
    },
  };

  const date = activity.date;
  if (!date) throw new Error('חסר תאריך לפעילות');
  const endDateInclusive = activity.end_date && String(activity.end_date).slice(0, 10) > String(date).slice(0, 10)
    ? String(activity.end_date).slice(0, 10)
    : null;
  const spanDays = daysInclusive(date, endDateInclusive || date);

  if (activity.all_day) {
    // Google all-day end is exclusive
    const endExclusive = addDays(endDateInclusive || date, 1);
    event.start = { date };
    event.end = { date: endExclusive };
    event.recurrence = [];
  } else {
    const startTime = normalizeTime(activity.start_time) || '09:00';
    let endTime = normalizeTime(activity.end_time) || addHour(startTime);
    // Overnight within a single calendar day span: end earlier than start → next day
    // Multi-day camps use same daily hours (end_time > start_time) + RRULE.
    if (spanDays > 1 && timeToMinutes(endTime) > timeToMinutes(startTime)) {
      event.start = { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Jerusalem' };
      event.end = { dateTime: `${date}T${endTime}:00`, timeZone: 'Asia/Jerusalem' };
      event.recurrence = [`RRULE:FREQ=DAILY;COUNT=${spanDays}`];
    } else {
      let endDate = date;
      if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
        endDate = addDays(date, 1);
      }
      event.start = { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Jerusalem' };
      event.end = { dateTime: `${endDate}T${endTime}:00`, timeZone: 'Asia/Jerusalem' };
      event.recurrence = [];
    }
  }
  return event;
}

function normalizeTime(t) {
  if (!t) return '';
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
}

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function addHour(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const nh = (h + 1) % 24;
  return `${String(nh).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseRecurrenceEndDate(startDate, recurrence) {
  if (!startDate || !Array.isArray(recurrence) || !recurrence.length) return null;
  const joined = recurrence.join('\n');
  const countMatch = joined.match(/COUNT=(\d+)/i);
  if (countMatch) {
    const count = Number(countMatch[1]);
    if (count > 1) return addDays(startDate, count - 1);
    return null;
  }
  const untilMatch = joined.match(/UNTIL=(\d{8})(?:T\d{6}Z?)?/i);
  if (untilMatch) {
    const raw = untilMatch[1];
    const untilDate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (untilDate > startDate) return untilDate;
  }
  return null;
}

function googleEventToActivityFields(event) {
  const privateProps = event.extendedProperties?.private || {};
  let type = privateProps.crmActivityType || COLOR_TO_TYPE[String(event.colorId)] || 'other';
  if (!TYPE_COLOR[type]) type = 'other';

  const allDay = !!(event.start?.date && !event.start?.dateTime);
  let date = '';
  let end_date = null;
  let start_time = '';
  let end_time = '';

  if (allDay) {
    date = event.start.date;
    // Google all-day end is exclusive
    const exclusiveEnd = event.end?.date || '';
    if (exclusiveEnd && exclusiveEnd > addDays(date, 1)) {
      end_date = addDays(exclusiveEnd, -1);
    }
  } else if (event.start?.dateTime) {
    const start = parseJerusalemParts(event.start.dateTime);
    const end = event.end?.dateTime ? parseJerusalemParts(event.end.dateTime) : null;
    date = start.date;
    start_time = start.time;
    end_time = end?.time || '';
    end_date = parseRecurrenceEndDate(date, event.recurrence);
    // Timed multi-day block without RRULE (rare): keep as overnight / single start date
  }

  const contact = parseContactFromDescription(event.description || '');

  return {
    name: event.summary || 'פעילות מגוגל',
    type,
    status: event.status === 'cancelled' ? 'cancelled' : 'open',
    date: date || null,
    end_date: end_date || null,
    start_time: start_time || null,
    end_time: end_time || null,
    location: event.location || '',
    description: stripCrmMetaFromDescription(event.description || ''),
    all_day: allDay,
    contact_name: contact.name || '',
    contact_phone: contact.phone || '',
    google_event_id: event.id,
    google_etag: event.etag || null,
    synced_at: new Date().toISOString(),
  };
}

function parseJerusalemParts(iso) {
  // Prefer wall-clock in Asia/Jerusalem
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

function parseContactFromDescription(desc) {
  const m = String(desc).match(/איש קשר:\s*([^\n]+)/);
  if (!m) return { name: '', phone: '' };
  const parts = m[1].split('·').map((s) => s.trim());
  if (parts.length >= 2) return { name: parts[0], phone: parts[1] };
  const phoneMatch = parts[0].match(/0\d[\d\- ]{7,}/);
  if (phoneMatch) return { name: parts[0].replace(phoneMatch[0], '').trim(), phone: phoneMatch[0].trim() };
  return { name: parts[0], phone: '' };
}

function stripCrmMetaFromDescription(desc) {
  return String(desc || '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t.startsWith('איש קשר:')) return false;
      if (t.startsWith('מחיר:')) return false;
      if (t.startsWith('מקסימום משתתפים:')) return false;
      if (t.startsWith('הערות:')) return false;
      if (t.startsWith('סוג:')) return false;
      return true;
    })
    .join('\n')
    .trim();
}

export async function getStatus() {
  const settings = await loadSettings({ force: true });
  return {
    configured: clientConfigured(),
    connected: isConnected(settings),
    calendarId: settings.calendarId || null,
    calendarName: settings.calendarName || null,
    connectedEmail: settings.connectedEmail || null,
    connectedAt: settings.connectedAt || null,
    lastSyncAt: settings.lastSyncAt || null,
    watchActive: !!(settings.channelId && settings.channelResourceId),
    watchExpiration: settings.channelExpiration || null,
    overlayCalendarIds: Array.isArray(settings.overlayCalendarIds) ? settings.overlayCalendarIds : [],
    error: settings.lastError || null,
  };
}

/** List all Google calendars visible to the connected account. */
export async function listCalendars() {
  const settings = await loadSettings();
  if (!isConnected(settings)) throw new Error('אין חיבור לגוגל');

  const items = [];
  let pageToken = null;
  do {
    const page = await googleFetch('/users/me/calendarList', {
      query: {
        maxResults: 250,
        pageToken: pageToken || undefined,
      },
    });
    for (const c of page.items || []) {
      items.push({
        id: c.id,
        name: c.summary || c.id,
        primary: !!c.primary,
        accessRole: c.accessRole || '',
        backgroundColor: c.backgroundColor || c.colorId || null,
        foregroundColor: c.foregroundColor || null,
        selected: !!c.selected,
        isWallCalendar: c.id === settings.calendarId,
      });
    }
    pageToken = page.nextPageToken || null;
  } while (pageToken);

  items.sort((a, b) => {
    if (a.isWallCalendar !== b.isWallCalendar) return a.isWallCalendar ? -1 : 1;
    if (a.primary !== b.primary) return a.primary ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'he');
  });
  return items;
}

export async function setOverlayCalendars(calendarIds = []) {
  const settings = await loadSettings();
  if (!isConnected(settings)) throw new Error('אין חיבור לגוגל');
  const ids = [...new Set(
    (Array.isArray(calendarIds) ? calendarIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
      // Wall calendar is already the sync source — no need as overlay
      .filter((id) => id !== settings.calendarId)
  )];
  await saveSettings({ overlayCalendarIds: ids });
  return { overlayCalendarIds: ids };
}

/**
 * Read-only events from selected overlay calendars for a date range.
 * Does not write into CRM activities.
 */
export async function listOverlayEvents({ from, to } = {}) {
  const settings = await loadSettings();
  if (!isConnected(settings)) return [];
  const ids = Array.isArray(settings.overlayCalendarIds) ? settings.overlayCalendarIds : [];
  if (!ids.length) return [];

  const timeMin = from
    ? new Date(`${from}T00:00:00+03:00`).toISOString()
    : new Date(Date.now() - 7 * 86400000).toISOString();
  const timeMax = to
    ? new Date(`${addDays(to, 1)}T00:00:00+03:00`).toISOString()
    : new Date(Date.now() + 60 * 86400000).toISOString();

  // Resolve calendar names/colors once
  let calendars = [];
  try {
    calendars = await listCalendars();
  } catch {
    calendars = [];
  }
  const calMeta = new Map(calendars.map((c) => [c.id, c]));

  const events = [];
  for (const calendarId of ids) {
    if (calendarId === settings.calendarId) continue;
    let pageToken = null;
    do {
      let page;
      try {
        page = await googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
          query: {
            timeMin,
            timeMax,
            singleEvents: true,
            orderBy: 'startTime',
            maxResults: 250,
            pageToken: pageToken || undefined,
          },
        });
      } catch (err) {
        console.warn(`Overlay fetch failed for ${calendarId}:`, err.message);
        break;
      }
      const meta = calMeta.get(calendarId) || { id: calendarId, name: calendarId };
      for (const ev of page.items || []) {
        if (!ev || ev.status === 'cancelled') continue;
        const allDay = !!(ev.start?.date && !ev.start?.dateTime);
        let date = '';
        let start_time = '';
        let end_time = '';
        let end_date = '';
        if (allDay) {
          date = ev.start.date;
          end_date = ev.end?.date || addDays(date, 1);
        } else if (ev.start?.dateTime) {
          const start = parseJerusalemParts(ev.start.dateTime);
          const end = ev.end?.dateTime ? parseJerusalemParts(ev.end.dateTime) : null;
          date = start.date;
          start_time = start.time;
          end_time = end?.time || '';
          end_date = end?.date || date;
        } else {
          continue;
        }
        events.push({
          id: `overlay:${calendarId}:${ev.id}`,
          google_event_id: ev.id,
          calendar_id: calendarId,
          calendar_name: meta.name || calendarId,
          color: meta.backgroundColor || '#64748B',
          name: ev.summary || '(ללא כותרת)',
          date,
          end_date: end_date || date,
          start_time: start_time || null,
          end_time: end_time || null,
          all_day: allDay,
          location: ev.location || '',
          description: ev.description || '',
          overlay: true,
          read_only: !canWriteCalendar(meta.accessRole),
          access_role: meta.accessRole || '',
        });
      }
      pageToken = page.nextPageToken || null;
    } while (pageToken);
  }

  return events;
}

function buildGoogleEventTimes({ date, start_time, end_time, all_day }) {
  if (!date) throw new Error('חסר תאריך');
  if (all_day) {
    return {
      start: { date },
      end: { date: addDays(date, 1) },
    };
  }
  const startTime = normalizeTime(start_time) || '09:00';
  let endTime = normalizeTime(end_time) || addHour(startTime);
  let endDate = date;
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    endDate = addDays(date, 1);
  }
  return {
    start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Jerusalem' },
    end: { dateTime: `${endDate}T${endTime}:00`, timeZone: 'Asia/Jerusalem' },
  };
}

function canWriteCalendar(accessRole) {
  return ['owner', 'writer'].includes(String(accessRole || ''));
}

/** Update an event on an overlay (non-wall) Google calendar. */
export async function updateOverlayEvent({ calendarId, eventId, patch = {} } = {}) {
  const settings = await loadSettings();
  if (!isConnected(settings)) throw new Error('אין חיבור לגוגל');
  if (!calendarId || !eventId) throw new Error('חסר מזהה אירוע');
  if (calendarId === settings.calendarId) {
    throw new Error('אירועי יומן הקיר נערכים דרך המערכת הרגילה');
  }

  const metaList = await listCalendars().catch(() => []);
  const meta = metaList.find((c) => c.id === calendarId) || {};
  if (!canWriteCalendar(meta.accessRole)) {
    throw new Error('אין הרשאת עריכה ליומן הזה בגוגל');
  }

  const existing = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
  );

  const allDay = patch.all_day !== undefined
    ? !!patch.all_day
    : !!(existing.start?.date && !existing.start?.dateTime);
  let date = patch.date;
  if (!date) {
    date = existing.start?.date
      || (existing.start?.dateTime ? parseJerusalemParts(existing.start.dateTime).date : null);
  }

  let start_time = patch.start_time;
  let end_time = patch.end_time;
  if (!allDay) {
    if (start_time === undefined || start_time === null || start_time === '') {
      start_time = existing.start?.dateTime
        ? parseJerusalemParts(existing.start.dateTime).time
        : '09:00';
    }
    if (end_time === undefined || end_time === null || end_time === '') {
      end_time = existing.end?.dateTime
        ? parseJerusalemParts(existing.end.dateTime).time
        : addHour(normalizeTime(start_time) || '09:00');
    }
  }

  const times = buildGoogleEventTimes({
    date,
    start_time,
    end_time,
    all_day: allDay,
  });

  const body = {
    summary: patch.name !== undefined ? patch.name : existing.summary,
    description: patch.description !== undefined ? patch.description : (existing.description || ''),
    location: patch.location !== undefined ? patch.location : (existing.location || ''),
    start: times.start,
    end: times.end,
  };

  const updated = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'PUT', body }
  );

  const allDayOut = !!(updated.start?.date && !updated.start?.dateTime);
  let outDate = '';
  let outStart = '';
  let outEnd = '';
  let end_date = '';
  if (allDayOut) {
    outDate = updated.start.date;
    end_date = updated.end?.date || addDays(outDate, 1);
  } else {
    const start = parseJerusalemParts(updated.start.dateTime);
    const end = updated.end?.dateTime ? parseJerusalemParts(updated.end.dateTime) : null;
    outDate = start.date;
    outStart = start.time;
    outEnd = end?.time || '';
    end_date = end?.date || outDate;
  }

  return {
    id: `overlay:${calendarId}:${updated.id}`,
    google_event_id: updated.id,
    calendar_id: calendarId,
    calendar_name: meta.name || calendarId,
    color: meta.backgroundColor || '#64748B',
    name: updated.summary || '(ללא כותרת)',
    date: outDate,
    end_date: end_date || outDate,
    start_time: outStart || null,
    end_time: outEnd || null,
    all_day: allDayOut,
    location: updated.location || '',
    description: updated.description || '',
    overlay: true,
    read_only: !canWriteCalendar(meta.accessRole),
  };
}

/** Delete an event from an overlay Google calendar. */
export async function deleteOverlayEvent({ calendarId, eventId } = {}) {
  const settings = await loadSettings();
  if (!isConnected(settings)) throw new Error('אין חיבור לגוגל');
  if (!calendarId || !eventId) throw new Error('חסר מזהה אירוע');
  if (calendarId === settings.calendarId) {
    throw new Error('אירועי יומן הקיר נמחקים דרך המערכת הרגילה');
  }
  const metaList = await listCalendars().catch(() => []);
  const meta = metaList.find((c) => c.id === calendarId) || {};
  if (!canWriteCalendar(meta.accessRole)) {
    throw new Error('אין הרשאת עריכה ליומן הזה בגוגל');
  }
  try {
    await googleFetch(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    if (err.status !== 404 && err.status !== 410) throw err;
  }
  return { success: true };
}

/** Create an event on an overlay (non-wall) Google calendar. */
export async function createOverlayEvent({ calendarId, patch = {} } = {}) {
  const settings = await loadSettings();
  if (!isConnected(settings)) throw new Error('אין חיבור לגוגל');
  if (!calendarId) throw new Error('חסר מזהה יומן');
  if (calendarId === settings.calendarId) {
    throw new Error('אירועי יומן הקיר נוצרים דרך המערכת הרגילה');
  }

  const metaList = await listCalendars().catch(() => []);
  const meta = metaList.find((c) => c.id === calendarId) || {};
  if (!canWriteCalendar(meta.accessRole)) {
    throw new Error('אין הרשאת עריכה ליומן הזה בגוגל');
  }
  if (!patch.date) throw new Error('חסר תאריך');
  if (!String(patch.name || '').trim()) throw new Error('חסרה כותרת');

  const allDay = !!patch.all_day;
  const times = buildGoogleEventTimes({
    date: patch.date,
    start_time: patch.start_time,
    end_time: patch.end_time,
    all_day: allDay,
  });

  const created = await googleFetch(
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      body: {
        summary: String(patch.name).trim(),
        description: patch.description || '',
        location: patch.location || '',
        start: times.start,
        end: times.end,
      },
    }
  );

  const allDayOut = !!(created.start?.date && !created.start?.dateTime);
  let outDate = '';
  let outStart = '';
  let outEnd = '';
  let end_date = '';
  if (allDayOut) {
    outDate = created.start.date;
    end_date = created.end?.date || addDays(outDate, 1);
  } else {
    const start = parseJerusalemParts(created.start.dateTime);
    const end = created.end?.dateTime ? parseJerusalemParts(created.end.dateTime) : null;
    outDate = start.date;
    outStart = start.time;
    outEnd = end?.time || '';
    end_date = end?.date || outDate;
  }

  return {
    id: `overlay:${calendarId}:${created.id}`,
    google_event_id: created.id,
    calendar_id: calendarId,
    calendar_name: meta.name || calendarId,
    color: meta.backgroundColor || '#64748B',
    name: created.summary || '(ללא כותרת)',
    date: outDate,
    end_date: end_date || outDate,
    start_time: outStart || null,
    end_time: outEnd || null,
    all_day: allDayOut,
    location: created.location || '',
    description: created.description || '',
    overlay: true,
    read_only: !canWriteCalendar(meta.accessRole),
  };
}

export async function completeOAuth(code) {
  if (!clientConfigured()) throw new Error('חסרים מפתחות גוגל בשרת');
  const tokens = await exchangeCode(code);
  if (!tokens.refresh_token) {
    // Never keep a previous refresh token — it may already be revoked.
    throw new Error('לא התקבל מפתח רענון מגוגל. נסו להתחבר שוב');
  }
  const expiresAt = Date.now() + (tokens.expires_in || 3600) * 1000 - 60_000;
  let settings = await saveSettings({
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: expiresAt,
    connectedAt: new Date().toISOString(),
    lastError: null,
  });
  console.log('Google Calendar OAuth connected at', settings.connectedAt);

  // Fetch user email
  try {
    const token = settings.accessToken;
    const me = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    if (me.email) settings = await saveSettings({ connectedEmail: me.email });
  } catch {
    // optional
  }

  const cal = await ensureWallCalendar(settings);
  settings = await saveSettings({
    calendarId: cal.calendarId,
    calendarName: cal.calendarName,
  });

  await stopWatch(settings);
  const watch = await startWatch(cal.calendarId);
  settings = await saveSettings({
    channelId: watch.channelId,
    channelResourceId: watch.channelResourceId,
    channelExpiration: watch.channelExpiration,
    syncToken: null,
  });

  return {
    success: true,
    ...await getStatus(),
    watchError: watch.watchError || null,
    frontendRedirect: `${frontendBase()}/activities?google=connected`,
  };
}

export async function disconnect() {
  const settings = await loadSettings();
  await stopWatch(settings);
  await clearSettings();
  return { success: true, connected: false };
}

export async function pushActivity(activity, { deleted = false } = {}) {
  const settings = await loadSettings();
  if (!isConnected(settings)) return { skipped: true, reason: 'not_connected' };

  const lockKey = activity.id || activity.google_event_id;
  if (lockKey && pushInFlight.has(lockKey)) return { skipped: true, reason: 'in_flight' };
  if (lockKey) pushInFlight.add(lockKey);

  try {
    const calendarId = settings.calendarId;
    if (deleted) {
      if (!activity.google_event_id) return { skipped: true, reason: 'no_google_id' };
      try {
        await googleFetch(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(activity.google_event_id)}`,
          { method: 'DELETE' }
        );
      } catch (err) {
        if (err.status !== 404 && err.status !== 410) throw err;
      }
      return { deleted: true, google_event_id: activity.google_event_id };
    }

    const body = activityToGoogleEvent(activity);
    let event;
    if (activity.google_event_id) {
      try {
        event = await googleFetch(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(activity.google_event_id)}`,
          { method: 'PUT', body }
        );
      } catch (err) {
        if (err.status === 404 || err.status === 410) {
          event = await googleFetch(
            `/calendars/${encodeURIComponent(calendarId)}/events`,
            { method: 'POST', body }
          );
        } else {
          throw err;
        }
      }
    } else {
      event = await googleFetch(
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: 'POST', body }
      );
    }

    return {
      google_event_id: event.id,
      google_etag: event.etag || null,
      synced_at: new Date().toISOString(),
    };
  } finally {
    if (lockKey) pushInFlight.delete(lockKey);
  }
}

/**
 * Incremental pull from Google into local activities via db helpers.
 * @param {object} deps - { getActivities, upsertFromGoogle, deleteByGoogleId }
 */
export async function pullChanges(deps) {
  const settings = await loadSettings();
  if (!isConnected(settings)) return { skipped: true, reason: 'not_connected' };

  const calendarId = settings.calendarId;
  let syncToken = settings.syncToken || null;
  let pageToken = null;
  let created = 0;
  let updated = 0;
  let deleted = 0;
  let items = [];

  const fetchPage = async (token, page) => {
    const query = {
      maxResults: 250,
      singleEvents: true,
      showDeleted: true,
    };
    if (token) query.syncToken = token;
    else {
      query.timeMin = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      query.timeMax = new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (page) query.pageToken = page;
    return googleFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, { query });
  };

  try {
    do {
      let page;
      try {
        page = await fetchPage(syncToken, pageToken);
      } catch (err) {
        if (err.status === 410) {
          // sync token expired — full resync
          syncToken = null;
          await saveSettings({ syncToken: null });
          page = await fetchPage(null, null);
        } else {
          throw err;
        }
      }
      items = items.concat(page.items || []);
      pageToken = page.nextPageToken || null;
      if (page.nextSyncToken) {
        syncToken = page.nextSyncToken;
      }
    } while (pageToken);
  } catch (err) {
    await saveSettings({ lastError: err.message });
    throw err;
  }

  const existing = deps.getActivities() || [];
  const byGoogleId = new Map(
    existing.filter((a) => a.google_event_id).map((a) => [a.google_event_id, a])
  );
  const byCrmId = new Map(existing.map((a) => [String(a.id), a]));

  for (const event of items) {
    if (!event?.id) continue;
    const crmId = event.extendedProperties?.private?.crmActivityId;
    // Expanded recurring instances (singleEvents:true) — keep one CRM activity on the series master
    if (event.recurringEventId) {
      const masterLocal =
        byGoogleId.get(event.recurringEventId) ||
        (crmId && byCrmId.get(String(crmId))) ||
        null;
      if (masterLocal) continue;
      // Orphan instance without a CRM master: skip to avoid duplicating camp days
      continue;
    }
    const local =
      (event.id && byGoogleId.get(event.id)) ||
      (crmId && byCrmId.get(String(crmId))) ||
      null;

    if (event.status === 'cancelled') {
      if (local) {
        deps.deleteByGoogleId(event.id, local.id);
        deleted += 1;
      }
      continue;
    }

    const fields = googleEventToActivityFields(event);

    // Skip if we just pushed the same etag
    if (local?.google_etag && fields.google_etag && local.google_etag === fields.google_etag) {
      continue;
    }

    // Conflict: if local updated after google and etags differ, keep local (next push will win)
    if (local?.updated_at && event.updated) {
      const localTs = new Date(local.updated_at).getTime();
      const googleTs = new Date(event.updated).getTime();
      if (localTs > googleTs + 2000 && local.google_event_id === event.id) {
        // Local newer — push will reconcile; don't overwrite
        continue;
      }
    }

    // Prefer keeping local end_date when Google fields omit it (etag-only updates)
    if (local?.end_date && !fields.end_date) {
      fields.end_date = local.end_date;
    }

    const result = deps.upsertFromGoogle(local, fields, crmId);
    if (result === 'created') created += 1;
    else if (result === 'updated') updated += 1;
  }

  await saveSettings({
    syncToken,
    lastSyncAt: new Date().toISOString(),
    lastError: null,
  });

  // Renew watch if expiring within 24h
  const exp = settings.channelExpiration;
  if (!exp || exp < Date.now() + 24 * 60 * 60 * 1000) {
    await stopWatch(settings);
    const watch = await startWatch(calendarId);
    await saveSettings({
      channelId: watch.channelId,
      channelResourceId: watch.channelResourceId,
      channelExpiration: watch.channelExpiration,
    });
  }

  return { created, updated, deleted, total: items.length };
}

export function oauthCallbackRedirectUrl(result) {
  if (result?.frontendRedirect) return result.frontendRedirect;
  return `${frontendBase()}/activities?google=connected`;
}

export const googleCalendarService = {
  clientConfigured,
  backgroundSyncEnabled,
  getAuthUrl,
  getStatus,
  completeOAuth,
  disconnect,
  pushActivity,
  pullChanges,
  listCalendars,
  setOverlayCalendars,
  listOverlayEvents,
  updateOverlayEvent,
  deleteOverlayEvent,
  createOverlayEvent,
  loadSettings,
  publicApiBase,
  frontendBase,
  oauthCallbackRedirectUrl,
};
