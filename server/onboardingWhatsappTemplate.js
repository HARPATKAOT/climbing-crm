/**
 * System WhatsApp template for "fill in your details" — the message that sends
 * a customer to our own onboarding form.
 *
 * It replaces `coustumer_details`, whose approved button still points at the
 * old NoteForms address: anything filled there never reaches the CRM. Meta
 * freezes a button URL on approval, so this one points at the API redirect
 * (`/o`) and the real destination is resolved per click — the same contract as
 * the equipment and event templates.
 */

import { apiRedirectBase } from './publicLinks.js';

export const ONBOARDING_LINK_TEMPLATE = 'customer_details_v2';
export const ONBOARDING_REDIRECT_PATH = 'o';

/** The template it replaces — kept so screens can point staff at the new one. */
export const ONBOARDING_LINK_LEGACY_META_NAMES = new Set(['coustumer_details']);

export const ONBOARDING_TEMPLATE_ID = 'tpl-customer-details-v2';

export function onboardingLinkDraftFields() {
  return {
    id: ONBOARDING_TEMPLATE_ID,
    name: 'מילוי פרטים · טופס המערכת',
    meta_name: ONBOARDING_LINK_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    tag: 'מילוי פרטים',
    usage:
      'נשלחת ללקוח שצריך להשלים פרטים והצהרת בריאות. הכפתור מוביל לטופס ההצטרפות ' +
      'של המערכת, והנתונים נכנסים ישירות לתיק הלקוח. מחליפה את התבנית הישנה ' +
      'coustumer_details, שהכפתור שלה מוביל לטופס NoteForms חיצוני.',
    body:
      'שלום {{1}},\n' +
      'כדי להשלים את ההרשמה נשארו כמה פרטים — פרטי המשתתף והצהרת בריאות.\n' +
      'לחצו על הכפתור, זה לוקח דקה.',
    header: '',
    footer: '',
    body_examples: ['דנה כהן'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם הלקוח', example: 'דנה כהן' },
    ],
    buttons: [
      {
        type: 'URL',
        text: 'מילוי פרטים',
        // Static: the form asks for the phone itself, so no token is needed and
        // nothing about the customer is exposed in the address.
        url: `${apiRedirectBase()}/${ONBOARDING_REDIRECT_PATH}`,
      },
    ],
    sort_order: 4,
  };
}

/** Seed the draft (idempotent). Staff submit it to Meta from the templates screen. */
export function ensureOnboardingLinkTemplate({ db, persist } = {}) {
  if (!db) return null;
  const templates = db.get('message_templates') || [];
  const existing = templates.find(
    (item) => item.id === ONBOARDING_TEMPLATE_ID
      || (item.meta_name || item.name) === ONBOARDING_LINK_TEMPLATE
  );
  if (existing) return existing;

  const template = db.insert('message_templates', {
    ...onboardingLinkDraftFields(),
    active_for_send: false,
    archived: false,
    created_at: new Date().toISOString(),
  });
  if (typeof persist === 'function') {
    Promise.resolve(persist('message_templates', template)).catch(() => {});
  }
  return template;
}

