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
 */

/** Every alert an employee can subscribe to, with the label the screen shows. */
export const STAFF_ALERT_KINDS = [
  {
    key: 'handoff',
    label: 'העברה לצוות',
    hint: 'לקוח ביקש לדבר עם אדם, או שהבוט לא ידע לענות',
  },
  {
    key: 'placement',
    label: 'שיבוץ מהבוט',
    hint: 'הבוט שיבץ מתאמן לקבוצה או לרשימת המתנה',
  },
  {
    key: 'signup_stalled',
    label: 'ממתינים לאישור הרשמה',
    hint: 'סיכום יומי של מי שממתין יותר מכמה ימים',
  },
];

export const STAFF_ALERT_KEYS = STAFF_ALERT_KINDS.map((a) => a.key);

export function isStaffAlertKey(key) {
  return STAFF_ALERT_KEYS.includes(String(key || ''));
}

/** The alerts this employee asked for, ignoring anything unknown. */
export function employeeAlertKeys(employee) {
  const raw = employee?.alerts;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((k) => String(k || '')).filter(isStaffAlertKey))];
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
 * @returns {{ phones: string[], source: 'employees' | 'settings' | 'none' }}
 */
export function alertRecipients(store, kind, settings = {}) {
  if (!isStaffAlertKey(kind)) return { phones: [], source: 'none' };

  const employees = (store?.get ? store.get('employees') : []) || [];
  const subscribed = employees
    .filter((e) => e && e.is_active !== false && e.active !== false)
    .filter((e) => employeeAlertKeys(e).includes(kind))
    .map((e) => String(e.phone || '').trim())
    .filter(Boolean);

  const unique = [...new Set(subscribed)];
  if (unique.length) return { phones: unique, source: 'employees' };

  const fallback = [...new Set(phonesFromSettings(settings))];
  return fallback.length
    ? { phones: fallback, source: 'settings' }
    : { phones: [], source: 'none' };
}
