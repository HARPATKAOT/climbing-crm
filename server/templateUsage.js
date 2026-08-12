/**
 * מי שולח כל תבנית.
 *
 * רשימת התבניות המאושרות לא מספרת מי משתמש בהן, ולכן כל ניקוי התחיל בחיפוש
 * ידני בקוד אחרי שם התבנית. המפה כאן היא אותו חיפוש, שמור פעם אחת: כל תבנית
 * והמסלול ששולח אותה — הבוט, אוטומציה, מסך אירועים, קופה וכן הלאה. תבנית בלי
 * רשומה כאן היא תבנית שאיש לא שולח.
 *
 * המפה מכוונת בכוונה על שמות ולא על import מהמודולים עצמם: מסך התבניות היה
 * גורר איתו את שירות הציוד, את הבוט ואת מנוע האירועים רק כדי לצייר תגית.
 * `templateUsage.test.js` משווה את השמות כאן מול הקבועים האמיתיים, כך ששינוי
 * שם באחד המודולים נופל בבדיקות ולא בשקט.
 */

/** סוג השולח → תווית ואייקון (שם האייקון נפתר בצד הלקוח). */
export const USAGE_KINDS = {
  bot: { label: 'הבוט', icon: 'bot' },
  automation: { label: 'אוטומציה', icon: 'zap' },
  otp: { label: 'קוד אימות', icon: 'key' },
  event: { label: 'מסך אירועים', icon: 'calendar' },
  equipment: { label: 'מסך ציוד', icon: 'package' },
  pos: { label: 'קופה', icon: 'receipt' },
  finance: { label: 'תשלומים', icon: 'card' },
  form: { label: 'טפסים', icon: 'clipboard' },
  agenda: { label: 'יומן אליי', icon: 'clock' },
  none: { label: 'אף אחד', icon: 'none' },
};

/** meta_name → סוג השולח. המקור לכל שורה בהערה שלידה. */
export const TEMPLATE_SENDERS = {
  bot_followup_v1: 'bot',                       // botCapabilities.js · scheduleFollowUp
  phone_verification_code: 'otp',               // whatsappBot.js · SYSTEM_TEMPLATE_NAMES
  event_host_payment_v4: 'event',               // eventWhatsappTemplates.js
  event_participant_link_v4: 'event',           // eventWhatsappTemplates.js
  event_host_payment_v3: 'event',               // fallback אם v4 תאבד אישור
  event_host_payment_v2: 'event',
  event_participant_link_v3: 'event',
  event_participant_link_v2: 'event',
  equipment_update_or_purchase_v2: 'equipment', // equipmentService.js · EQUIPMENT_TEMPLATE_NAME
  pos_invoice_v1: 'pos',                        // channels/templates.js · POS_INVOICE_TEMPLATE_NAME
  payment_link: 'finance',                      // icount.js · getPaymentTemplateName
  participation_form_link: 'form',              // participationFormWhatsappTemplate.js
  customer_details_v2: 'form',                  // onboardingWhatsappTemplate.js
  my_agenda_v1: 'agenda',                       // agendaDigestTemplate.js
};

/** השדות באוטומציה שמחזיקים שם תבנית. */
const AUTOMATION_TEMPLATE_FIELDS = [
  'templateName',
  'templateNameNext',
  'templateNameSelf',
  'templateNameWall',
];

/**
 * אילו תבניות רשומות באוטומציות החיות. זה החלק שלא ניתן להסיק מהקוד: אותה
 * אוטומציה יכולה להצביע היום על תבנית אחת ומחר על אחרת, והתשובה נמצאת בשורה
 * עצמה.
 * @returns {Map<string, string[]>} meta_name → שמות האוטומציות
 */
export function automationTemplateNames(automations = []) {
  const byTemplate = new Map();
  for (const automation of Array.isArray(automations) ? automations : []) {
    if (automation?.enabled === false) continue;
    const payload = automation?.action_payload || {};
    for (const field of AUTOMATION_TEMPLATE_FIELDS) {
      const name = String(payload[field] || '').trim();
      if (!name) continue;
      const list = byTemplate.get(name) || [];
      const label = String(automation?.name || '').trim();
      if (label && !list.includes(label)) list.push(label);
      byTemplate.set(name, list);
    }
  }
  return byTemplate;
}

function metaNameOf(template) {
  return String(template?.meta_name || template?.name || '').trim();
}

/**
 * מוסיף לכל תבנית את רשימת `used_by` — מי שולח אותה בפועל.
 * שליחה ידנית מכרטיס לקוח כבר מסומנת בשדה `manual_send` ולכן אינה חוזרת כאן.
 */
export function withUsage(templates, { automations = [] } = {}) {
  const fromAutomations = automationTemplateNames(automations);
  return (Array.isArray(templates) ? templates : []).map((template) => {
    const metaName = metaNameOf(template);
    const used = [];
    const kind = TEMPLATE_SENDERS[metaName];
    if (kind) used.push({ kind, label: USAGE_KINDS[kind].label });
    const automationNames = fromAutomations.get(metaName);
    if (automationNames) {
      used.push({
        kind: 'automation',
        // שם האוטומציה עונה על השאלה הבאה מיד אחרי „מי שולח?”
        label: automationNames.length === 1
          ? automationNames[0]
          : `${USAGE_KINDS.automation.label} (${automationNames.length})`,
      });
    }
    return { ...template, used_by: used };
  });
}
