/**
 * System WhatsApp template for the owner's own agenda reminders.
 *
 * WhatsApp only allows free text within 24 hours of an inbound message, and the
 * evening digest goes out on quiet evenings — so it needs an approved template.
 * One template serves both the daily and the weekly digest: the whole list
 * arrives in {{1}}, flattened to a single line because Meta rejects newlines
 * inside a variable.
 */

export const AGENDA_DIGEST_TEMPLATE = 'my_agenda_v1';
export const AGENDA_DIGEST_TEMPLATE_ID = 'tpl-my-agenda-v1';

export function agendaDigestDraftFields() {
  return {
    id: AGENDA_DIGEST_TEMPLATE_ID,
    name: 'יומן · תזכורת אליי',
    meta_name: AGENDA_DIGEST_TEMPLATE,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    tag: 'יומן',
    usage:
      'התזכורות היומיות והשבועיות של היומן, שנשלחות אליך עצמך מעמוד האוטומציות. ' +
      'משמשת רק כשלא כתבת לבוט ב-24 השעות האחרונות — אחרת ההודעה נשלחת כטקסט רגיל. ' +
      'רשימת האירועים נכנסת למשתנה, מופרדת בסימני "|".',
    body:
      'תזכורת יומן 🗓️\n' +
      '{{1}}\n' +
      'שיהיה יום טוב!',
    header: '',
    footer: '',
    body_examples: ['יום ראשון 2.8 — 09:00 טיול לנקיק | 17:30 תור לרופא שיניים'],
    variables: [
      {
        key: '1',
        field: 'agenda',
        label: 'רשימת האירועים',
        example: 'יום ראשון 2.8 — 09:00 טיול לנקיק | 17:30 תור לרופא שיניים',
      },
    ],
    buttons: [],
    sort_order: 7,
  };
}

/** Seed the draft (idempotent). Staff submit it to Meta from the templates screen. */
export function ensureAgendaDigestTemplate({ db, persist } = {}) {
  if (!db) return null;
  const templates = db.get('message_templates') || [];
  const existing = templates.find(
    (item) => item.id === AGENDA_DIGEST_TEMPLATE_ID
      || (item.meta_name || item.name) === AGENDA_DIGEST_TEMPLATE
  );
  if (existing) return existing;

  const template = db.insert('message_templates', {
    ...agendaDigestDraftFields(),
    active_for_send: false,
    archived: false,
    created_at: new Date().toISOString(),
  });
  if (typeof persist === 'function') {
    Promise.resolve(persist('message_templates', template)).catch(() => {});
  }
  return template;
}
