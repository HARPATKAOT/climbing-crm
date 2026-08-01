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
