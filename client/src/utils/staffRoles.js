/**
 * מה כל עובד רשאי לאייש.
 *
 * התפקידים נשמרים על העובד בשדה `certifications` — אותו שדה שכבר החזיק את
 * ההסמכות המקצועיות, כדי שלא תהיה רשימה שנייה להזין ידנית לכל עובד. הערך
 * השמור הוא התווית בעברית עצמה.
 *
 * לתפקידי המערכת יש מפתח יציב בשרת, והתווית שלהם ניתנת לשינוי. לכן הקבועים
 * כאן הם רק ברירת המחדל — מסך שמסנן לפי תפקיד צריך למשוך את הקטלוג
 * (`useRoleCatalog`) ולהשתמש בתווית העדכנית.
 */

export const SYSTEM_ROLE_KEYS = {
  TRAINER: 'trainer',
  ASSISTANT: 'assistant',
  WALL_OPERATOR: 'wall_operator',
  RAPPEL: 'rappel',
  PRIVATE: 'private',
  ROUTE_L1: 'route_l1',
  ROUTE_L2: 'route_l2',
};

/** ברירת המחדל של התוויות — חייבת להתאים ל-DEFAULT_SYSTEM_ROLES בשרת. */
export const DEFAULT_ROLE_LABELS = {
  [SYSTEM_ROLE_KEYS.TRAINER]: 'מדריך',
  [SYSTEM_ROLE_KEYS.ASSISTANT]: 'עוזר מדריך',
  [SYSTEM_ROLE_KEYS.WALL_OPERATOR]: 'מפעיל קיר',
  [SYSTEM_ROLE_KEYS.RAPPEL]: 'מדריך סנפלינג',
  [SYSTEM_ROLE_KEYS.PRIVATE]: 'מדריך שיעור פרטי',
  [SYSTEM_ROLE_KEYS.ROUTE_L1]: 'בונה מסלולים רמה 1',
  [SYSTEM_ROLE_KEYS.ROUTE_L2]: 'בונה מסלולים רמה 2',
};

/** תאימות לאחור לקוד שעוד קורא ROLE.TRAINER וכדומה. */
export const ROLE = {
  TRAINER: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.TRAINER],
  ASSISTANT: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.ASSISTANT],
  WALL_OPERATOR: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.WALL_OPERATOR],
  RAPPEL: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.RAPPEL],
  PRIVATE: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.PRIVATE],
  ROUTE_L1: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.ROUTE_L1],
  ROUTE_L2: DEFAULT_ROLE_LABELS[SYSTEM_ROLE_KEYS.ROUTE_L2],
};

/** התפקידים שהשיבוץ מסתמך עליהם — מוצגים ראשונים בכרטיס העובד. */
export const ASSIGNABLE_ROLES = Object.values(DEFAULT_ROLE_LABELS);

/** הסמכות שאינן משמשות לשיבוץ אבל נשמרות על העובד. */
export const OTHER_QUALIFICATIONS = [
  'מנהל פארק חבלים',
  'מדריך טיפוס ספורטיבי',
  'מאמן אתלטיקה',
  'מורה דרך',
];

export const STAFF_ROLE_OPTIONS = [...ASSIGNABLE_ROLES, ...OTHER_QUALIFICATIONS];

/** התפקידים של עובד, סלחני כלפי שורות ישנות בלי רשימה בכלל. */
export function rolesOf(employee) {
  const list = employee?.certifications;
  return Array.isArray(list)
    ? list.map((r) => String(r || '').trim()).filter(Boolean)
    : [];
}

/**
 * האם העובד רשאי לאייש את התפקיד. `required` יכול להיות מחרוזת אחת או מערך
 * שדי באחד מאיבריו. `null`/רשימה ריקה = אין דרישה.
 */
export function canFillRole(employee, required) {
  if (!required) return true;
  const needed = Array.isArray(required) ? required : [required];
  if (needed.length === 0) return true;
  const has = rolesOf(employee);
  return needed.some((r) => has.includes(r));
}

/**
 * העובדים שאפשר לשבץ לתפקיד. `keepIds` הם שיבוצים קיימים — הם נשארים ברשימה
 * גם אם התפקיד הוסר מהם בינתיים, כדי ששיבוץ ותיק לא ייעלם מהמסך בלי שנגעו בו.
 */
export function staffForRole(employees, required, keepIds = []) {
  const keep = new Set(keepIds.filter(Boolean));
  return (employees || []).filter((e) => keep.has(e.id) || canFillRole(e, required));
}

/** נוסח אחיד למצב שבו אף עובד לא סומן בתפקיד הנדרש. */
export function noStaffForRoleMessage(required) {
  const needed = Array.isArray(required) ? required : [required];
  return `אין עובד שסומן כ"${needed.join('" או "')}" — סמנו את התפקיד בכרטיס העובד.`;
}

// ─── קריאת הקטלוג מהשרת ──────────────────────────────────────────────────────

/**
 * קטלוג התפקידים נטען פעם אחת ומשותף לכל המסכים. בלי המטמון כל מסך היה מושך
 * אותו מחדש, והתוויות היו יכולות להיות שונות בין שני חלקים של אותו עמוד.
 */
let catalogCache = null;
let catalogPromise = null;

export function invalidateRoleCatalog() {
  catalogCache = null;
  catalogPromise = null;
}

export function fetchRoleCatalog() {
  if (catalogCache) return Promise.resolve(catalogCache);
  if (!catalogPromise) {
    catalogPromise = fetch('/api/staff-roles')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        catalogCache = body || null;
        return catalogCache;
      })
      .catch(() => null)
      .finally(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

/** התווית העדכנית של תפקיד מערכת, עם נפילה לברירת המחדל. */
export function roleLabelOf(catalog, key) {
  return catalog?.system?.find((r) => r.key === key)?.label || DEFAULT_ROLE_LABELS[key] || '';
}

/** התוויות של התפקידים שמתאימים לסוג פעילות, או null אם אין הגבלה. */
export function activityRoleLabels(catalog, activityType) {
  const labels = catalog?.activityRoleLabels?.[activityType];
  return Array.isArray(labels) && labels.length > 0 ? labels : null;
}
