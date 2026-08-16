/**
 * Minimal transactional email helper.
 * Prefer Resend HTTP API when RESEND_API_KEY is set.
 * Falls back to a logged stub so registration flows never crash.
 */

import { getBusinessProfile } from './businessProfile.js';
import { securityLogRef } from './security.js';

async function brandLabel() {
  try {
    const profile = await getBusinessProfile();
    return profile.display_name || 'הרפתקאות';
  } catch {
    return 'הרפתקאות';
  }
}

function fromAddress(brandName) {
  if (process.env.EMAIL_FROM || process.env.RESEND_FROM) {
    return (process.env.EMAIL_FROM || process.env.RESEND_FROM).trim();
  }
  return `${brandName} <onboarding@resend.dev>`;
}

export function isEmailConfigured() {
  return !!(process.env.RESEND_API_KEY || '').trim();
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string,
 *           attachments?: Array<{filename: string, content: string, contentType?: string}>,
 *           fetchImpl?: typeof fetch }} opts
 * attachments.content — base64 נקי, בלי קידומת data:.
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, text, html, attachments, fetchImpl = fetch } = {}) {
  const recipient = String(to || '').trim();
  if (!recipient) {
    return { sent: false, error: 'missing recipient' };
  }

  const brandName = await brandLabel();
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.log(`📧 [email stub] recipient=${securityLogRef(recipient)}`);
    return { sent: false, stub: true };
  }

  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(brandName),
        to: [recipient],
        subject: subject || `הודעה מ-${brandName}`,
        text: text || '',
        html: html || undefined,
        attachments: attachments?.length
          ? attachments.map((file) => ({
            filename: file.filename || 'attachment.pdf',
            content: file.content,
            content_type: file.contentType || undefined,
          }))
          : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data?.message || data?.error || `HTTP ${res.status}`;
      console.warn('📧 [email] Resend failed:', err);
      return { sent: false, error: String(err) };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    console.warn('📧 [email] send failed:', err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendActivityRegistrationConfirmation({
  to,
  participantName,
  activityName,
  date,
  startTime,
  location,
  paymentUrl,
} = {}) {
  const brandName = await brandLabel();
  const when = [date, startTime].filter(Boolean).join(' · ');
  const lines = [
    `שלום ${participantName || ''},`.trim(),
    '',
    `ההרשמה ל"${activityName || 'הפעילות'}" התקבלה בהצלחה.`,
    when ? `מועד: ${when}` : null,
    location ? `מיקום: ${location}` : null,
    paymentUrl ? '' : null,
    paymentUrl ? `לתשלום: ${paymentUrl}` : null,
    '',
    'נתראה בקיר!',
    brandName,
  ].filter((line) => line !== null);

  const text = lines.join('\n');
  const subject = `אישור הרשמה — ${activityName || 'פעילות'}`;
  return sendEmail({ to, subject, text });
}

export async function sendHostRegistrationLink({
  to,
  hostName,
  activityName,
  date,
  registrationUrl,
} = {}) {
  const brandName = await brandLabel();
  const lines = [
    `שלום ${hostName || ''},`.trim(),
    '',
    `קישור לדף ההרשמה והתשלום עבור "${activityName || 'הפעילות'}":`,
    registrationUrl || '',
    date ? `תאריך: ${date}` : null,
    '',
    brandName,
  ].filter((line) => line !== null);

  return sendEmail({
    to,
    subject: `קישור הרשמה — ${activityName || 'פעילות'}`,
    text: lines.join('\n'),
  });
}
