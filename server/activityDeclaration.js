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

/**
 * מי מחליט מה ברירת המחדל: **שדה „סוג הפעילות” על ההצהרה עצמה**, במסך עריכת
 * ההצהרות. הצהרה שסומנה „יציאה / טיול” היא זו שכל טיול ביומן יחתים עליה. אין
 * טבלה נסתרת בקוד — מי שרוצה שאירועים יחתימו על הצהרה אחרת פשוט מסמן אותה שם.
 *
 * `templates` היא רשימת ההצהרות הפעילות.
 */
/** סוגי הפעילות שהצהרה מסוימת משרתת, בכל צורת אחסון. */
export function templateActivityTypes(template) {
  const list = Array.isArray(template?.activityTypes)
    ? template.activityTypes
    : (Array.isArray(template?.activity_types) ? template.activity_types : null);
  if (list && list.length) return list.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);
  const single = String(template?.activityType || template?.activity_type || '').trim().toLowerCase();
  return single ? [single] : [];
}

export function defaultSlugForType(type, templates = []) {
  const key = String(type || '').trim().toLowerCase();
  if (!key) return '';
  // סוגי האירוע שקדמו לאיחוד מתנהגים כמו „אירוע”.
  const wanted = isEventType(key) ? 'event' : key;
  const match = (templates || []).find((t) => {
    if (t?.isActive === false) return false;
    return templateActivityTypes(t).includes(wanted);
  });
  return String(match?.slug || '').trim().toLowerCase();
}

/**
 * ה-slug שאירוע צריך להחתים עליו, לפני שמסתכלים אם התבנית קיימת.
 * מחזיר '' כשאין העדפה — ואז נופלים להצהרת ברירת המחדל.
 */
export function declarationSlugForActivity(activity, templates = []) {
  const explicit = String(activity?.form_template_slug || activity?.formTemplateSlug || '').trim().toLowerCase();
  // 'wall' הוא מה שנשמר אוטומטית על כל אירוע מאז ומעולם, ולכן הוא לא עדות
  // לבחירה — רק בחירה שנבדלת מברירת המחדל הישנה נחשבת מפורשת.
  if (explicit && explicit !== 'wall') return explicit;

  return defaultSlugForType(activity?.type, templates) || explicit || '';
}

/**
 * התבנית עצמה. `resolve` הוא `resolveDeclarationTemplate` — מוזרק כדי שהמודול
 * הזה יישאר בר-בדיקה בלי מסד נתונים.
 */
export function declarationTemplateForActivity(db, activity, resolve) {
  const templateId = activity?.form_template_id || activity?.formTemplateId || null;
  const templates = db?.get?.('form_templates') || [];
  const templateSlug = declarationSlugForActivity(activity, templates);
  return resolve(db, { templateId, templateSlug });
}
