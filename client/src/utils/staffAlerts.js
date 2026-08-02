/**
 * The internal alerts an employee can subscribe to on their card.
 *
 * Keys must match `server/staffAlerts.js` — the server decides who is notified,
 * this list only decides what the screen offers. Same pairing as the wage rates.
 */
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
