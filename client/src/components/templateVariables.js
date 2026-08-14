/** שדות משתנים נפוצים לתבניות וואטסאפ */

export const TEMPLATE_VAR_FIELDS = [
  { id: 'parent_name', label: 'שם הורה מלא', example: 'דלק כהן' },
  { id: 'parent_first', label: 'שם פרטי (הורה)', example: 'דלק' },
  { id: 'parent_last', label: 'שם משפחה (הורה)', example: 'כהן' },
  { id: 'child_name', label: 'שם הילד', example: 'מוטי כהן' },
  { id: 'child_first', label: 'שם פרטי (ילד)', example: 'מוטי' },
  { id: 'child_last', label: 'שם משפחה (ילד)', example: 'כהן' },
  { id: 'phone', label: 'טלפון', example: '0501234567' },
  { id: 'mailing_preferences', label: 'קישור להעדפות דיוור', example: 'https://app.kirboaz.co.il/mailing-preferences/...' },
  { id: 'custom', label: 'טקסט חופשי', example: 'דוגמה' },
];

export const TEMPLATE_VAR_FIELD_MAP = Object.fromEntries(
  TEMPLATE_VAR_FIELDS.map((f) => [f.id, f])
);

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.slice(1).join(' ') || '',
  };
}

/** מחלץ ערך שדה מכרטיס הורה/מתאמן */
export function resolveTemplateFieldValue(fieldId, parent = null, student = null) {
  const parentName = parent?.name || '';
  const studentName = student?.name || '';
  const parentParts = splitName(parentName);
  const studentParts = splitName(studentName);

  switch (fieldId) {
    case 'parent_name':
      return parentName;
    case 'parent_first':
      return parentParts.first;
    case 'parent_last':
      return parentParts.last || parentParts.first;
    case 'child_name':
      return studentName || parentName;
    case 'child_first':
      return studentParts.first || parentParts.first;
    case 'child_last':
      return studentParts.last || studentParts.first || parentParts.last || parentParts.first;
    case 'phone':
      return parent?.phone || '';
    default:
      return parentName || studentName || '';
  }
}

/** מנרמל רשימת משתנים מתבנית (מחרוזת או אובייקט) */
export function normalizeTemplateVariables(rawVariables = [], body = '') {
  const fromBody = [...String(body || '').matchAll(/\{\{([^{}]+)\}\}/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);
  const uniqueKeys = [];
  const seen = new Set();
  for (const key of fromBody) {
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueKeys.push(key);
  }

  // אם יש גוף הודעה — סדר המשתנים נקבע ממנו בלבד
  const hasBody = String(body || '').length > 0;
  const keys = uniqueKeys.length
    ? uniqueKeys
    : (hasBody
      ? []
      : (Array.isArray(rawVariables) ? rawVariables.map((v, i) => (
        typeof v === 'object' && v ? String(v.key || i + 1) : String(v || i + 1)
      )) : []));

  return keys.map((key, idx) => {
    const raw = Array.isArray(rawVariables) ? rawVariables[idx] : null;
    if (raw && typeof raw === 'object') {
      const field = TEMPLATE_VAR_FIELD_MAP[raw.field] ? raw.field : 'custom';
      const meta = TEMPLATE_VAR_FIELD_MAP[field];
      return {
        key: String(raw.key || key),
        field,
        label: raw.label || meta?.label || `משתנה {{${key}}}`,
        example: raw.example || meta?.example || 'דוגמה',
      };
    }
    if (typeof raw === 'string' && TEMPLATE_VAR_FIELD_MAP[raw]) {
      const meta = TEMPLATE_VAR_FIELD_MAP[raw];
      return {
        key: String(key),
        field: raw,
        label: meta.label,
        example: meta.example,
      };
    }
    return {
      key: String(key),
      field: 'custom',
      label: `משתנה {{${key}}}`,
      example: 'דוגמה',
    };
  });
}

export function buildPrefillValues(variables, parent, student) {
  return variables.map((v) => {
    if (v.field && v.field !== 'custom') {
      return resolveTemplateFieldValue(v.field, parent, student);
    }
    return resolveTemplateFieldValue('parent_name', parent, student);
  });
}
