/**
 * אירוע אחד, כמה טעמים.
 *
 * יום הולדת, קבוצת בית ספר ופעילות חברה הם אותו דבר בכל מה שהמערכת מחליטה
 * עליו: אותם תפקידים משבצים אותם, אותו שכר משולם, ואותו יום קיר נפתח בזכותם.
 * שלושה סוגים נפרדים ביומן רק פיצלו את אותה הפעילות לשלושה מקומות שצריך לזכור
 * לתחזק בנפרד — ולכן הם סוג אחד, `event`, עם תגית שאומרת איזה אירוע בדיוק.
 *
 * התגית היא תווית, לא התנהגות. שום החלטה בקוד לא נתלית בה, וזה בכוונה: ברגע
 * שתגית תתחיל להשפיע על שכר או על שיבוץ, היא תהיה סוג בתחפושת.
 */

/** תאום של הקובץ הזה בצד הלקוח: client/src/utils/eventKinds.js */
export const EVENT_TYPE = 'event';

export const EVENT_KINDS = [
  { id: 'birthday', label: 'יום הולדת' },
  { id: 'company', label: 'פעילות חברה' },
  { id: 'school', label: 'בית ספר' },
  { id: 'camp', label: 'קייטנה' },
  { id: 'other', label: 'אחר' },
];

/**
 * סוגים שהיו ביומן לפני האיחוד, וכל אחד מהם היה בעצם אירוע.
 *
 * שורות ותיקות עוברות מיגרציה, אבל גם אחריה יכולה להגיע רשומה עם הסוג הישן —
 * מיומן גוגל שסונכרן מזמן, מתבנית שנשמרה, או מגיבוי. התרגום נשאר בקוד כדי
 * שרשומה כזאת תיפול למקום הנכון במקום להיעלם ל„אחר”.
 */
export const LEGACY_EVENT_TYPES = {
  birthday: 'birthday',
  school: 'school',
  company: 'company',
};

/** האם הסוג הזה הוא אירוע — כולל הסוגים שקדמו לאיחוד. */
export function isEventType(type) {
  const key = String(type || '').trim().toLowerCase();
  return key === EVENT_TYPE || Object.hasOwn(LEGACY_EVENT_TYPES, key);
}

/**
 * הסוג והתגית שרשומה צריכה לשאת, מכל צורה שהיא הגיעה בה.
 * רשומה ותיקה (`type: 'birthday'`) מתורגמת ל-`{ type: 'event', eventKind: 'birthday' }`.
 */
export function normalizeActivityType(type, eventKind) {
  const key = String(type || '').trim().toLowerCase();
  const legacy = LEGACY_EVENT_TYPES[key];
  if (legacy) return { type: EVENT_TYPE, eventKind: eventKind || legacy };
  if (key === EVENT_TYPE) {
    const kind = String(eventKind || '').trim().toLowerCase();
    return { type: EVENT_TYPE, eventKind: EVENT_KINDS.some((k) => k.id === kind) ? kind : '' };
  }
  return { type: key, eventKind: '' };
}

export function eventKindLabel(eventKind) {
  return EVENT_KINDS.find((k) => k.id === String(eventKind || '').toLowerCase())?.label || '';
}
