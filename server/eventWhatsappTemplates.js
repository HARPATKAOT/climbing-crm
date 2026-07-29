/**
 * System WhatsApp templates for calendar event links.
 * Seeded as drafts; staff submit to Meta from Templates → דיוור.
 *
 * v4 moved the button off the site and onto the API redirect (`/eh`, `/ev`).
 * Meta freezes a button URL on approval, so a button pointing straight at the
 * site had to be re-approved on every domain move; now the API resolves the
 * destination per click and the site can move without touching Meta at all.
 */

import { apiRedirectBase, appPublicBase } from './publicLinks.js';

export const EVENT_HOST_PAYMENT_TEMPLATE = 'event_host_payment_v4';
export const EVENT_PARTICIPANT_LINK_TEMPLATE = 'event_participant_link_v4';

/** Older approved versions, newest first — used until v4 clears Meta review. */
export const EVENT_HOST_PAYMENT_FALLBACKS = ['event_host_payment_v3', 'event_host_payment_v2'];
export const EVENT_PARTICIPANT_LINK_FALLBACKS = [
  'event_participant_link_v3',
  'event_participant_link_v2',
];

/** Kept for callers that still reference the single previous version. */
export const EVENT_HOST_PAYMENT_TEMPLATE_FALLBACK = EVENT_HOST_PAYMENT_FALLBACKS[0];
export const EVENT_PARTICIPANT_LINK_TEMPLATE_FALLBACK = EVENT_PARTICIPANT_LINK_FALLBACKS[0];

/** Legacy Meta names (deleted; blocked from reuse for ~4 weeks). */
export const EVENT_WHATSAPP_TEMPLATE_LEGACY_META_NAMES = new Set([
  'event_host_payment',
  'event_participant_link',
]);

export const EVENT_WHATSAPP_TEMPLATE_META_NAMES = new Set([
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  ...EVENT_HOST_PAYMENT_FALLBACKS,
  ...EVENT_PARTICIPANT_LINK_FALLBACKS,
]);

export const EVENT_HOST_REDIRECT_PATH = 'eh';
export const EVENT_PARTICIPANT_REDIRECT_PATH = 'ev';

/** Where a click ends up. Exported because staff-facing screens preview it. */
export const publicBase = appPublicBase;

function findTemplate(db, { metaName, id }) {
  const templates = db.get('message_templates') || [];
  return (
    templates.find(
      (t) =>
        t.id === id ||
        (t.meta_name || t.name) === metaName
    ) || null
  );
}

function insertDraft(db, persist, row) {
  const template = db.insert('message_templates', {
    ...row,
    active_for_send: false,
    archived: false,
    created_at: new Date().toISOString(),
  });
  if (typeof persist === 'function') {
    Promise.resolve(persist('message_templates', template)).catch(() => {});
  }
  return template;
}

function hostPaymentDraftFields() {
  return {
    id: 'tpl-event-host-payment-v4',
    name: 'אירוע · קישור תשלום מזמין',
    meta_name: EVENT_HOST_PAYMENT_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    usage:
      'נשלחת למזמין של אירוע (יום הולדת, קבוצה, חברה) בלחיצה על «שלח קישור תשלום» ' +
      'במסך האירוע ביומן. הכפתור מוביל לדף תשלום פרטי של המזמין בלבד — לא להעביר הלאה.',
    body:
      'שלום {{1}},\n' +
      'קישור פרטי לתשלום עבור האירוע {{2}}.\n' +
      'לחצו על הכפתור להשלמת התשלום.',
    header: '',
    footer: '',
    body_examples: ['דנה כהן', 'יום הולדת בקיר'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם המזמין', example: 'דנה כהן' },
      { key: '2', field: 'custom', label: 'שם האירוע', example: 'יום הולדת בקיר' },
    ],
    buttons: [
      {
        type: 'URL',
        text: 'לתשלום האירוע',
        url: `${apiRedirectBase()}/${EVENT_HOST_REDIRECT_PATH}/{{1}}`,
        example: ['demo-host-token'],
      },
    ],
    sort_order: 5,
  };
}

function participantLinkDraftFields() {
  return {
    id: 'tpl-event-participant-link-v4',
    name: 'אירוע · קישור למשתתפים',
    meta_name: EVENT_PARTICIPANT_LINK_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    usage:
      'נשלחת למזמין האירוע כדי שיפיץ הלאה. הכפתור מוביל לדף הרשמה פתוח לאירוע, ' +
      'שכל משתתף ממלא בעצמו. מיועד להעברה בקבוצות.',
    body:
      'שלום {{1}},\n' +
      'קישור להרשמת משתתפים לאירוע {{2}}.\n' +
      'לחצו על הכפתור והעבירו לכל מי שמגיע.',
    header: '',
    footer: '',
    body_examples: ['דנה כהן', 'יום הולדת בקיר'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם המזמין', example: 'דנה כהן' },
      { key: '2', field: 'custom', label: 'שם האירוע', example: 'יום הולדת בקיר' },
    ],
    buttons: [
      {
        type: 'URL',
        text: 'להרשמת משתתפים',
        url: `${apiRedirectBase()}/${EVENT_PARTICIPANT_REDIRECT_PATH}/{{1}}`,
        example: ['demo-event-slug'],
      },
    ],
    sort_order: 6,
  };
}

