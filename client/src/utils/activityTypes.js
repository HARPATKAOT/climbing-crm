/**
 * סוגי הפעילות ביומן.
 *
 * הרשימה מגיעה מהשרת (`/api/activity-types`) כדי שאפשר יהיה להוסיף סוג חדש
 * בלי גרסה חדשה. הקבועים כאן הם ברירת המחדל בלבד — מה שמוצג עד שהקריאה
 * חוזרת, וגם הגיבוי אם היא נכשלת, כדי שהיומן לעולם לא ייפתח בלי סוגים.
 *
 * הרשימה נשמרת גם במשתנה ברמת המודול, כי רכיבים מקוננים ביומן צריכים לתרגם
 * מזהה של סוג לצבע ולתווית בזמן ציור, בלי לקבל את הרשימה כ-prop דרך חמש שכבות.
 */

import { useEffect, useState } from 'react';

export const DEFAULT_ACTIVITY_TYPES = [
  // „אירוע” אחד במקום יום הולדת / בית ספר / חברה. איזה אירוע בדיוק — בתגית.
  { id: 'event', label: 'אירוע', color: '#FB923C', bg: 'rgba(251,146,60,0.18)' },
  { id: 'trip', label: 'טיול', color: '#60A5FA', bg: 'rgba(96,165,250,0.18)' },
  { id: 'personal_training', label: 'אימון אישי', color: '#34D399', bg: 'rgba(52,211,153,0.18)' },
  { id: 'route_building', label: 'בניית מסלולים', color: '#A78BFA', bg: 'rgba(167,139,250,0.18)' },
  { id: 'opening_hours', label: 'שעות פתיחה', color: '#22D3EE', bg: 'rgba(34,211,238,0.16)', locked: true },
  { id: 'training_vacation', label: 'חופשה מאימונים', color: '#F472B6', bg: 'rgba(244,114,182,0.18)', locked: true },
  { id: 'other', label: 'אחר', color: '#94A3B8', bg: 'rgba(148,163,184,0.16)', locked: true },
];

let current = DEFAULT_ACTIVITY_TYPES;
let inFlight = null;

/** הרשימה הנוכחית, לקריאה מתוך רכיב שכבר נמצא מתחת ל-useActivityTypes. */
export function activityTypes() {
  return current;
}

/** התווית והצבע של סוג. סוג שנמחק נופל ל„אחר”, כדי שאירוע ותיק עוד ייצבע. */
export function activityTypeMeta(id) {
  return current.find((t) => t.id === id)
    || current.find((t) => t.id === 'other')
    || DEFAULT_ACTIVITY_TYPES[DEFAULT_ACTIVITY_TYPES.length - 1];
}

export function activityTypeLabel(id) {
  return current.find((t) => t.id === id)?.label || id || '';
}

export function invalidateActivityTypes() {
  inFlight = null;
}

export function fetchActivityTypes() {
  if (!inFlight) {
    inFlight = fetch('/api/activity-types')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (Array.isArray(body) && body.length > 0) current = body;
        return current;
      })
      .catch(() => current);
  }
  return inFlight;
}

/** סוגים שמוצגים יחד בתגית הסינון „פעילויות” — כולל הסוגים שקדמו לאיחוד. */
export const ACTIVITIES_GROUP_TYPES = ['event', 'personal_training', 'birthday', 'school', 'company'];

/**
 * תגיות הסינון לפי סוג — מקובצות, כפי שהן ביומן.
 *
 * ביומן בוחרים „פעילויות” ולא „אירוע” ו„אימון אישי” בנפרד, ולכן התגית הראשונה
 * היא סינתטית ומכסה כמה סוגים גולמיים. `match` הוא מה שצריך לשלוח לשרת: שם
 * הסינון עובד על הסוג השמור בשורה, לא על שם התגית.
 *
 * נבנות מהרשימה החיה, כך שסוג שהבעלים יוסיף מחר מקבל תגית משלו מיד — ומשותפות
 * ליומן ולטופס ההרשמה למשמרות, כדי שאותו שם לא יסנן שני דברים שונים בשני מסכים.
 */
export function activityFilterChips() {
  return [
    {
      id: 'activities',
      label: 'פעילויות',
      color: '#FB923C',
      bg: 'rgba(251,146,60,0.18)',
      match: ACTIVITIES_GROUP_TYPES,
    },
    ...current
      .filter((t) => !ACTIVITIES_GROUP_TYPES.includes(t.id))
      .map((t) => ({ id: t.id, label: t.label, color: t.color, bg: t.bg, match: [t.id] })),
  ];
}

/**
 * הרשימה העדכנית, ומרנדרת מחדש את הרכיב כשהיא מגיעה. מוחזרת תמיד רשימה
 * מלאה — בהתחלה ברירת המחדל — כדי שאף מסך לא יצייר יומן בלי סוגים.
 */
export function useActivityTypes() {
  const [types, setTypes] = useState(current);
  useEffect(() => {
    let cancelled = false;
    fetchActivityTypes().then((list) => { if (!cancelled) setTypes(list); });
    return () => { cancelled = true; };
  }, []);
  return types;
}
