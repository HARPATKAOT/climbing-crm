/**
 * Templates that make sense when a staff member is writing a single customer.
 *
 * Most approved Meta templates belong to a workflow: an event, checkout,
 * equipment payment, verification, automation or campaign. Those workflows
 * already know which values and button URL to send, so offering their template
 * in the generic conversation composer is both noisy and easy to misuse.
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

function metaNameOf(template) {
  return String(template?.meta_name || template?.name || '').trim().toLowerCase();
}

/**
 * Returns only intentional, safe manual-send templates. Archived rows and
 * system/seasonal templates remain available in the Meta management screen.
 */
export function conversationTemplates(templates = [], { hasStudent = false } = {}) {
  return (Array.isArray(templates) ? templates : [])
    .filter((template) => !template?.archived)
    .map((template) => {
      const metaName = metaNameOf(template);
      const presentation = CONVERSATION_TEMPLATE_CATALOG[metaName];
      return presentation ? { ...template, metaName, presentation } : null;
    })
    .filter((template) => template && (!template.presentation.requiresStudent || hasStudent))
    .sort((a, b) => a.presentation.order - b.presentation.order);
}

export function isParticipationFormTemplate(template) {
  return metaNameOf(template) === 'participation_form_link';
}
