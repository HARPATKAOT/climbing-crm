/**
 * איזו הצהרת בריאות נחתמת בהרשמה לאירוע מסוים.
 *
 * לאירוע יש כבר שני שדות לזה — `form_template_id` ו־`form_template_slug` —
 * אבל אף אחד לא קרא אותם: כל הרשמה דרך היומן, האתר או החנות החתימה על הצהרת
 * ברירת המחדל, כלומר הצהרת הקיר. מי שנרשם לטיול סנפלינג חתם על מסמך שמדבר על
 * קיר טיפוס.
 *
 * שתי שכבות, בסדר הזה:
 *   1. מה שנבחר על האירוע במפורש — הצוות יודע מה הוא עושה.
 *   2. ברירת מחדל לפי סוג הפעילות — כדי שאירוע שנוצר לפני שהשדה היה קיים, או
 *      שנוצר בלי לגעת בו, עדיין יחתים על ההצהרה הנכונה בלי שאיש יזכור לבחור.
 */

import { isEventType } from './eventKinds.js';

/** סוג פעילות ביומן -> ה-slug של ההצהרה שמתאימה לו. */
export const TYPE_TO_TEMPLATE_SLUG = {
  trip: 'trip',
  event: 'event',
};

/**
 * ה-slug שאירוע צריך להחתים עליו, לפני שמסתכלים אם התבנית קיימת.
 * מחזיר '' כשאין העדפה — ואז נופלים להצהרת ברירת המחדל.
 */
export function declarationSlugForActivity(activity) {
  const explicit = String(activity?.form_template_slug || activity?.formTemplateSlug || '').trim().toLowerCase();
  // 'wall' הוא מה שנשמר אוטומטית על כל אירוע מאז ומעולם, ולכן הוא לא עדות
  // לבחירה — רק בחירה שנבדלת מברירת המחדל הישנה נחשבת מפורשת.
  if (explicit && explicit !== 'wall') return explicit;

  const type = String(activity?.type || '').trim().toLowerCase();
  if (isEventType(type)) return TYPE_TO_TEMPLATE_SLUG.event;
  return TYPE_TO_TEMPLATE_SLUG[type] || explicit || '';
}

/**
 * התבנית עצמה. `resolve` הוא `resolveDeclarationTemplate` — מוזרק כדי שהמודול
 * הזה יישאר בר-בדיקה בלי מסד נתונים.
 */
export function declarationTemplateForActivity(db, activity, resolve) {
  const templateId = activity?.form_template_id || activity?.formTemplateId || null;
  const templateSlug = declarationSlugForActivity(activity);
  return resolve(db, { templateId, templateSlug });
}
