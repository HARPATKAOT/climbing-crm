/**
 * The WhatsApp message that carries the one-time code for the public form.
 *
 * AUTHENTICATION category, because that is the only category Meta permits a
 * verification code in — and it comes with its own fixed, localized body
 * ("‎*{{1}}* הוא הקוד שלך") and a copy-code button, none of which we write.
 * The regular template pipeline (channels/templates.js) builds UTILITY bodies
 * and cannot express this shape, so this script talks to the Graph API
 * directly and then registers the template locally so
 * `sendTemplateMessage('phone_verification_code', [code], { buttonUrlParams: [code] })`
 * finds its language and renders a sensible log line.
 *
 * Run from the server folder:
 *   node scripts/createPhoneVerificationTemplate.js          show what would happen
 *   node scripts/createPhoneVerificationTemplate.js --apply  create at Meta and register
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';

const APPLY = process.argv.includes('--apply');
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v25.0';

export const OTP_TEMPLATE_NAME = 'phone_verification_code';

const META_PAYLOAD = {
  name: OTP_TEMPLATE_NAME,
  language: 'he',
  category: 'AUTHENTICATION',
  components: [
    // Meta writes the body of an authentication template itself; the flag only
    // decides whether "אל תשתפו קוד זה" is appended. Yes: the code guards a
    // signature, and the sentence costs nothing.
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 5 },
    // No `text` on the button: Meta supplies the copy-code caption itself and
    // rejects a custom one for OTP buttons.
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
  ],
};

async function main() {
  await initDb();
  const settings = db.getSettings() || {};
  const wabaId = process.env.META_WA_WABA_ID || settings.metaWaWabaId || '';
  const accessToken = process.env.META_WA_ACCESS_TOKEN || settings.metaWaAccessToken || '';
  if (!wabaId || !accessToken) throw new Error('אין חיבור למטא — חסר WABA ID או Access Token');

  console.log(`תבנית: ${OTP_TEMPLATE_NAME} (he, AUTHENTICATION)`);
  if (!APPLY) {
    console.log(JSON.stringify(META_PAYLOAD, null, 1));
    console.log('\n(ללא --apply) לא נשלח דבר למטא.');
    return;
  }

  const res = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(META_PAYLOAD),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const already = data?.error?.error_user_title === 'Message Template Name Already Exists'
      || String(data?.error?.message || '').includes('already exists');
    if (!already) throw new Error(`מטא דחה את הבקשה: ${JSON.stringify(data.error || data)}`);
    console.log('התבנית כבר קיימת במטא — ממשיך לרישום המקומי.');
  } else {
    console.log(`נוצרה במטא: id=${data.id} status=${data.status || 'PENDING'}`);
  }

  // Local registration: sendTemplateMessage reads language and body from here.
  const templates = db.get('message_templates') || [];
  const existing = templates.find((t) => (t.meta_name || t.name) === OTP_TEMPLATE_NAME);
  const record = {
    name: 'קוד אימות טלפון · טופס ציבורי',
    meta_name: OTP_TEMPLATE_NAME,
    language: 'he',
    category: 'AUTHENTICATION',
    tag: 'קליטה',
    usage: 'קוד חד־פעמי לאימות הטלפון בטופס ההצטרפות. נשלח אוטומטית, לא מיועד לשליחה ידנית.',
    body: '{{1}} הוא הקוד שלך לאימות הטופס',
    variables: [{ key: '1', field: 'custom', label: 'קוד אימות', example: '123456' }],
    body_examples: ['123456'],
    buttons: [],
    status: String(data?.status || 'PENDING').toUpperCase(),
  };
  const saved = existing
    ? db.update('message_templates', existing.id, record)
    : db.insert('message_templates', record);
  const durable = await persistCore('message_templates', saved);
  if (durable?.ok === false) throw new Error(`הרישום המקומי לא נשמר: ${durable.error}`);
  console.log(`נרשם מקומית (${existing ? 'עודכן' : 'חדש'}), סטטוס: ${record.status}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
