/**
 * Templates that make sense when a staff member is writing a single customer.
 *
 * Most approved Meta templates belong to a workflow: an event, checkout,
 * equipment payment, verification, automation or campaign. Those workflows
 * already know which values and button URL to send, so offering their template
 * in the generic conversation composer is both noisy and easy to misuse.
 *
 * Which templates are offered is now the owner's call, saved per template and
 * returned on the row as `manual_send`. The catalog below stays as the wording
 * for the two the system has always shipped with — a curated title reads better
 * than a Meta name — and as the fallback for any caller holding rows that
 * predate the flag.
 */
export const CONVERSATION_TEMPLATE_CATALOG = {
  customer_details_v2: {
    order: 1,
    title: 'טופס הצטרפות',
    badge: 'לקוח חדש',
    description: 'מילוי פרטים והצהרת בריאות בטופס המערכת.',
  },
  participation_form_link: {
    order: 2,
    title: 'טופס השתתפות לקיר',
    badge: 'מתאמן קיים',
    description: 'טופס השתתפות אישי למתאמן שנבחר. טופס טיול נשלח מתוך הפעילות.',
    requiresStudent: true,
  },
};

const CATEGORY_BADGES = {
  UTILITY: 'תפעולי',
  MARKETING: 'שיווקי',
  AUTHENTICATION: 'אימות',
};

function metaNameOf(template) {
  return String(template?.meta_name || template?.name || '').trim().toLowerCase();
}

/** Enough of the message to recognise it, without spilling the whole body. */
function firstLine(body) {
  const line = String(body || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  return line.length > 90 ? `${line.slice(0, 88)}…` : line;
}

/**
 * A template the owner switched on gets its own wording: the name they see in
 * the management screen, its category as the badge, and the opening line of the
 * message so the picker still says what will be sent.
 */
function presentationFor(template, metaName, index) {
  const curated = CONVERSATION_TEMPLATE_CATALOG[metaName];
  if (curated) return curated;
  return {
    order: 100 + index,
    title: template.name || metaName,
    badge: CATEGORY_BADGES[String(template.category || '').toUpperCase()] || 'תבנית',
    description: firstLine(template.body || template.text),
  };
}

/**
 * Returns only intentional, safe manual-send templates. Archived rows and
 * system/seasonal templates remain available in the Meta management screen.
 */
export function conversationTemplates(templates = [], { hasStudent = false } = {}) {
  const rows = Array.isArray(templates) ? templates : [];
  // Rows fetched before this setting existed carry no flag at all; falling back
  // to the catalog keeps such a screen working instead of emptying the picker.
  const flagged = rows.some((template) => typeof template?.manual_send === 'boolean');
  return rows
    .filter((template) => !template?.archived)
    .map((template, index) => {
      const metaName = metaNameOf(template);
      const enabled = flagged
        ? !!template.manual_send
        : !!CONVERSATION_TEMPLATE_CATALOG[metaName];
      if (!enabled) return null;
      return { ...template, metaName, presentation: presentationFor(template, metaName, index) };
    })
    .filter((template) => template && (!template.presentation.requiresStudent || hasStudent))
    .sort((a, b) => a.presentation.order - b.presentation.order);
}

export function isParticipationFormTemplate(template) {
  return metaNameOf(template) === 'participation_form_link';
}
