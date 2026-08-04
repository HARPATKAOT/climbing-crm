/**
 * The internal alerts an employee can subscribe to on their card.
 *
 * Keys must match `server/staffAlerts.js` — the server decides who is notified,
 * this list only decides what the screen offers. Same pairing as the wage rates,
 * and `staffAlertsMirror.test.js` fails the build if the two drift apart.
 *
 * The list is divided into sections, and each section names the audience it
 * belongs to: a מדריך has no use for "העברה לצוות" or "שיבוץ מהבוט", so those
 * sections only appear for an employee marked מזכירות or מנהל on their card.
 */

export const STAFF_ALERT_CATEGORIES = [
  {
    key: 'groups',
    label: 'חוגים',
    hint: 'מה שקורה בקבוצות שאני מדריך',
    audience: 'staff',
  },
  {
    key: 'events',
    label: 'אירועים ושיבוצים',
    hint: 'המשמרות והאירועים שאני משובץ אליהם',
    audience: 'staff',
  },
  {
    key: 'office',
    label: 'מזכירות',
    hint: 'הרשמות ופניות שממתינות לטיפול',
    audience: 'office',
  },
  {
    key: 'management',
    label: 'ניהול',
    hint: 'מה שהבוט עושה ומה שדורש החלטה',
    audience: 'manager',
  },
];

export const STAFF_ACCESS_LEVELS = [
  { key: 'staff', label: 'מדריך', hint: 'החוגים והשיבוצים שלו בלבד' },
  { key: 'office', label: 'מזכירות', hint: 'בנוסף: הרשמות, פניות שממתינות וגבייה' },
  { key: 'manager', label: 'מנהל', hint: 'הכול, כולל התראות ניהול ופעולות הבוט' },
];

const LEVEL_RANK = { staff: 0, office: 1, manager: 2 };

export const REMINDER_LEAD_OPTIONS = [
  { value: 1, label: 'שעה לפני' },
  { value: 2, label: 'שעתיים לפני' },
  { value: 3, label: '3 שעות לפני' },
  { value: 6, label: '6 שעות לפני' },
  { value: 12, label: '12 שעות לפני' },
  { value: 24, label: 'יום לפני' },
  { value: 48, label: 'יומיים לפני' },
];

export const STAFF_ALERT_KINDS = [
  {
    key: 'group_student_joined',
    category: 'groups',
    scope: 'own',
    label: 'מתאמן נרשם לקבוצה',
    hint: 'ילד חדש נכנס לאחת הקבוצות שאני מדריך',
    templateChoice: true,
    templateVars: ['שם המדריך', 'שם המתאמן', 'שם הקבוצה'],
  },
  {
    key: 'group_student_left',
    category: 'groups',
    scope: 'own',
    label: 'מתאמן עזב את הקבוצה',
    hint: 'ילד הוסר מקבוצה שאני מדריך',
    templateChoice: true,
    templateVars: ['שם המדריך', 'שם המתאמן', 'שם הקבוצה'],
  },
  {
    key: 'group_intro_upcoming',
    category: 'groups',
    scope: 'own',
    label: 'מגיע לאימון היכרות',
    hint: 'מתאמן חדש מגיע להיכרות באחד האימונים שלי — נשלח יום לפני',
    templateChoice: true,
    templateVars: ['שם המדריך', 'שם המתאמן', 'שם הקבוצה', 'שעה'],
  },
  {
    key: 'shift_assigned',
    category: 'events',
    scope: 'own',
    label: 'שובצתי לאירוע',
    hint: 'הודעה ברגע שמישהו משבץ אותי לאירוע ביומן',
    templateChoice: true,
    templateVars: ['שם העובד', 'שם האירוע', 'תאריך', 'שעה'],
  },
  {
    key: 'shift_reminder',
    category: 'events',
    scope: 'own',
    label: 'תזכורת לפני אירוע',
    hint: 'תזכורת לפני כל אירוע שאני משובץ אליו',
    templateChoice: true,
    templateVars: ['שם העובד', 'שם האירוע', 'תאריך', 'שעה'],
    settings: [
      {
        key: 'lead_hours',
        type: 'select',
        label: 'מתי לשלוח',
        default: 24,
        options: REMINDER_LEAD_OPTIONS,
      },
    ],
  },
  {
    key: 'handoff',
    category: 'office',
    scope: 'all',
    label: 'העברה לצוות',
    hint: 'לקוח ביקש לדבר עם אדם, או שהבוט לא ידע לענות',
  },
  {
    key: 'signup_stalled',
    category: 'office',
    scope: 'all',
    label: 'ממתינים לאישור הרשמה',
    hint: 'סיכום יומי של מי שממתין יותר מכמה ימים',
  },
  {
    key: 'placement',
    category: 'management',
    scope: 'all',
    label: 'שיבוץ מהבוט',
    hint: 'הבוט שיבץ מתאמן לקבוצה או לרשימת המתנה',
  },
];

export const STAFF_ALERT_KEYS = STAFF_ALERT_KINDS.map((a) => a.key);

const KIND_BY_KEY = new Map(STAFF_ALERT_KINDS.map((a) => [a.key, a]));
const CATEGORY_BY_KEY = new Map(STAFF_ALERT_CATEGORIES.map((c) => [c.key, c]));

export function staffAlertKind(key) {
  return KIND_BY_KEY.get(String(key || '')) || null;
}

export function alertAudience(key) {
  const kind = staffAlertKind(key);
  return CATEGORY_BY_KEY.get(kind?.category)?.audience || 'staff';
}

/**
 * An employee with no level yet is read from what they already receive: the
 * owner has been subscribed to "שיבוץ מהבוט" since before levels existed, and
 * their card must not open by calling those alerts above their own level.
 */
export function employeeAccessLevel(employee) {
  const raw = String(employee?.access_level || '').trim();
  if (Object.prototype.hasOwnProperty.call(LEVEL_RANK, raw)) return raw;
  const audiences = (Array.isArray(employee?.alerts) ? employee.alerts : []).map(alertAudience);
  if (audiences.includes('manager')) return 'manager';
  if (audiences.includes('office')) return 'office';
  return 'staff';
}

export function accessLevelLabel(level) {
  return STAFF_ACCESS_LEVELS.find((l) => l.key === level)?.label || 'מדריך';
}

export function levelCovers(level, audience) {
  return (LEVEL_RANK[String(level)] ?? 0) >= (LEVEL_RANK[String(audience)] ?? 0);
}

/**
 * The sections to draw, for a given level and current subscriptions.
 * An alert the employee is already subscribed to is shown even when the level
 * would hide it — otherwise lowering someone's level would leave a live
 * subscription with no screen to switch it off from.
 */
export function alertSectionsFor(level, subscribed = []) {
  const has = new Set(subscribed);
  return STAFF_ALERT_CATEGORIES
    .map((category) => ({
      ...category,
      kinds: STAFF_ALERT_KINDS.filter(
        (k) => k.category === category.key && (levelCovers(level, category.audience) || has.has(k.key))
      ),
      locked: !levelCovers(level, category.audience),
    }))
    .filter((section) => section.kinds.length > 0);
}

/** Per-alert choices with the defaults filled in. */
export function alertSettings(employee, key) {
  const spec = staffAlertKind(key);
  if (!spec) return {};
  const stored = employee?.alert_settings?.[key] || {};
  const out = {};
  for (const field of spec.settings || []) {
    const value = stored[field.key];
    out[field.key] = value === undefined || value === null || value === ''
      ? field.default
      : value;
  }
  if (spec.templateChoice) out.template_id = stored.template_id || null;
  return out;
}
