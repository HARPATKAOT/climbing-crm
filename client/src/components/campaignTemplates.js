/**
 * Turning a campaign message into a Meta template, and back.
 *
 * Meta fills template placeholders positionally: {{1}} gets the first value we
 * send, {{2}} the second. The campaign writes its message with named
 * placeholders, so the order of the names is the contract between the two — get
 * it wrong and the customer is greeted by their coupon code.
 */

/**
 * `field` maps a campaign variable onto the template-variable catalogue the
 * templates screen uses, so a template built here is filled correctly for every
 * other sender too. Coupon values differ per send, hence free text.
 */
export const MESSAGE_VARS = [
  { key: 'parentName', label: 'שם הלקוח', field: 'parent_name', example: 'דנה כהן' },
  { key: 'name', label: 'שם המתאמן', field: 'child_name', example: 'נועם כהן' },
  { key: 'couponLabel', label: 'תיאור ההטבה', field: 'custom', example: '50% הנחה על כניסה' },
  { key: 'coupon', label: 'קוד ההטבה', field: 'custom', example: 'AB12CD' },
  { key: 'expires', label: 'תאריך התפוגה', field: 'custom', example: '30.8.2026' },
  { key: 'business', label: 'שם העסק', field: 'custom', example: 'קיר בועז' },
];

export const MESSAGE_VAR_BY_KEY = Object.fromEntries(MESSAGE_VARS.map((v) => [v.key, v]));

export const TEMPLATE_STATUS_LABELS = {
  APPROVED: 'מאושרת',
  PENDING: 'ממתינה לאישור',
  DRAFT: 'טיוטה — עוד לא נשלחה לאישור',
  REJECTED: 'נדחתה',
};

/** Placeholder keys in the order Meta will fill them. */
export function templateSlots(body) {
  const seen = [];
  for (const match of String(body || '').matchAll(/\{\{([^{}]+)\}\}/g)) {
    const key = match[1].trim();
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * Named placeholders become numbered ones, and the campaign keys come back in
 * the same order so the values line up when the message is sent. A repeated
 * name reuses its number rather than claiming a second slot.
 */
export function templateDraftFromMessage(text) {
  const keys = [];
  const body = String(text || '').replace(/\{\{(\w+)\}\}/g, (whole, key) => {
    if (!MESSAGE_VAR_BY_KEY[key]) return whole;
    if (!keys.includes(key)) keys.push(key);
    return `{{${keys.indexOf(key) + 1}}}`;
  });
  return {
    body,
    keys,
    variableFields: keys.map((key) => ({
      field: MESSAGE_VAR_BY_KEY[key].field,
      label: MESSAGE_VAR_BY_KEY[key].label,
      example: MESSAGE_VAR_BY_KEY[key].example,
    })),
    examples: keys.map((key) => MESSAGE_VAR_BY_KEY[key].example),
  };
}

/** Meta rejects a body that opens or closes on a placeholder, or has two adjacent. */
export function templateBodyProblem(body) {
  const text = String(body || '').trim();
  if (!text) return 'ההודעה ריקה';
  if (/^\{\{/.test(text)) return 'מטא לא מאשרת הודעה שמתחילה במשתנה — הוסיפו מילה לפניו';
  if (/\}\}$/.test(text)) return 'מטא לא מאשרת הודעה שמסתיימת במשתנה — הוסיפו מילה אחריו';
  if (/\}\}\s*\{\{/.test(text)) return 'מטא לא מאשרת שני משתנים צמודים — הוסיפו טקסט ביניהם';
  return '';
}
