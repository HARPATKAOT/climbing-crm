/**
 * System WhatsApp templates for calendar event links.
 * Seeded as drafts; staff submit to Meta from Templates → דיוור.
 */

export const EVENT_HOST_PAYMENT_TEMPLATE = 'event_host_payment';
export const EVENT_PARTICIPANT_LINK_TEMPLATE = 'event_participant_link';

export const EVENT_WHATSAPP_TEMPLATE_META_NAMES = new Set([
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
]);

function publicBase(publicAppBase = '') {
  return String(
    publicAppBase ||
      process.env.FRONTEND_URL ||
      process.env.PUBLIC_APP_URL ||
      'https://client-omega-topaz-35.vercel.app'
  ).replace(/\/$/, '');
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

/** Seed host-payment link template (idempotent). */
export function ensureEventHostPaymentTemplate({ db, persist, publicAppBase = '' } = {}) {
  if (!db) return null;
  const existing = findTemplate(db, {
    metaName: EVENT_HOST_PAYMENT_TEMPLATE,
    id: 'tpl-event-host-payment',
  });
  if (existing) return existing;

  const buttonUrl = `${publicBase(publicAppBase)}/event-host/{{1}}`;
  return insertDraft(db, persist, {
    id: 'tpl-event-host-payment',
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
    footer: 'אירוע · My Wall',
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
  });
}

/** Seed participant-registration link template (idempotent). */
export function ensureEventParticipantLinkTemplate({ db, persist, publicAppBase = '' } = {}) {
  if (!db) return null;
  const existing = findTemplate(db, {
    metaName: EVENT_PARTICIPANT_LINK_TEMPLATE,
    id: 'tpl-event-participant-link',
  });
  if (existing) return existing;

  const buttonUrl = `${publicBase(publicAppBase)}/event/{{1}}`;
  return insertDraft(db, persist, {
    id: 'tpl-event-participant-link',
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
    footer: 'אירוע · My Wall',
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
  });
}

export function ensureEventWhatsappTemplates(opts = {}) {
  return {
    hostPayment: ensureEventHostPaymentTemplate(opts),
    participantLink: ensureEventParticipantLinkTemplate(opts),
  };
}

export function isEventWhatsappTemplate(template) {
  if (!template) return false;
  const meta = String(template.meta_name || template.name || '');
  return (
    EVENT_WHATSAPP_TEMPLATE_META_NAMES.has(meta) ||
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
