/**
 * Sending one internal alert to one employee.
 *
 * Two things every staff alert needs and nobody should re-write per alert:
 *
 * 1. **A template when one was chosen.** WhatsApp only lets us open a
 *    conversation with an approved template, and an employee who has not
 *    written to the business number in 24 hours is exactly that case. The plain
 *    text stays as the fallback, so an alert with no template still works the
 *    way it does today.
 * 2. **Sending once.** Reminders are computed by a clock that ticks every few
 *    minutes; without a record of what already went out, "one hour before" would
 *    mean a message every tick until the event starts. The record lives in
 *    `automation_sends`, the same journal the other scheduled sends use.
 *
 * ## "Sent" is not the same as "arrived"
 *
 * Meta accepts a message and only then, a second or two later, tells us over the
 * webhook that it failed — a closed 24-hour window is exactly that case. The
 * journal entry is written on acceptance, so without this the alert counted as
 * delivered and was never tried again: an instructor simply never heard about
 * their shift. A failure receipt therefore reopens the entry, and the next scan
 * sends again, up to `MAX_SEND_ATTEMPTS` so a permanently blocked number cannot
 * turn a reminder into a message every ten minutes until the shift starts.
 */

import { db } from './db.js';
import { whatsappService } from './whatsapp.js';
import { alertSettings } from './staffAlerts.js';

/** How many times one alert may be sent before we stop trying. */
export const MAX_SEND_ATTEMPTS = 3;

function sendRecord(sendId) {
  if (!sendId) return null;
  return (db.get('automation_sends') || []).find((r) => r.id === sendId) || null;
}

/**
 * Has this exact alert already gone out?
 * A record whose delivery failed does not count — until the attempts run out.
 */
export function alertAlreadySent(sendId) {
  const row = sendRecord(sendId);
  if (!row) return false;
  if (!row.failed_at) return true;
  return Number(row.attempts || 1) >= MAX_SEND_ATTEMPTS;
}

function markAlertSent({ id, event, employeeId, date, phone, metaMessageId }) {
  if (!id) return;
  const existing = sendRecord(id);
  const patch = {
    event,
    employee_id: employeeId || null,
    date: date || null,
    phone: phone || '',
    meta_message_id: metaMessageId || null,
    sent_at: new Date().toISOString(),
    failed_at: null,
  };
  if (existing) {
    // A retry of an entry that failed before: same id, one more attempt spent.
    db.update('automation_sends', id, {
      ...patch,
      attempts: Number(existing.attempts || 1) + 1,
    });
    return;
  }
  db.insert('automation_sends', {
    id,
    automation_id: null,
    student_id: null,
    attempts: 1,
    ...patch,
  });
}

/**
 * Meta reported that an outbound message failed. If it was a staff alert, the
 * journal entry reopens so the next scan can try again.
 * Returns the reopened entry id, or null when the message was not one of ours.
 */
export function noteStaffAlertFailure(metaMessageId) {
  const id = String(metaMessageId || '');
  if (!id) return null;
  const row = (db.get('automation_sends') || []).find((r) => r.meta_message_id === id);
  if (!row || row.failed_at) return null;
  db.update('automation_sends', row.id, { failed_at: new Date().toISOString() });
  const attempts = Number(row.attempts || 1);
  console.warn(
    `⚠️ התראת צוות ${row.event} לא נמסרה (${row.phone}) — ניסיון ${attempts}/${MAX_SEND_ATTEMPTS}`
  );
  return row.id;
}

/**
 * The Meta name of the template this employee pointed the alert at, if any.
 *
 * A template that no longer exists reads as "no template chosen" — the built-in
 * text still goes out. That fallback is silent by design, which is how every
 * instructor ended up pointing at a deleted template without anyone noticing,
 * so the miss is written to the log with the employee's name on it.
 */
export function chosenTemplateName(employee, kind, store = db) {
  const id = alertSettings(employee, kind).template_id;
  if (!id) return null;
  const template = (store.get('message_templates') || []).find((t) => t.id === id);
  if (!template) {
    console.warn(
      `⚠️ ${employee?.name || employee?.id}: התראת ${kind} מצביעה על תבנית שאינה קיימת (${id})`
    );
    return null;
  }
  const sendable = String(template.status).toUpperCase() === 'APPROVED' || template.active_for_send;
  if (!sendable || template.archived) return null;
  return template.meta_name || template.name || null;
}

/**
 * Send one alert to one employee.
 *
 * @param {object} args
 * @param {object} args.employee the subscriber
 * @param {string} args.kind alert key
 * @param {string} args.text the built-in message, used when no template is set
 * @param {string[]} [args.variables] positional template variables
 * @param {string} [args.sendId] dedupe key; omit for alerts that may repeat
 * @param {string} [args.date] the day the alert is about, for the journal
 * @returns {Promise<{sent: boolean, reason?: string, via?: 'template'|'text'}>}
 */
export async function sendStaffAlert({
  employee,
  kind,
  text,
  variables = [],
  sendId = null,
  date = null,
} = {}) {
  const phone = String(employee?.phone || '').trim();
  if (!phone) return { sent: false, reason: 'no_phone' };
  if (sendId && alertAlreadySent(sendId)) return { sent: false, reason: 'already_sent' };

  const templateName = chosenTemplateName(employee, kind);
  try {
    const result = templateName
      ? await whatsappService.sendTemplateMessage(phone, templateName, variables, {
        fallbackName: employee?.name || '',
      })
      : await whatsappService.sendTextMessage(phone, text, false, {
        source: 'staff_notify',
        clip: false,
      });
    if (!result?.success) {
      // A template that Meta rejected must not silence the alert: the employee
      // still needs to know about their shift.
      if (templateName) {
        const fallback = await whatsappService.sendTextMessage(phone, text, false, {
          source: 'staff_notify',
          clip: false,
        });
        if (fallback?.success) {
          markAlertSent({
            id: sendId, event: kind, employeeId: employee?.id, date, phone,
            metaMessageId: fallback.messageId,
          });
          return { sent: true, via: 'text' };
        }
      }
      return { sent: false, reason: result?.error || 'send_failed' };
    }
    markAlertSent({
      id: sendId, event: kind, employeeId: employee?.id, date, phone,
      metaMessageId: result.messageId,
    });
    return { sent: true, via: templateName ? 'template' : 'text' };
  } catch (err) {
    console.error(`staff alert ${kind} failed:`, err.message);
    return { sent: false, reason: err.message };
  }
}