/** Seed host-payment link template (idempotent). */
export function ensureEventHostPaymentTemplate({ db, persist } = {}) {
  if (!db) return null;
  const existing = findTemplate(db, {
    metaName: EVENT_HOST_PAYMENT_TEMPLATE,
    id: 'tpl-event-host-payment-v4',
  });
  if (existing) return existing;
  return insertDraft(db, persist, hostPaymentDraftFields());
}

/** Seed participant-registration link template (idempotent). */
export function ensureEventParticipantLinkTemplate({ db, persist } = {}) {
  if (!db) return null;
  const existing = findTemplate(db, {
    metaName: EVENT_PARTICIPANT_LINK_TEMPLATE,
    id: 'tpl-event-participant-link-v4',
  });
  if (existing) return existing;
  return insertDraft(db, persist, participantLinkDraftFields());
}

export function ensureEventWhatsappTemplates(opts = {}) {
  return {
    hostPayment: ensureEventHostPaymentTemplate(opts),
    participantLink: ensureEventParticipantLinkTemplate(opts),
  };
}

/**
 * Delete existing event system templates (Meta + local) and recreate the v4
 * drafts. Buttons always point at the API redirect, so no caller can seed a
 * template that a later domain move would invalidate.
 */
export async function recreateEventWhatsappTemplates({
  db,
  persist,
  deleteTemplate,
} = {}) {
  if (!db || typeof deleteTemplate !== 'function') {
    throw new Error('recreateEventWhatsappTemplates requires db and deleteTemplate');
  }
  const targets = [
    { metaName: EVENT_HOST_PAYMENT_TEMPLATE, id: 'tpl-event-host-payment-v4' },
    { metaName: EVENT_PARTICIPANT_LINK_TEMPLATE, id: 'tpl-event-participant-link-v4' },
    ...EVENT_HOST_PAYMENT_FALLBACKS.map((metaName) => ({
      metaName,
      id: `tpl-event-host-payment-${metaName.split('_').pop()}`,
    })),
    ...EVENT_PARTICIPANT_LINK_FALLBACKS.map((metaName) => ({
      metaName,
      id: `tpl-event-participant-link-${metaName.split('_').pop()}`,
    })),
    // Clean up failed recreate drafts / legacy rows with localhost buttons.
    { metaName: 'event_host_payment', id: 'tpl-event-host-payment' },
    { metaName: 'event_participant_link', id: 'tpl-event-participant-link' },
  ];

  const deleted = [];
  for (const target of targets) {
    const existing = findTemplate(db, target);
    if (!existing) continue;
    try {
      await deleteTemplate(existing.id);
      deleted.push({
        id: existing.id,
        meta_name: existing.meta_name || existing.name,
        old_button: existing.buttons?.[0]?.url || '',
      });
    } catch (err) {
      // Template may already be gone at Meta after a prior delete.
      deleted.push({
        id: existing.id,
        meta_name: existing.meta_name || existing.name,
        old_button: existing.buttons?.[0]?.url || '',
        delete_error: err.message,
      });
      try {
        db.delete('message_templates', existing.id);
      } catch {
        /* ignore */
      }
    }
  }

  const hostPayment = insertDraft(db, persist, hostPaymentDraftFields());
  const participantLink = insertDraft(db, persist, participantLinkDraftFields());
  if (typeof persist === 'function') {
    await Promise.resolve(persist('message_templates', hostPayment));
    await Promise.resolve(persist('message_templates', participantLink));
  }

  return {
    base: apiRedirectBase(),
    deleted,
    hostPayment,
    participantLink,
  };
}

export function isEventWhatsappTemplate(template) {
  if (!template) return false;
  const meta = String(template.meta_name || template.name || '');
  return (
    EVENT_WHATSAPP_TEMPLATE_META_NAMES.has(meta) ||
    EVENT_WHATSAPP_TEMPLATE_LEGACY_META_NAMES.has(meta) ||
    String(template.id || '').startsWith('tpl-event-')
  );
}

export function findApprovedEventTemplate(db, metaName) {
  const templates = db.get('message_templates') || [];
  const localTpl = templates.find((t) => (t.meta_name || t.name) === metaName);
  if (!localTpl || localTpl.archived) return null;
  const approved =
    String(localTpl.status).toUpperCase() === 'APPROVED' || localTpl.active_for_send;
  return approved ? localTpl : null;
}

/**
 * Newest approved version for a link kind, falling back through older ones so
 * a pending v4 review never blocks sending outside the 24h window.
 */
export function resolveEventTemplate(db, kind) {
  const chain =
    kind === 'host'
      ? [EVENT_HOST_PAYMENT_TEMPLATE, ...EVENT_HOST_PAYMENT_FALLBACKS]
      : [EVENT_PARTICIPANT_LINK_TEMPLATE, ...EVENT_PARTICIPANT_LINK_FALLBACKS];
  for (const metaName of chain) {
    const found = findApprovedEventTemplate(db, metaName);
    if (found) return found;
  }
  return null;
}
