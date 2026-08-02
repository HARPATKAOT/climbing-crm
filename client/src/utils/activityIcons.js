/**
 * האייקון של כל סוג פעילות ביומן.
 *
 * הצבע לבדו לא מספיק: כל האירועים — יום הולדת, בית ספר, פעילות חברה — חולקים
 * צבע אחד, כי מבחינת שיבוץ ושכר הם אותו סוג. האייקון הוא מה שמבדיל ביניהם
 * במבט מהיר על היומן, בלי לקרוא את השם.
 *
 * לכן ההחלטה נעשית בשני שלבים: קודם התגית של האירוע (`event_kind`), ורק אם
 * אין כזו — סוג הפעילות.
 */

import {
  Cake, GraduationCap, Briefcase, PartyPopper, Backpack, Dumbbell,
  Route, DoorOpen, Palmtree, Tag,
} from 'lucide-react';
import { activityEventKind, isEventType } from './eventKinds.js';

/** סוג פעילות → אייקון. הסוגים הוותיקים שקדמו לאיחוד מופיעים כאן גם הם. */
const TYPE_ICONS = {
  event: PartyPopper,
  trip: Backpack,
  personal_training: Dumbbell,
  route_building: Route,
  opening_hours: DoorOpen,
  training_vacation: Palmtree,
  other: Tag,
  // רשומות שעוד נושאות את הסוג הישן, לפני שהמיגרציה נגעה בהן
  birthday: Cake,
  school: GraduationCap,
  company: Briefcase,
};

/** תגית האירוע → אייקון. זה מה שמבדיל בין אירוע לאירוע באותו צבע. */
const EVENT_KIND_ICONS = {
  birthday: Cake,
  school: GraduationCap,
  company: Briefcase,
  other: PartyPopper,
};

/** סוג שנוצר בשרת ואין לו אייקון מוגדר עדיין נופל ל„אחר”. */
export function activityTypeIcon(typeId) {
  if (typeId === 'activities') return PartyPopper; // תגית הסינון המקבצת
  return TYPE_ICONS[String(typeId || '').toLowerCase()] || Tag;
}

/** האייקון של פעילות קיימת — לפי התגית שלה, ואם אין — לפי הסוג. */
export function activityIcon(activity) {
  if (isEventType(activity?.type)) {
    const kind = EVENT_KIND_ICONS[activityEventKind(activity)];
    if (kind) return kind;
  }
  return activityTypeIcon(activity?.type);
}
