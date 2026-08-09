import { apiRedirectBase } from './publicLinks.js';
import { DEFAULT_BUSINESS_PROFILE } from './businessProfile.js';

export const GROUP_SIGNUP_TEMPLATE_NAME = 'group_signup_link_v1';

/** Draft for Meta approval. Until approved, the bot uses a clickable text URL inside 24h. */
export function ensureGroupSignupWhatsappTemplate({ db, persist } = {}) {
  if (!db) return null;
  const existing = (db.get('message_templates') || []).find(
    (template) => (template.meta_name || template.name) === GROUP_SIGNUP_TEMPLATE_NAME
      || template.id === 'tpl-group-signup-link-v1'
  );
  if (existing) return existing;
  const template = db.insert('message_templates', {
    id: 'tpl-group-signup-link-v1',
    name: GROUP_SIGNUP_TEMPLATE_NAME,
    meta_name: GROUP_SIGNUP_TEMPLATE_NAME,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    usage: 'קישור הרשמה לקבוצה מסוימת. שליחת הקישור אינה אישור הרשמה.',
    body: 'שלום {{1}},\nאפשר להמשיך את ההרשמה של {{2}} ל{{3}} דרך הכפתור.\nההרשמה סופית רק לאחר אימות המתנ״ס או הצוות.',
    footer: DEFAULT_BUSINESS_PROFILE.display_name,
    body_examples: ['דנה', 'נועם', 'קבוצת ד׳–ו׳'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם הורה', example: 'דנה' },
      { key: '2', field: 'child_name', label: 'שם מתאמן', example: 'נועם' },
      { key: '3', field: 'group_name', label: 'שם קבוצה', example: 'קבוצת ד׳–ו׳' },
    ],
    buttons: [{
      type: 'URL',
      text: 'להרשמה לקבוצה',
      url: `${apiRedirectBase()}/s/{{1}}`,
      example: ['g-demo/1'],
    }],
    active_for_send: false,
    created_at: new Date().toISOString(),
  });
  if (typeof persist === 'function') Promise.resolve(persist('message_templates', template)).catch(() => {});
  return template;
}
