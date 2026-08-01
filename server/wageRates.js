/**
 * תעריפי שכר לפי תפקיד.
 *
 * עד כאן היו ארבעה תעריפים קבועים בהסכם (דלפק/חוג/פרטי/בנייה), ולא היה איפה
 * לרשום „יום טיול סנפלינג”. עכשיו ההסכם מחזיק רשימה פתוחה: שורה לכל תפקיד,
 * עם אופן תשלום וסכום. התפקידים הם אותם תפקידים שמסמנים בכרטיס העובד, כך
 * שמי שאפשר לשבץ לתפקיד הוא גם מי שיש לו תעריף עליו.
 *
 * רשימת התפקידים חייבת להתאים ל-client/src/utils/staffRoles.js.
 */

export const PAY_MODES = ['hourly', 'daily', 'flat'];

/** התפקידים שאפשר להגדיר להם תעריף, עם אופן התשלום הרגיל לכל אחד. */
export const PAYABLE_ROLES = [
  { role: 'הדרכת חוג', defaultMode: 'hourly' },
  { role: 'עוזר מדריך', defaultMode: 'hourly' },
  { role: 'הפעלת קיר', defaultMode: 'hourly' },
  { role: 'הדרכת סנפלינג', defaultMode: 'daily' },
  { role: 'שיעור פרטי', defaultMode: 'hourly' },
  { role: 'בונה מסלולים', defaultMode: 'hourly' },
];

/** אופן התשלום הרגיל לפי מפתח התפקיד — עובד גם אחרי שהתווית שונתה. */
export const PAYABLE_ROLE_MODES = {
  trainer: 'hourly',
  assistant: 'hourly',
  wall_operator: 'hourly',
  rappel: 'daily',
  private: 'hourly',
  route_l1: 'hourly',
};

/** ההסכמים הישנים החזיקו ארבעה שדות. אלה התפקידים שהם הפכו להיות. */
const LEGACY_RATE_FIELDS = [
  { field: 'class_rate', role: 'הדרכת חוג', mode: 'hourly' },
  { field: 'counter_rate', role: 'הפעלת קיר', mode: 'hourly' },
  { field: 'private_rate', role: 'שיעור פרטי', mode: 'hourly' },
  { field: 'route_rate', role: 'בונה מסלולים', mode: 'hourly' },
];

/**
 * סוגי העבודה הישנים ממופים לתפקידים, כדי ששורות ותיקות ימשיכו להיות מתומחרות.
 *
 * המיפוי הוא למפתח התפקיד ולא לשם, כי השם ניתן לשינוי: אחרי שינוי שם, טבלה
 * קבועה הייתה מפנה שורה ותיקה לתפקיד שכבר לא קיים והיא הייתה מתומחרת ב-₪0.
 */
export const WORK_TYPE_ROLE_KEYS = {
  class_shift: 'trainer',
  counter_shift: 'wall_operator',
  private_shift: 'private',
  route_building_shift: 'route_l1',
};

/** התוויות שבקוד — ברירת מחדל עד שהקטלוג נטען. */
export const WORK_TYPE_ROLES = {
  class_shift: 'הדרכת חוג',
  counter_shift: 'הפעלת קיר',
  private_shift: 'שיעור פרטי',
  route_building_shift: 'בונה מסלולים',
};

let liveWorkTypeRoles = null;

/** מעדכן את התוויות מתוך תפקידי המערכת בקטלוג. נקרא בכל טעינה של הקטלוג. */
export function applyRoleLabels(system) {
  if (!Array.isArray(system) || system.length === 0) return;
  const byKey = Object.fromEntries(system.filter((r) => r && r.key).map((r) => [r.key, r.label]));
  liveWorkTypeRoles = Object.fromEntries(
    Object.entries(WORK_TYPE_ROLE_KEYS).map(([type, key]) => [type, byKey[key] || WORK_TYPE_ROLES[type]])
  );
}

/** התפקיד שסוג עבודה מתומחר לפיו, בשמו העדכני. */
export function workTypeRole(workType) {
  if (!workType) return null;
  return (liveWorkTypeRoles || WORK_TYPE_ROLES)[workType] || null;
}

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * שעות מעוגלות לחצי השעה הקרובה כלפי מעלה: חוג של 50 דקות משולם כשעה,
 * ושל 80 דקות כשעה וחצי. עיגול כלפי מטה היה גוזל מהעובד זמן שהוא עבד.
 */
