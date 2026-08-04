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
 */

import { db } from './db.js';
import { whatsappService } from './whatsapp.js';
import { alertSettings } from './staffAlerts.js';

/** Has this exact alert already gone out? */
export function alertAlreadySent(sendId) {
  if (!sendId) return false;
  return (db.get('automation_sends') || []).some((r) => r.id === sendId);
}

function markAlertSent({ id, event, employeeId, date, phone }) {
  if (!id || alertAlreadySent(id)) return;
  db.insert('automation_sends', {
    id,
    event,
    automation_id: null,
    student_id: null,
    employee_id: employeeId || null,
    date: date || null,
    phone: phone || '',
    sent_at: new Date().toISOString(),
  });
}

/** The Meta name of the template this employee pointed the alert at, if any. */
export function chosenTemplateName(employee, kind, store = db) {
  const id = alertSettings(employee, kind).template_id;
  if (!id) return null;
  const template = (store.get('message_templates') || []).find((t) => t.id === id);
  if (!template) return null;
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
          markAlertSent({ id: sendId, event: kind, employeeId: employee?.id, date, phone });
          return { sent: true, via: 'text' };
        }
      }
      return { sent: false, reason: result?.error || 'send_failed' };
    }
    markAlertSent({ id: sendId, event: kind, employeeId: employee?.id, date, phone });
    return { sent: true, via: templateName ? 'template' : 'text' };
  } catch (err) {
    console.error(`staff alert ${kind} failed:`, err.message);
    return { sent: false, reason: err.message };
  }
}
