/** שדות משתנים נפוצים לתבניות וואטסאפ — לוגיקת מילוי בשרת */

export const TEMPLATE_VAR_FIELDS = [
  { id: 'parent_name', label: 'שם הורה מלא', example: 'דלק כהן' },
  { id: 'parent_first', label: 'שם פרטי (הורה)', example: 'דלק' },
  { id: 'parent_last', label: 'שם משפחה (הורה)', example: 'כהן' },
  { id: 'child_name', label: 'שם הילד', example: 'מוטי כהן' },
  { id: 'child_first', label: 'שם פרטי (ילד)', example: 'מוטי' },
  { id: 'child_last', label: 'שם משפחה (ילד)', example: 'כהן' },
  { id: 'phone', label: 'טלפון', example: '0501234567' },
  { id: 'custom', label: 'טקסט חופשי', example: 'דוגמה' },
];

const FIELD_MAP = Object.fromEntries(TEMPLATE_VAR_FIELDS.map((f) => [f.id, f]));

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.slice(1).join(' ') || '',
  };
}

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
      return parentName || studentName || 'לקוח';
  }
}

/**
 * בונה מערך ערכים לפי סדר המשתנים בתבנית.
 * תומך במשתנים כמחרוזת או כאובייקט עם field/label/example.
 */
export function resolveTemplateVariableValues(template, parent = null, student = null, overrides = []) {
  const vars = Array.isArray(template?.variables) ? template.variables : [];
  if (!vars.length) {
    const bodyMatches = [...String(template?.body || '').matchAll(/\{\{([^{}]+)\}\}/g)];
    const keys = [];
    const seen = new Set();
    for (const m of bodyMatches) {
      const key = m[1].trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    return keys.map((_, idx) => {
      if (overrides[idx] != null && String(overrides[idx]).length) return String(overrides[idx]);
      return resolveTemplateFieldValue('parent_name', parent, student) || 'לקוח';
    });
  }

  return vars.map((v, idx) => {
    if (overrides[idx] != null && String(overrides[idx]).length) return String(overrides[idx]);
    if (v && typeof v === 'object') {
      const field = FIELD_MAP[v.field] ? v.field : 'custom';
      if (field === 'custom') {
        return resolveTemplateFieldValue('parent_name', parent, student) || 'לקוח';
      }
      return resolveTemplateFieldValue(field, parent, student) || 'לקוח';
    }
    return resolveTemplateFieldValue('parent_name', parent, student) || 'לקוח';
  });
}

/** ממזג מיפוי שדות מהלקוח עם רשימת מפתחות מגוף ההודעה */
export function enrichVariablesFromFields(bodyVarKeys = [], variableFields = []) {
  return bodyVarKeys.map((key, idx) => {
    const incoming = Array.isArray(variableFields) ? variableFields[idx] : null;
    if (incoming && typeof incoming === 'object') {
      const field = FIELD_MAP[incoming.field] ? incoming.field : 'custom';
      const meta = FIELD_MAP[field];
      return {
        key: String(key),
        field,
        label: incoming.label || meta?.label || `משתנה {{${key}}}`,
        example: incoming.example || meta?.example || 'דוגמה',
      };
    }
    if (typeof incoming === 'string' && FIELD_MAP[incoming]) {
      const meta = FIELD_MAP[incoming];
      return {
        key: String(key),
        field: incoming,
        label: meta.label,
        example: meta.example,
      };
    }
    return String(key);
  });
}

export function examplesFromVariables(variables = []) {
  return variables.map((v, i) => {
    if (v && typeof v === 'object' && v.example) return String(v.example);
    const meta = v && typeof v === 'object' && FIELD_MAP[v.field];
    if (meta) return meta.example;
    return i === 0 ? 'דלק' : i === 1 ? 'מוטי' : 'דוגמה';
  });
}
