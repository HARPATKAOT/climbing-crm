/**
 * Minimal transactional email helper.
 * Prefer Resend HTTP API when RESEND_API_KEY is set.
 * Falls back to a logged stub so registration flows never crash.
 */

function fromAddress() {
  return (
    process.env.EMAIL_FROM ||
    process.env.RESEND_FROM ||
    'My Wall <onboarding@resend.dev>'
  ).trim();
}

export function isEmailConfigured() {
  return !!(process.env.RESEND_API_KEY || '').trim();
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 * @returns {Promise<{ sent: boolean, stub?: boolean, id?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, text, html } = {}) {
  const recipient = String(to || '').trim();
  if (!recipient) {
    return { sent: false, error: 'missing recipient' };
  }

  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    console.log(
      `📧 [email stub] to=${recipient} subject="${subject}"\n${text || ''}`
    );
    return { sent: false, stub: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [recipient],
        subject: subject || 'הודעה מ-My Wall',
        text: text || '',
        html: html || undefined,
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
    'My Wall',
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
  const lines = [
    `שלום ${hostName || ''},`.trim(),
    '',
    `קישור לדף ההרשמה והתשלום עבור "${activityName || 'הפעילות'}":`,
    registrationUrl || '',
    date ? `תאריך: ${date}` : null,
    '',
    'My Wall',
  ].filter((line) => line !== null);

  return sendEmail({
    to,
    subject: `קישור הרשמה — ${activityName || 'פעילות'}`,
    text: lines.join('\n'),
  });
}
