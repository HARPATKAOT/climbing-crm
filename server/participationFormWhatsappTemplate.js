/**
 * System WhatsApp template for the participation form link.
 *
 * Meta freezes a button URL on approval, so the button points at the API
 * redirect (`/f/{{1}}`) and the real form (wall / event / trip) is resolved
 * per click — same contract as equipment and event templates.
 */

import { apiRedirectBase, buildRedirectUrl } from './publicLinks.js';
import { FORM_SHORT, FORM_FULL } from './participationForm.js';

export const PARTICIPATION_FORM_TEMPLATE = 'participation_form_link';
export const PARTICIPATION_FORM_TEMPLATE_ID = 'tpl-participation-form-link';
export const PARTICIPATION_FORM_REDIRECT_PATH = 'f';

/** Older / broken names that must never be preferred for this send. */
export const PARTICIPATION_FORM_LEGACY_META_NAMES = new Set(['t2']);

export function participationFormButtonParam(studentId, template = null) {
  const id = String(studentId || '').trim();
  if (!id) return '';
  const slug = String(template?.slug || '').trim().toLowerCase();
  const isDefault = !!template?.isDefault || !slug || slug === 'wall';
  if (isDefault) return id;
  return `${id}/${slug}`;
}

/** Short API link staff can copy; resolves to the right /register path on click. */
export function buildParticipationFormRedirectUrl(studentId, template = null) {
  const param = participationFormButtonParam(studentId, template);
  if (!param) return '';
  const parts = param.split('/').filter(Boolean);
  return buildRedirectUrl(PARTICIPATION_FORM_REDIRECT_PATH, ...parts);
}

export function participationFormDraftFields() {
  return {
    id: PARTICIPATION_FORM_TEMPLATE_ID,
    name: `${FORM_SHORT} · קישור למילוי`,
    meta_name: PARTICIPATION_FORM_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    tag: FORM_SHORT,
    usage:
      `נשלחת מתיק הלקוח בלחיצה על «שלח בוואטסאפ» בתיקיית ${FORM_SHORT}. ` +
      'הכפתור מוביל לטופס של אותו מתאמן (קיר / פעילות / טיול לפי מה שנבחר במסך). ' +
      'מחליפה את התבנית הישנה t2, שהצביעה על כתובת קבועה בלי מזהה מתאמן.',
    body:
      'שלום {{1}},\n' +
      `מצורף קישור למילוי ${FORM_FULL} עבור {{2}}.\n` +
      'לחצו על הכפתור למילוי.',
    header: '',
    footer: '',
    body_examples: ['דלק איל', 'ראם איל'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם ההורה', example: 'דלק איל' },
      { key: '2', field: 'child_name', label: 'שם המתאמן', example: 'ראם איל' },
    ],
    buttons: [
      {
        type: 'URL',
        text: 'למילוי הטופס',
        url: `${apiRedirectBase()}/${PARTICIPATION_FORM_REDIRECT_PATH}/{{1}}`,
        example: ['st-demo'],
      },
    ],
    sort_order: 3,
  };
}

/** Seed the draft (idempotent). Staff submit it to Meta from the templates screen. */
export function ensureParticipationFormWhatsappTemplate({ db, persist } = {}) {
  if (!db) return null;
  const templates = db.get('message_templates') || [];
  const existing = templates.find(
    (item) =>
      item.id === PARTICIPATION_FORM_TEMPLATE_ID ||
      (item.meta_name || item.name) === PARTICIPATION_FORM_TEMPLATE
  );
  if (existing) return existing;

  const template = db.insert('message_templates', {
    ...participationFormDraftFields(),
    active_for_send: false,
    archived: false,
    created_at: new Date().toISOString(),
  });
  if (typeof persist === 'function') {
    Promise.resolve(persist('message_templates', template)).catch(() => {});
  }
  return template;
}

export function findApprovedParticipationFormTemplate(db) {
  const templates = db.get('message_templates') || [];
  const localTpl = templates.find(
    (t) => (t.meta_name || t.name) === PARTICIPATION_FORM_TEMPLATE && !t.archived
  );
  if (!localTpl) return null;
  const approved =
    String(localTpl.status).toUpperCase() === 'APPROVED' || localTpl.active_for_send;
  return approved ? localTpl : null;
}
