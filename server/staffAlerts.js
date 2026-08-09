/**
 * Who on the team hears about what.
 *
 * The recipients used to be a comma-separated phone field in the bot settings —
 * one list for every kind of alert, kept in a screen nobody opens, and empty in
 * practice, so no alert ever went out. Each employee now subscribes on their own
 * card to the alerts they want.
 *
 * The settings field stays as the fallback: until someone is subscribed, the old
 * behaviour is what happens, so switching this on cannot silence the team.
 *
 * ## Why alerts are grouped, and why a level decides what is shown
 *
 * A מדריך has no use for "העברה לצוות" or "שיבוץ מהבוט" — those are a manager's
 * or the office's business, and a list that shows everyone everything is a list
 * where the two lines that matter to an instructor drown. So every alert names
 * a category (חוגים / אירועים / מזכירות / ניהול) and the audience that category
 * belongs to, and every employee carries an access level. The level decides what
 * the card *offers*.
 *
 * Delivery is decided by the subscription alone, never by the level: an employee
 * subscribed before levels existed keeps getting their alerts, because demoting
 * someone by accident must not silently mute a channel the team relies on. The
 * form shows such a subscription as it is, so it can be removed on purpose.
 *
 * ## Scope: `own` vs `all`
 *
 * `own` alerts are about the subscriber's own work — their group, their shift —
 * and the caller says who that is. `all` alerts go to everyone subscribed.
 */

/** Sections of the alert list, in the order the card shows them. */
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

/**
 * How much of the alert list an employee is offered.
 * A level is a ladder: מזכירות sees the instructor sections too, מנהל sees all.
 */
export const STAFF_ACCESS_LEVELS = [
  {
    key: 'staff',
    label: 'מדריך',
    hint: 'החוגים והשיבוצים שלו בלבד',
  },
  {
    key: 'office',
    label: 'מזכירות',
    hint: 'בנוסף: הרשמות, פניות שממתינות וגבייה',
  },
  {
    key: 'manager',
    label: 'מנהל',
    hint: 'הכול, כולל התראות ניהול ופעולות הבוט',
  },
];

const LEVEL_RANK = { staff: 0, office: 1, manager: 2 };

/** Options offered for "כמה זמן לפני", in hours. */
export const REMINDER_LEAD_OPTIONS = [
  { value: 1, label: 'שעה לפני' },
  { value: 2, label: 'שעתיים לפני' },
  { value: 3, label: '3 שעות לפני' },
  { value: 6, label: '6 שעות לפני' },
  { value: 12, label: '12 שעות לפני' },
  { value: 24, label: 'יום לפני' },
  { value: 48, label: 'יומיים לפני' },
];

/**
 * Every alert an employee can subscribe to.
 *
 * `templateChoice` means the employee may point this alert at an approved
 * WhatsApp template instead of the built-in text. Template variables are always
 * positional and always in the order listed in `templateVars`.
 */
export const STAFF_ALERT_KINDS = [
  // ── חוגים ──────────────────────────────────────────────────────────────────
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
  // ── אירועים ושיבוצים ───────────────────────────────────────────────────────
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
  // ── מזכירות ────────────────────────────────────────────────────────────────
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
    key: 'pos_link_paid',
    category: 'office',
    scope: 'all',
    label: 'שולם קישור מהקופה',
    hint: 'לקוח שנשלח לו קישור להשלמת מסמכים ותשלום — סיים ושילם',
  },
  // ── ניהול ──────────────────────────────────────────────────────────────────
  {
    key: 'placement',
    category: 'management',
    scope: 'all',
    label: 'שיבוץ מהבוט',
    hint: 'הבוט שיבץ מתאמן לקבוצה או לרשימת המתנה',
  },
  {
    key: 'placement_approval',
    category: 'management',
    scope: 'all',
    label: 'בקשת אישור למתקדמים או לנבחרת',
    hint: 'מועמד חדש ממתין להחלטת צוות לפני שיבוץ ושליחת קישור',
  },
  {
    key: 'ai_outage',
    category: 'management',
    scope: 'all',
    label: 'שירות הבינה אינו זמין',
    hint: 'התראה אחת בתקלה והתראה אחת לאחר התאוששות Gemini',
  },
  {
    key: 'cash_register_closed',
    category: 'management',
    scope: 'all',
    label: 'סגירת קופה',
    hint: 'סיכום יומי אחרי סגירת משמרת — חריגה ויתרת מזומן במגירה',
  },
];

export const STAFF_ALERT_KEYS = STAFF_ALERT_KINDS.map((a) => a.key);

const KIND_BY_KEY = new Map(STAFF_ALERT_KINDS.map((a) => [a.key, a]));
const CATEGORY_BY_KEY = new Map(STAFF_ALERT_CATEGORIES.map((c) => [c.key, c]));

export function isStaffAlertKey(key) {
  return KIND_BY_KEY.has(String(key || ''));
}

export function staffAlertKind(key) {
  return KIND_BY_KEY.get(String(key || '')) || null;
}

/** The audience a single alert belongs to, through its category. */
export function alertAudience(key) {
  const kind = staffAlertKind(key);
  return CATEGORY_BY_KEY.get(kind?.category)?.audience || 'staff';
}

