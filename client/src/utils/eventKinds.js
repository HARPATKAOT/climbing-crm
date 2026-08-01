/**
 * תאום של `server/eventKinds.js`. שני הצדדים חייבים להסכים מה נחשב אירוע.
 *
 * יום הולדת, בית ספר ופעילות חברה הם סוג אחד ביומן — `event` — כי מבחינת
 * שיבוץ, תפקידים ושכר הם אותו דבר בדיוק. התגית אומרת איזה אירוע זה, ומופיעה
 * לצד השם: „אירוע — יום הולדת”.
 */

export const EVENT_TYPE = 'event';

export const EVENT_KINDS = [
  { id: 'birthday', label: 'יום הולדת' },
  { id: 'company', label: 'פעילות חברה' },
  { id: 'school', label: 'בית ספר' },
  { id: 'other', label: 'אחר' },
];

/** סוגים שהיו ביומן לפני האיחוד, וכל אחד מהם היה בעצם אירוע. */
const LEGACY_EVENT_TYPES = { birthday: 'birthday', school: 'school', company: 'company' };

/** האם הסוג הזה הוא אירוע — כולל הסוגים שקדמו לאיחוד. */
export function isEventType(type) {
  const key = String(type || '').trim().toLowerCase();
  return key === EVENT_TYPE || Object.hasOwn(LEGACY_EVENT_TYPES, key);
}

/**
 * התגית של פעילות. רשומה ותיקה שעוד נושאת `type: 'birthday'` מדווחת על התגית
 * שהיא הייתה מקבלת, כדי שהיומן יראה אותה נכון גם לפני שהמיגרציה נגעה בה.
 */
export function activityEventKind(activity) {
  if (!activity) return '';
  const explicit = String(activity.event_kind || activity.eventKind || '').toLowerCase();
  if (explicit) return explicit;
  return LEGACY_EVENT_TYPES[String(activity.type || '').toLowerCase()] || '';
}

export function eventKindLabel(eventKind) {
  return EVENT_KINDS.find((k) => k.id === String(eventKind || '').toLowerCase())?.label || '';
}

/** „אירוע — יום הולדת”, או רק „אירוע” כשלא נבחרה תגית. */
export function eventTypeLabel(baseLabel, activity) {
  const kind = eventKindLabel(activityEventKind(activity));
  return kind ? `${baseLabel} — ${kind}` : baseLabel;
}
