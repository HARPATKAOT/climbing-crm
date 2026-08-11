import { supa } from './supa.js';

const SETTINGS_KEY = 'employee_onboarding_form';

/**
 * The full catalog of fields the public "new employee" form can ask for.
 * `locked` fields (name, phone) are always on and always required — without
 * them the submission has nobody to attach to an employee record.
 */
export const EMPLOYEE_ONBOARD_FIELD_DEFS = [
  { key: 'name', label: 'שם מלא', type: 'text', locked: true },
  { key: 'phone', label: 'טלפון', type: 'tel', locked: true },
  { key: 'email', label: 'אימייל', type: 'email' },
  { key: 'address', label: 'מקום מגורים', type: 'text' },
  { key: 'gender', label: 'מין', type: 'select', options: ['זכר', 'נקבה'] },
  { key: 'birthDate', label: 'תאריך לידה', type: 'date' },
  { key: 'idNumber', label: 'מספר תעודת זהות', type: 'text' },
  { key: 'paymentMethod', label: 'אופן קבלת תשלום', type: 'select', options: ['תלוש', 'חשבונית'] },
  { key: 'bankAccount', label: 'מספר חשבון בנק (בנק, סניף, חשבון)', type: 'text' },
  { key: 'pensionCompany', label: 'חברת פנסיה', type: 'text' },
  { key: 'notes', label: 'הערות נוספות', type: 'textarea' },
];

/**
 * המסמכים שהעובד החדש יכול לצרף בעצמו. `multiple` פותח כמה קבצים לאותו סוג —
 * למדריך יש בדרך כלל כמה תעודות. טופס 101 לא כאן: הוא נחתם באתר החיצוני
 * (FORM101_URL_KEY למטה) ולא מועלה כקובץ.
 */
export const EMPLOYEE_ONBOARD_DOC_DEFS = [
  { key: 'idPhoto', label: 'צילום תעודת זהות' },
  { key: 'police', label: 'אישור משטרה — היעדר עבירות מין' },
  { key: 'certificates', label: 'תעודות והסמכות', multiple: true },
  { key: 'contract', label: 'חוזה העסקה חתום' },
];

const FORM101_URL_KEY = 'employee_onboarding_form101_url';
const DEFAULT_FORM101_URL = 'https://forms.tofes101.co.il/c/6994466b9e749531fdbe1aa5/run/';

export async function getForm101Url() {
  const stored = await supa.getAppSetting(FORM101_URL_KEY);
  if (typeof stored === 'string') return stored.trim();
  return DEFAULT_FORM101_URL;
}

export async function saveForm101Url(raw) {
  const url = String(raw ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error('הקישור לטופס 101 חייב להתחיל ב-http או https');
  }
  const result = await supa.setAppSetting(FORM101_URL_KEY, url);
  if (!result?.ok) throw new Error(result?.error || 'שמירת הקישור נכשלה');
  return url;
}

const FIELD_DEF_BY_KEY = new Map(EMPLOYEE_ONBOARD_FIELD_DEFS.map((f) => [f.key, f]));

let memoryConfig = null;

/**
 * A saved config only ever carries {key, enabled, required} — the label/type
 * live in EMPLOYEE_ONBOARD_FIELD_DEFS above, so renaming a field's Hebrew
 * label never requires touching stored settings.
 */
function normalizeConfig(raw) {
  const saved = new Map(
    (Array.isArray(raw) ? raw : [])
      .filter((r) => r && FIELD_DEF_BY_KEY.has(r.key))
      .map((r) => [r.key, r])
  );
  return EMPLOYEE_ONBOARD_FIELD_DEFS.map((f) => {
    const row = saved.get(f.key);
    const enabled = f.locked ? true : (row ? row.enabled !== false : true);
    const required = f.locked ? true : !!(enabled && row?.required);
    return { key: f.key, enabled, required };
  });
}

export async function getEmployeeOnboardConfig({ fresh = false } = {}) {
  if (!fresh && memoryConfig) return memoryConfig;
  const stored = await supa.getAppSetting(SETTINGS_KEY);
  memoryConfig = normalizeConfig(stored);
  return memoryConfig;
}

export async function saveEmployeeOnboardConfig(input) {
  const config = normalizeConfig(input);
  const result = await supa.setAppSetting(SETTINGS_KEY, config);
  if (!result?.ok) throw new Error(result?.error || 'שמירת הגדרות הטופס נכשלה');
  memoryConfig = config;
  return config;
}

/** Full field defs (label/type/options) merged with enabled/required — for the admin editor. */
export function mergeFieldDefs(config) {
  const byKey = new Map((config || []).map((c) => [c.key, c]));
  return EMPLOYEE_ONBOARD_FIELD_DEFS.map((f) => ({
    ...f,
    enabled: byKey.get(f.key)?.enabled !== false,
    required: !!byKey.get(f.key)?.required,
  }));
}

/** Only the enabled fields, in form order — what the public form actually renders. */
export function publicFieldDefs(config) {
  return mergeFieldDefs(config).filter((f) => f.enabled);
}

/**
 * Turns submitted answers into an employee record, honoring which fields are
 * enabled/required right now — a field the admin turned off after the link
 * was shared must not be demanded, and one turned on must be.
 */
export function buildEmployeeFromSubmission(answers, config) {
  const fields = publicFieldDefs(config);
  const missing = [];
  const payload = {};
  for (const f of fields) {
    const raw = answers?.[f.key];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (f.required && !value) {
      missing.push(f.label);
      continue;
    }
    if (value === undefined || value === null || value === '') continue;
    payload[f.key] = value;
  }
  if (missing.length) {
    return { error: `חסרים שדות חובה: ${missing.join(', ')}` };
  }
  if (!payload.name) return { error: 'חסר שם מלא' };
  if (!payload.phone) return { error: 'חסר טלפון' };

  const employee = {
    name: payload.name,
    phone: payload.phone,
    email: payload.email || '',
    address: payload.address || '',
    gender: payload.gender || '',
    birthDate: payload.birthDate || '',
    idNumber: payload.idNumber || '',
    payment_method: payload.paymentMethod === 'חשבונית' ? 'invoice' : 'slip',
    bank_account_details: payload.bankAccount || '',
    pensionCompany: payload.pensionCompany || '',
    notes: payload.notes || '',
    // A self-submitted card is a candidate, not a live employee — staff
    // reviews and activates it from the Employees screen like any new hire.
    is_active: false,
    certifications: [],
    documents: {},
    source: 'onboarding_form',
  };
  return { employee };
}