/**
 * The employee's level.
 *
 * Nobody carried one before this screen existed, and defaulting everyone to
 * מדריך would show the owner — subscribed to "שיבוץ מהבוט" since day one — a
 * card telling them their own alerts are above their level. So an unset level
 * is read from what the employee is already subscribed to, and the first save
 * of the card writes it down explicitly.
 */
export function employeeAccessLevel(employee) {
  const raw = String(employee?.access_level || '').trim();
  if (Object.prototype.hasOwnProperty.call(LEVEL_RANK, raw)) return raw;
  const audiences = employeeAlertKeys(employee).map(alertAudience);
  if (audiences.includes('manager')) return 'manager';
  if (audiences.includes('office')) return 'office';
  return 'staff';
}

export function isManager(employee) {
  return employeeAccessLevel(employee) === 'manager';
}

/** Does this level reach that audience? Levels are a ladder, not a set. */
export function levelCovers(level, audience) {
  const have = LEVEL_RANK[String(level)] ?? 0;
  const need = LEVEL_RANK[String(audience)] ?? 0;
  return have >= need;
}

/**
 * What the employee's card should offer, plus anything they are already
 * subscribed to — a subscription made before the level existed stays visible so
 * it can be removed deliberately rather than vanishing from the screen.
 */
export function visibleAlertKeys(employee) {
  const level = employeeAccessLevel(employee);
  const subscribed = new Set(employeeAlertKeys(employee));
  return STAFF_ALERT_KINDS
    .filter((k) => levelCovers(level, alertAudience(k.key)) || subscribed.has(k.key))
    .map((k) => k.key);
}

/** The alerts this employee asked for, ignoring anything unknown. */
export function employeeAlertKeys(employee) {
  const raw = employee?.alerts;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((k) => String(k || '')).filter(isStaffAlertKey))];
}

export function isSubscribed(employee, kind) {
  return employeeAlertKeys(employee).includes(String(kind || ''));
}

/** Per-alert choices (lead time, template), filled in with the defaults. */
export function alertSettings(employee, kind) {
  const spec = staffAlertKind(kind);
  if (!spec) return {};
  const stored = employee?.alert_settings?.[spec.key] || {};
  const out = {};
  for (const field of spec.settings || []) {
    const value = stored[field.key];
    out[field.key] = value === undefined || value === null || value === ''
      ? field.default
      : value;
  }
  if (spec.templateChoice) {
    out.template_id = stored.template_id || null;
  }
  return out;
}

/** Hours before the event this employee wants their reminder. */
export function reminderLeadHours(employee, kind = 'shift_reminder') {
  const raw = Number(alertSettings(employee, kind).lead_hours);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

function activeEmployees(store) {
  const employees = (store?.get ? store.get('employees') : []) || [];
  return employees.filter((e) => e && e.is_active !== false && e.active !== false);
}

/**
 * The employee rows subscribed to one kind of alert.
 * Delivery follows the subscription, not the access level — see the note above.
 *
 * @param {object} store db-like with `get`
 * @param {string} kind alert key
 * @param {object} [options] `employeeIds` narrows to the people an `own`-scoped
 *   alert is about (the group's trainer, the employee on the shift).
 */
export function alertSubscribers(store, kind, { employeeIds = null } = {}) {
  if (!isStaffAlertKey(kind)) return [];
  const only = employeeIds ? new Set(employeeIds.map((id) => String(id))) : null;
  return activeEmployees(store)
    .filter((e) => !only || only.has(String(e.id)))
    .filter((e) => isSubscribed(e, kind));
}

function phonesFromSettings(settings) {
  return String(settings?.aiStaffPhones || '')
    .split(/[,|\n]+/)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

/**
 * Phone numbers to notify for one kind of alert.
 * An archived employee never gets alerts, and a subscriber with no phone is
 * simply skipped rather than failing the send.
 *
 * The settings fallback only covers `all`-scoped alerts: a reminder about one
 * person's own shift has no meaning sent to a shared team number.
 *
 * @returns {{ phones: string[], source: 'employees' | 'settings' | 'none' }}
 */
export function alertRecipients(store, kind, settings = {}) {
  if (!isStaffAlertKey(kind)) return { phones: [], source: 'none' };

  const subscribed = alertSubscribers(store, kind)
    .map((e) => String(e.phone || '').trim())
    .filter(Boolean);

  const unique = [...new Set(subscribed)];
  if (unique.length) return { phones: unique, source: 'employees' };

  // The AI circuit must never fail silently on a fresh installation. Dalak is
  // the operational owner; once explicit subscribers are configured they take
  // precedence over this bootstrap recipient.
  if (kind === 'ai_outage') {
    const ownerPhones = activeEmployees(store)
      .filter((employee) => String(employee.id || '') === 'em1784923985754'
        || /דלק/u.test(String(employee.name || '')))
      .map((employee) => String(employee.phone || '').trim())
      .filter(Boolean);
    if (ownerPhones.length) return { phones: [...new Set(ownerPhones)], source: 'employees' };
    return { phones: ['0508862878'], source: 'settings' };
  }

  if (staffAlertKind(kind)?.scope === 'own') return { phones: [], source: 'none' };

  const fallback = [...new Set(phonesFromSettings(settings))];
  return fallback.length
    ? { phones: fallback, source: 'settings' }
    : { phones: [], source: 'none' };
}
