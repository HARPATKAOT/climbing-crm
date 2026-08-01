/**
 * Agenda digests for the business owner.
 *
 * Daily  — every evening, tomorrow's schedule hour by hour.
 * Weekly — Saturday evening, the coming week condensed to one line per day.
 *
 * Both cover the wall calendar (CRM activities) *and* the Google calendars
 * chosen as overlays, so meetings the owner was invited to show up too.
 * Settings live in app_settings key `agenda_digest`.
 */

import { db } from './db.js';
import { supa } from './supa.js';
import { whatsappService } from './whatsapp.js';
import { googleCalendarService } from './googleCalendar.js';
import { getPhoneSessionWindow } from './channels/sessionWindow.js';
import { israelDateStr, activityDateRange } from './attendanceUtils.js';
import { israelClockParts } from './whatsappSchedule.js';
import { sendEmail } from './email.js';

const SETTINGS_KEY = 'agenda_digest';

const HEBREW_WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const DEFAULT_AGENDA_SETTINGS = {
  dailyEnabled: false,
  weeklyEnabled: false,
  channel: 'whatsapp', // whatsapp | email | both
  phone: '',
  email: '',
  dailyTime: '20:00',
  weeklyDay: 6, // 6 = Saturday
  weeklyTime: '20:00',
  includeGoogle: true,
  // Approved Meta template with a single body variable — used when the 24h
  // WhatsApp window to the owner's number is closed.
  templateName: '',
  lastDailySentFor: null,
  lastWeeklySentFor: null,
};

let memorySettings = null;

export function addDays(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(isoDate).slice(0, 10);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayIndex(isoDate) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return 0;
  return d.getUTCDay();
}

/** "3.8" — day and month, the way a person says a date out loud. */
export function shortDate(isoDate) {
  const [, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!m || !d) return String(isoDate);
  return `${Number(d)}.${Number(m)}`;
}

export function hebrewDayLabel(isoDate) {
  return `יום ${HEBREW_WEEKDAYS[weekdayIndex(isoDate)]} ${shortDate(isoDate)}`;
}

function normalizeTime(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Schedule times are strict: a typo falls back to the default rather than being
 * clamped, so a slip of the finger cannot move the send to an odd hour.
 */
function parseHm(value, fallback) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function normalizeAgendaSettings(raw = {}) {
  const merged = { ...DEFAULT_AGENDA_SETTINGS, ...(raw || {}) };
  const weeklyDay = Number(merged.weeklyDay);
  return {
    ...merged,
    dailyEnabled: !!merged.dailyEnabled,
    weeklyEnabled: !!merged.weeklyEnabled,
    includeGoogle: merged.includeGoogle !== false,
    channel: ['whatsapp', 'email', 'both'].includes(merged.channel) ? merged.channel : 'whatsapp',
    phone: String(merged.phone || '').trim(),
    email: String(merged.email || '').trim(),
    templateName: String(merged.templateName || '').trim(),
    dailyTime: parseHm(merged.dailyTime, DEFAULT_AGENDA_SETTINGS.dailyTime),
    weeklyTime: parseHm(merged.weeklyTime, DEFAULT_AGENDA_SETTINGS.weeklyTime),
    weeklyDay: Number.isInteger(weeklyDay) && weeklyDay >= 0 && weeklyDay <= 6 ? weeklyDay : 6,
  };
}

export async function loadAgendaSettings() {
  if (memorySettings) return memorySettings;
  const remote = await supa.getAppSetting(SETTINGS_KEY).catch(() => null);
  memorySettings = normalizeAgendaSettings(remote && typeof remote === 'object' ? remote : {});
  return memorySettings;
}

export async function saveAgendaSettings(patch = {}) {
  const current = await loadAgendaSettings();
  memorySettings = normalizeAgendaSettings({ ...current, ...patch });
  await supa.setAppSetting(SETTINGS_KEY, memorySettings);
  return memorySettings;
}

/** Test seam — drops the cached copy so the next read hits the store. */
export function resetAgendaSettingsCache() {
  memorySettings = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collecting what is on the calendar
// ─────────────────────────────────────────────────────────────────────────────

const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);

/** CRM activities (the wall calendar), one entry per day the activity spans. */
export function wallCalendarItems(activities = [], { from, to } = {}) {
  const out = [];
  for (const activity of activities || []) {
    if (!activity?.date) continue;
    if (CANCELLED_STATUSES.has(String(activity.status || '').toLowerCase())) continue;
    for (const day of activityDateRange(activity)) {
      if (from && day < from) continue;
      if (to && day > to) continue;
      out.push({
        date: day,
        allDay: !!activity.all_day,
        time: activity.all_day ? '' : normalizeTime(activity.start_time),
        endTime: activity.all_day ? '' : normalizeTime(activity.end_time),
        title: String(activity.name || 'פעילות').trim(),
        location: String(activity.location || '').trim(),
        source: 'wall',
        calendarName: '',
      });
    }
  }
  return out;
}

/**
 * Google overlay events, one entry per day.
 * All-day events carry an *exclusive* end date, timed ones stay on their start day
 * so an event that runs past midnight is not listed twice.
 */
export function googleOverlayItems(events = [], { from, to } = {}) {
  const out = [];
  for (const event of events || []) {
    if (!event?.date) continue;
    let lastDay = event.date;
    if (event.all_day && event.end_date && event.end_date > event.date) {
      lastDay = addDays(event.end_date, -1);
    }
    let day = event.date;
    for (let guard = 0; guard < 120; guard += 1) {
      if ((!from || day >= from) && (!to || day <= to)) {
        out.push({
          date: day,
          allDay: !!event.all_day,
          time: event.all_day ? '' : normalizeTime(event.start_time),
          endTime: event.all_day ? '' : normalizeTime(event.end_time),
          title: String(event.name || '(ללא כותרת)').trim(),
          location: String(event.location || '').trim(),
          source: 'google',
          calendarName: String(event.calendar_name || '').trim(),
        });
      }
      if (day >= lastDay) break;
      day = addDays(day, 1);
    }
  }
  return out;
}

export function sortAgendaItems(items = []) {
  return [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const aAll = a.allDay || !a.time;
    const bAll = b.allDay || !b.time;
    if (aAll !== bAll) return aAll ? -1 : 1;
    if (a.time !== b.time) return a.time < b.time ? -1 : 1;
    return String(a.title).localeCompare(String(b.title), 'he');
  });
}

