/**
 * אילו פרטים להציג על גבי האירוע ביומן.
 *
 * הרשימה נועדה לגדול — היום המדריך, מחר אולי המיקום או מספר הנרשמים — ולכן
 * כל שדה הוא שורה אחת ב-`CALENDAR_DISPLAY_FIELDS`, וכל מה שצריך כדי להוסיף
 * שדה חדש הוא להוסיף שורה ולהחזיר את הערך שלו ב-`activityDisplayLines`.
 *
 * הבחירה נשמרת בדפדפן ולא בשרת: זו העדפת תצוגה של מי שיושב מול המסך, ולא
 * הגדרה של העסק — לכל אחד היומן שלו.
 *
 * הערכים עצמם נשמרים במשתנה ברמת המודול, בדיוק כמו סוגי הפעילות, כי הצ'יפים
 * ביומן מקוננים כמה שכבות עמוק וקוראים אותם בזמן ציור.
 */

const STORAGE_KEY = 'crm.calendar.display-fields';

export const CALENDAR_DISPLAY_FIELDS = [
  { id: 'staff', label: 'מדריך', hint: 'שמות העובדים המשובצים לאירוע' },
];

const VALID_IDS = new Set(CALENDAR_DISPLAY_FIELDS.map((f) => f.id));

export function loadDisplayFields() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((id) => VALID_IDS.has(id)) : [];
  } catch {
    return [];
  }
}

export function saveDisplayFields(ids) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.filter((id) => VALID_IDS.has(id))));
  } catch {
    // אחסון חסום (גלישה פרטית) — הבחירה פשוט לא תישמר לפעם הבאה.
  }
}

/** מה שנבחר להצגה עכשיו, לקריאה מתוך צ'יפ שיושב עמוק בעץ. */
let selected = [];

export function setSelectedDisplayFields(ids) {
  selected = Array.isArray(ids) ? ids.filter((id) => VALID_IDS.has(id)) : [];
}

export function selectedDisplayFields() {
  return selected;
}

/** מזהה אירוע → העובדים המשובצים אליו, כל אחד עם התפקיד שלו באירוע. */
let staffNames = new Map();

export function setActivityStaffNames(map) {
  staffNames = map instanceof Map ? map : new Map();
}

/** השיבוצים המלאים — `{ name, role }` לכל עובד. */
export function activityStaffEntries(activityId) {
  return staffNames.get(activityId) || [];
}

/** רק השמות, לצ'יפ הצר ביומן ולצביעת האייקון. */
export function activityStaffNames(activityId) {
  return activityStaffEntries(activityId).map((e) => e.name);
}

/**
 * השורות הנוספות שצריכות להופיע על צ'יפ של אירוע, לפי מה שנבחר להצגה.
 * מוחזר מערך ריק כשאין מה להוסיף, כדי שהצ'יפ יישאר בדיוק כמו קודם.
 */
export function activityDisplayLines(activity, selectedIds = selected) {
  if (!activity || !selectedIds?.length) return [];
  const lines = [];
  if (selectedIds.includes('staff')) {
    const names = activityStaffNames(activity.id);
    if (names.length) lines.push(names.join(', '));
  }
  return lines;
}
