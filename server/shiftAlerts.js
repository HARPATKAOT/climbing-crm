/**
 * "מחר יש לך אירוע" — the reminder an employee gets about their own shift.
 *
 * The placement itself already exists as a `work_assignments` row pointing at a
 * calendar activity; nothing new is stored for the reminder. What decides the
 * send is the employee's own choice of lead time, so the same event reaches the
 * instructor a day ahead and the counter shift two hours ahead, without two
 * different automations.
 *
 * The clock ticks every few minutes, so the window has two edges: a reminder is
 * due once the lead time is reached, and stops being due once the event has
 * started — a "reminder" that arrives while people are already climbing is
 * noise, and after a restart it would otherwise fire for every past event.
 */

import { db } from './db.js';
import { reminderLeadHours, alertSubscribers } from './staffAlerts.js';
import { sendStaffAlert, alertAlreadySent, MAX_SEND_ATTEMPTS } from './staffNotify.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Minutes Asia/Jerusalem is ahead of UTC at a given instant (DST included). */
function israelOffsetMinutes(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/**
 * A wall-clock date and time in Israel, as an epoch in milliseconds.
 * Resolved twice because the offset itself depends on the instant, and the
 * first guess can land on the wrong side of a DST change.
 */
export function israelTimeToEpoch(dateStr, hm = '00:00') {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  const [hh, mm] = String(hm || '00:00').split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  const first = naive - israelOffsetMinutes(new Date(naive)) * 60000;
  return naive - israelOffsetMinutes(new Date(first)) * 60000;
}

/** "יום ג׳, 5.8 · 16:00–22:00" — what a person reads before a date field. */
export function whenLabel({ date, start_time: start, end_time: end }) {
  const [y, m, d] = String(date || '').split('-').map(Number);
  if (!y) return '';
  const weekday = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const day = `יום ${weekday}, ${d}.${m}`;
  const hours = [start, end].filter(Boolean).join('–');
  return hours ? `${day} · ${hours}` : day;
}

function activityFor(store, assignment) {
  if (!assignment?.activity_id) return null;
  return (store.get('activities') || []).find((a) => a.id === assignment.activity_id) || null;
}

function eventName(activity, assignment) {
  return activity?.name || assignment?.role || 'משמרת';
}

/** The message body, used whenever no WhatsApp template was chosen. */
export function shiftReminderText({ activity, assignment, leadHours }) {
  const when = whenLabel({
    date: assignment.date,
    start_time: assignment.start_time || activity?.start_time,
    end_time: assignment.end_time || activity?.end_time,
  });
  return [
    leadHours >= 24 ? '⏰ תזכורת למחר' : '⏰ תזכורת',
    eventName(activity, assignment),
    when,
    activity?.location ? `מיקום: ${activity.location}` : '',
    assignment.role ? `תפקיד: ${assignment.role}` : '',
  ].filter(Boolean).join('\n');
}

export function shiftAssignedText({ activity, assignment }) {
  const when = whenLabel({
    date: assignment.date,
    start_time: assignment.start_time || activity?.start_time,
    end_time: assignment.end_time || activity?.end_time,
  });
  return [
    '📅 שובצת לאירוע',
    eventName(activity, assignment),
    when,
    activity?.location ? `מיקום: ${activity.location}` : '',
    assignment.role ? `תפקיד: ${assignment.role}` : '',
  ].filter(Boolean).join('\n');
}

function templateVars({ employee, activity, assignment }) {
  return [
    employee?.name || '',
    eventName(activity, assignment),
    assignment.date || '',
    assignment.start_time || activity?.start_time || '',
  ];
}

/**
 * Same rule as `alertAlreadySent`, against whichever store the scan reads:
 * an entry whose delivery failed is not a send, so the reminder comes back.
 */
function alreadySentIn(store, sendId) {
  if (store === db) return alertAlreadySent(sendId);
  const row = (store.get('automation_sends') || []).find((r) => r.id === sendId);
  if (!row) return false;
  if (!row.failed_at) return true;
  return Number(row.attempts || 1) >= MAX_SEND_ATTEMPTS;
}

/**
 * Reminders that should go out right now.
 * Pure apart from reading the store, so the window logic can be tested without
 * sending anything.
 */
export function dueShiftReminders({ now = new Date(), store = db } = {}) {
  const subscribers = alertSubscribers(store, 'shift_reminder');
  if (!subscribers.length) return [];
  const byEmployee = new Map(subscribers.map((e) => [String(e.id), e]));
  const at = now instanceof Date ? now.getTime() : Number(now);
  const out = [];

  for (const assignment of store.get('work_assignments') || []) {
    const employee = byEmployee.get(String(assignment?.employee_id || ''));
    if (!employee || !assignment.date) continue;

    const activity = activityFor(store, assignment);
    const startTime = assignment.start_time || activity?.start_time || '09:00';
    const start = israelTimeToEpoch(assignment.date, startTime);
    if (!Number.isFinite(start)) continue;

    const leadHours = reminderLeadHours(employee);
    const fireAt = start - leadHours * 3600000;
    if (at < fireAt || at >= start) continue;

    const sendId = `sa-shift-reminder-${assignment.id}`;
    if (alreadySentIn(store, sendId)) continue;

    out.push({
      employee,
      assignment,
      activity,
      leadHours,
      sendId,
      text: shiftReminderText({ activity, assignment, leadHours }),
      variables: templateVars({ employee, activity, assignment }),
    });
  }
  return out;
}

/** Called by the scheduler; safe to call as often as it likes. */
export async function runShiftRemindersIfDue({ now = new Date() } = {}) {
  let due = [];
  try {
    due = dueShiftReminders({ now, store: db });
  } catch (err) {
    console.error('shift reminders scan failed:', err.message);
    return null;
  }
  if (!due.length) return { due: 0, sent: 0 };

  let sent = 0;
  for (const item of due) {
    const result = await sendStaffAlert({
      employee: item.employee,
      kind: 'shift_reminder',
      text: item.text,
      variables: item.variables,
      sendId: item.sendId,
      date: item.assignment.date,
    });
    if (result.sent) sent += 1;
  }
  if (sent) console.log(`⏰ תזכורות שיבוץ: ${sent}/${due.length}`);
  return { due: due.length, sent };
}

/**
 * Somebody was just placed on an event. Told at once, because a shift added
 * three days ahead is a plan the employee has to be able to argue with.
 */
export async function notifyShiftAssigned(rows = [], { store = db } = {}) {
  const created = (rows || []).filter(Boolean);
  if (!created.length) return { sent: 0 };
  const subscribers = alertSubscribers(store, 'shift_assigned', {
    employeeIds: created.map((r) => r.employee_id),
  });
  if (!subscribers.length) return { sent: 0 };
  const byEmployee = new Map(subscribers.map((e) => [String(e.id), e]));

  let sent = 0;
  for (const assignment of created) {
    const employee = byEmployee.get(String(assignment.employee_id || ''));
    if (!employee) continue;
    const activity = activityFor(store, assignment);
    const result = await sendStaffAlert({
      employee,
      kind: 'shift_assigned',
      text: shiftAssignedText({ activity, assignment }),
      variables: templateVars({ employee, activity, assignment }),
      sendId: `sa-shift-assigned-${assignment.id}`,
      date: assignment.date,
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}