/** Everything scheduled between two dates (inclusive), both calendars merged. */
export async function collectAgendaItems({ from, to, includeGoogle = true } = {}) {
  // The activities cache goes stale between requests — read through to the store.
  if (supa.isEnabled?.()) {
    try {
      const rows = await supa.getAll('activities');
      if (rows) db.set('activities', rows);
    } catch (err) {
      console.warn('Agenda digest: activities refresh failed:', err.message);
    }
  }

  const items = wallCalendarItems(db.get('activities') || [], { from, to });

  if (includeGoogle) {
    try {
      const events = await googleCalendarService.listOverlayEvents({ from, to });
      items.push(...googleOverlayItems(events, { from, to }));
    } catch (err) {
      console.warn('Agenda digest: Google overlay fetch failed:', err.message);
    }
  }

  return sortAgendaItems(items);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wording
// ─────────────────────────────────────────────────────────────────────────────

function timeLabel(item) {
  if (item.allDay || !item.time) return 'כל היום';
  if (item.endTime && item.endTime !== item.time) return `${item.time}–${item.endTime}`;
  return item.time;
}

function suffix(item) {
  const parts = [];
  if (item.location) parts.push(item.location);
  if (item.source === 'google' && item.calendarName) parts.push(item.calendarName);
  return parts.length ? ` (${parts.join(' · ')})` : '';
}

/** Tomorrow's plan, hour by hour. */
export function formatDailyDigest(date, items = []) {
  const dayItems = sortAgendaItems(items.filter((i) => i.date === date));
  const header = `🗓️ מחר — ${hebrewDayLabel(date)}`;
  if (!dayItems.length) {
    return `${header}\n\nאין כלום ביומן. יום פנוי 🙂`;
  }
  const lines = dayItems.map((item) => `${timeLabel(item)} · ${item.title}${suffix(item)}`);
  return `${header}\n\n${lines.join('\n')}`;
}

/** The coming week, one line per day, names only. */
export function formatWeeklyDigest(startDate, items = [], days = 7) {
  const endDate = addDays(startDate, days - 1);
  const header = `📅 השבוע הקרוב (${shortDate(startDate)}–${shortDate(endDate)})`;
  const sorted = sortAgendaItems(items);
  const lines = [];

  for (let i = 0; i < days; i += 1) {
    const day = addDays(startDate, i);
    const titles = sorted
      .filter((item) => item.date === day)
      .map((item) => (item.allDay || !item.time ? item.title : `${item.time} ${item.title}`));
    lines.push(
      titles.length
        ? `${hebrewDayLabel(day)} — ${titles.join(', ')}`
        : `${hebrewDayLabel(day)} — פנוי`
    );
  }

  return `${header}\n\n${lines.join('\n')}`;
}

/**
 * Meta rejects newlines, tabs and long runs of spaces inside a template
 * variable, so a digest sent as a template collapses onto one line.
 */
export function flattenForTemplate(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' | ')
    .replace(/\s{4,}/g, ' ')
    .slice(0, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────────────────────

async function deliverViaWhatsapp(settings, text) {
  if (!settings.phone) return { sent: false, reason: 'no_phone' };

  const windowOpen = getPhoneSessionWindow(db.get('messages') || [], settings.phone).open;
  if (windowOpen) {
    const result = await whatsappService.sendTextMessage(settings.phone, text, false, {
      clip: false,
      source: 'agenda_digest',
    });
    return result?.success
      ? { sent: true, via: 'whatsapp_freeform' }
      : { sent: false, reason: result?.error || 'send_failed' };
  }

  if (!settings.templateName) return { sent: false, reason: 'window_closed_no_template' };

  const result = await whatsappService.sendTemplateMessage(
    settings.phone,
    settings.templateName,
    [flattenForTemplate(text)]
  );
  return result?.success
    ? { sent: true, via: 'whatsapp_template' }
    : { sent: false, reason: result?.error || 'template_failed' };
}

async function deliverViaEmail(settings, text, subject) {
  if (!settings.email) return { sent: false, reason: 'no_email' };
  const result = await sendEmail({ to: settings.email, subject, text });
  return result?.sent
    ? { sent: true, via: 'email' }
    : { sent: false, reason: result?.error || (result?.stub ? 'email_not_configured' : 'email_failed') };
}

/** Send one digest over whichever channels the settings ask for. */
export async function deliverAgenda(settings, text, subject) {
  const attempts = [];
  if (settings.channel === 'whatsapp' || settings.channel === 'both') {
    attempts.push(await deliverViaWhatsapp(settings, text));
  }
  if (settings.channel === 'email' || settings.channel === 'both') {
    attempts.push(await deliverViaEmail(settings, text, subject));
  }
  const sent = attempts.some((a) => a.sent);
  return {
    sent,
    attempts,
    reason: sent ? null : attempts.map((a) => a.reason).filter(Boolean).join(', ') || 'no_channel',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Building + sending
// ─────────────────────────────────────────────────────────────────────────────

/** Tomorrow's digest text, without sending anything. */
export async function buildDailyDigest(date, settings) {
  const cfg = settings || (await loadAgendaSettings());
  const items = await collectAgendaItems({
    from: date,
    to: date,
    includeGoogle: cfg.includeGoogle,
  });
  return { date, items, text: formatDailyDigest(date, items) };
}

/** The coming week's digest text, without sending anything. */
export async function buildWeeklyDigest(startDate, settings, days = 7) {
  const cfg = settings || (await loadAgendaSettings());
  const endDate = addDays(startDate, days - 1);
  const items = await collectAgendaItems({
    from: startDate,
    to: endDate,
    includeGoogle: cfg.includeGoogle,
  });
  return { startDate, endDate, items, text: formatWeeklyDigest(startDate, items, days) };
}

export async function sendDailyDigest(date, { settings, record = true } = {}) {
  const cfg = settings || (await loadAgendaSettings());
  const { text, items } = await buildDailyDigest(date, cfg);
  const result = await deliverAgenda(cfg, text, `מה מתוכנן מחר — ${hebrewDayLabel(date)}`);
  if (result.sent && record) await saveAgendaSettings({ lastDailySentFor: date });
  return { kind: 'daily', date, events: items.length, text, ...result };
}

export async function sendWeeklyDigest(startDate, { settings, record = true } = {}) {
  const cfg = settings || (await loadAgendaSettings());
  const { text, items, endDate } = await buildWeeklyDigest(startDate, cfg);
  const result = await deliverAgenda(cfg, text, 'מה מתוכנן השבוע');
  if (result.sent && record) await saveAgendaSettings({ lastWeeklySentFor: startDate });
  return { kind: 'weekly', startDate, endDate, events: items.length, text, ...result };
}

/**
 * What the scheduler should do right now — pure, so the timing rules are testable.
 * `lastDailySentFor` / `lastWeeklySentFor` hold the date each digest covered,
 * which keeps a restart from re-sending the same evening's reminder.
 */
export function agendaDigestsDue(settings, { weekday, time, tomorrow }) {
  const daily =
    !!settings.dailyEnabled &&
    time >= settings.dailyTime &&
    settings.lastDailySentFor !== tomorrow;
  const weekly =
    !!settings.weeklyEnabled &&
    weekday === settings.weeklyDay &&
    time >= settings.weeklyTime &&
    settings.lastWeeklySentFor !== tomorrow;
  return { daily, weekly };
}

/** Called on a timer — sends whatever this evening still owes. */
export async function runAgendaDigestsIfDue(now = new Date()) {
  try {
    const settings = await loadAgendaSettings();
    if (!settings.dailyEnabled && !settings.weeklyEnabled) return null;

    const { weekday, time } = israelClockParts(now);
    const tomorrow = addDays(israelDateStr(now), 1);
    const due = agendaDigestsDue(settings, { weekday, time, tomorrow });
    if (!due.daily && !due.weekly) return null;

    const out = {};
    if (due.daily) {
      out.daily = await sendDailyDigest(tomorrow);
      console.log(
        `🗓️ Daily agenda (${tomorrow}): events=${out.daily.events} sent=${out.daily.sent}` +
          (out.daily.reason ? ` reason=${out.daily.reason}` : '')
      );
    }
    if (due.weekly) {
      out.weekly = await sendWeeklyDigest(tomorrow);
      console.log(
        `📅 Weekly agenda (${tomorrow}+6): events=${out.weekly.events} sent=${out.weekly.sent}` +
          (out.weekly.reason ? ` reason=${out.weekly.reason}` : '')
      );
    }
    return out;
  } catch (err) {
    console.error('Agenda digest run failed:', err.message);
    return null;
  }
}

export const agendaDigestService = {
  loadAgendaSettings,
  saveAgendaSettings,
  buildDailyDigest,
  buildWeeklyDigest,
  sendDailyDigest,
  sendWeeklyDigest,
  runAgendaDigestsIfDue,
  collectAgendaItems,
};
