/**
 * System WhatsApp templates for calendar event links.
 * Seeded as drafts; staff submit to Meta from Templates → דיוור.
 */

export const EVENT_HOST_PAYMENT_TEMPLATE = 'event_host_payment_v3';
export const EVENT_PARTICIPANT_LINK_TEMPLATE = 'event_participant_link_v3';
export const EVENT_HOST_PAYMENT_TEMPLATE_FALLBACK = 'event_host_payment_v2';
export const EVENT_PARTICIPANT_LINK_TEMPLATE_FALLBACK = 'event_participant_link_v2';

/** Legacy Meta names (deleted; blocked from reuse for ~4 weeks). */
export const EVENT_WHATSAPP_TEMPLATE_LEGACY_META_NAMES = new Set([
  'event_host_payment',
  'event_participant_link',
]);

export const EVENT_WHATSAPP_TEMPLATE_META_NAMES = new Set([
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  EVENT_HOST_PAYMENT_TEMPLATE_FALLBACK,
  EVENT_PARTICIPANT_LINK_TEMPLATE_FALLBACK,
]);

const LIVE_APP_BASE = 'https://client-omega-topaz-35.vercel.app';

function isUnsafeAppBase(value = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return true;
  if (raw.includes('localhost') || raw.includes('127.0.0.1')) return true;
  if (raw.startsWith('http://')) return true;
  return false;
}

export function publicBase(publicAppBase = '') {
  const candidates = [
    publicAppBase,
    process.env.FRONTEND_URL,
    process.env.PUBLIC_APP_URL,
    LIVE_APP_BASE,
  ];
  for (const candidate of candidates) {
    const base = String(candidate || '').trim().replace(/\/$/, '');
    if (!base || isUnsafeAppBase(base)) continue;
    return base;
  }
  return LIVE_APP_BASE;
}

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

function hostPaymentDraftFields(publicAppBase = '') {
  const buttonUrl = `${publicBase(publicAppBase)}/event-host/{{1}}`;
  return {
    id: 'tpl-event-host-payment-v3',
    name: 'אירוע · קישור תשלום מזמין',
    meta_name: EVENT_HOST_PAYMENT_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
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
        url: buttonUrl,
        example: ['demo-host-token'],
      },
    ],
    sort_order: 5,
  };
}

function participantLinkDraftFields(publicAppBase = '') {
  const buttonUrl = `${publicBase(publicAppBase)}/event/{{1}}`;
  return {
    id: 'tpl-event-participant-link-v3',
    name: 'אירוע · קישור למשתתפים',
    meta_name: EVENT_PARTICIPANT_LINK_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
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
        url: buttonUrl,
        example: ['demo-event-slug'],
      },
    ],
    sort_order: 6,
  };
}

/** Seed host-payment link template (idempotent). */
export function ensureEventHostPaymentTemplate({ db, persist, publicAppBase = '' } = {}) {
  if (!db) return null;
  const existing = findTemplate(db, {
    metaName: EVENT_HOST_PAYMENT_TEMPLATE,
    id: 'tpl-event-host-payment-v3',
  });
  if (existing) return existing;
  return insertDraft(db, persist, hostPaymentDraftFields(publicAppBase));
}

/** Seed participant-registration link template (idempotent). */
export function ensureEventParticipantLinkTemplate({ db, persist, publicAppBase = '' } = {}) {
  if (!db) return null;
  const existing = findTemplate(db, {
    metaName: EVENT_PARTICIPANT_LINK_TEMPLATE,
    id: 'tpl-event-participant-link-v3',
  });
  if (existing) return existing;
  return insertDraft(db, persist, participantLinkDraftFields(publicAppBase));
}

export function ensureEventWhatsappTemplates(opts = {}) {
  return {
    hostPayment: ensureEventHostPaymentTemplate(opts),
    participantLink: ensureEventParticipantLinkTemplate(opts),
  };
}

/**
 * Delete existing event system templates (Meta + local) and recreate drafts
 * with a public https app base — never localhost.
 */
export async function recreateEventWhatsappTemplates({
  db,
  persist,
  publicAppBase = '',
  deleteTemplate,
} = {}) {
  if (!db || typeof deleteTemplate !== 'function') {
    throw new Error('recreateEventWhatsappTemplates requires db and deleteTemplate');
  }
  const base = publicBase(publicAppBase);
  const targets = [
    { metaName: EVENT_HOST_PAYMENT_TEMPLATE, id: 'tpl-event-host-payment-v3' },
    { metaName: EVENT_PARTICIPANT_LINK_TEMPLATE, id: 'tpl-event-participant-link-v3' },
    { metaName: EVENT_HOST_PAYMENT_TEMPLATE_FALLBACK, id: 'tpl-event-host-payment-v2' },
    { metaName: EVENT_PARTICIPANT_LINK_TEMPLATE_FALLBACK, id: 'tpl-event-participant-link-v2' },
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

  const hostPayment = insertDraft(db, persist, hostPaymentDraftFields(base));
  const participantLink = insertDraft(db, persist, participantLinkDraftFields(base));
  if (typeof persist === 'function') {
    await Promise.resolve(persist('message_templates', hostPayment));
    await Promise.resolve(persist('message_templates', participantLink));
  }

  return {
    base,
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