export function roundHoursHalfUp(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n * 2) / 2;
}

/** רשימת התעריפים של ההסכם, כולל המרה של הסכמים ישנים שאין בהם רשימה. */
export function ratesOf(agreement) {
  if (Array.isArray(agreement?.rates) && agreement.rates.length > 0) {
    return agreement.rates
      .filter((r) => r && r.role)
      .map((r) => ({
        role: String(r.role),
        mode: PAY_MODES.includes(r.mode) ? r.mode : 'hourly',
        amount: num(r.amount),
      }));
  }
  return LEGACY_RATE_FIELDS
    .filter(({ field }) => agreement?.[field] !== undefined && agreement?.[field] !== null)
    .map(({ field, role, mode }) => ({ role, mode, amount: num(agreement[field]) }));
}

/** התעריף של העובד לתפקיד מסוים, או null אם לא הוגדר לו. */
export function rateForRole(agreement, role) {
  if (!role) return null;
  return ratesOf(agreement).find((r) => r.role === role) || null;
}

export function travelPerDay(agreement) {
  return num(agreement?.travel_per_day);
}

/**
 * הסכום שנחתם על השורה, או null אם היא עוד לא תומחרה.
 *
 * שורה חתומה היא האמת על מה שהעובד השתכר באותו יום — העלאת תעריף, שינוי שם
 * תפקיד או מחיקתו לא נוגעים בה. רק עריכה מפורשת של השורה מתמחרת אותה מחדש.
 */
export function frozenAmountOf(row) {
  if (!row?.pay_frozen_at) return null;
  const n = Number(row?.pay_amount);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * הסכום לשורת עבודה אחת.
 * - שורה חתומה: הסכום השמור עליה, בלי חישוב מחדש.
 * - `flat`: הסכום שנקבע על השורה (אירוע בתשלום גלובלי), בלי קשר לשעות.
 * - `daily`: תעריף היום של התפקיד — יום טיול משולם כיום, לא לפי שעות.
 * - `hourly`: שעות מעוגלות כפול התעריף.
 */
export function amountForWorkRow(row, agreement) {
  const frozen = frozenAmountOf(row);
  if (frozen !== null) return frozen;
  if (row?.pay_mode === 'flat') return Math.round(num(row.flat_amount));

  const role = row?.role || workTypeRole(row?.work_type) || null;
  const rate = rateForRole(agreement, role);
  if (!rate) return 0;
  if (rate.mode === 'daily') return Math.round(rate.amount);
  return Math.round(roundHoursHalfUp(row?.hours) * rate.amount);
}

/**
 * ימי עבודה = ימים שיש בהם לפחות שורת עבודה אחת. תשלום הנסיעות הוא ליום,
 * ולכן שתי משמרות באותו יום אינן שתי נסיעות.
 */
export function workDaysOf(rows) {
  return new Set((rows || []).map((r) => r?.date).filter(Boolean)).size;
}

/**
 * פירוט לפי תפקיד: כמה שעות וכמה כסף נצברו בכל תפקיד בפועל. שורות בתשלום
 * גלובלי מופרדות, כי אין להן תעריף שעתי שאפשר להציג לידן.
 */
export function summarizeByRole(rows, agreement) {
  const map = new Map();
  for (const row of rows || []) {
    const role = row?.role || workTypeRole(row?.work_type) || 'ללא תפקיד';
    const flat = row?.pay_mode === 'flat';
    const key = flat ? `${role} · גלובלי` : role;
    const entry = map.get(key) || { label: key, role, flat, hours: 0, amount: 0, count: 0 };
    entry.hours += roundHoursHalfUp(row?.hours);
    entry.amount += amountForWorkRow(row, agreement);
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()]
    .map((e) => ({ ...e, hours: Math.round(e.hours * 100) / 100, amount: Math.round(e.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/** סיכום חודשי אחד: שעות, שכר עבודה, ימי עבודה ונסיעות. */
export function summarizeWork(rows, agreement) {
  let hours = 0;
  let pay = 0;
  for (const row of rows || []) {
    hours += roundHoursHalfUp(row?.hours);
    pay += amountForWorkRow(row, agreement);
  }
  const days = workDaysOf(rows);
  const travel = days * travelPerDay(agreement);
  return {
    hours: Math.round(hours * 100) / 100,
    pay: Math.round(pay),
    days,
    travel: Math.round(travel),
    total: Math.round(pay + travel),
  };
}
