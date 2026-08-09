/**
 * עוגני מחיר במחירון.
 *
 * כרטיסייה אינה מוצר עם מחיר משלה אלא כמות של משהו אחד — כניסה לקיר. לכן
 * המחיר שלה נגזר: כמות היחידות כפול מחיר העוגן, פחות ההנחה שניתנת על הכמות.
 * מי שמעלה את מחיר הכניסה מעלה בבת אחת את כל הכרטיסיות, ואי אפשר שתישאר
 * כרטיסייה שנמכרת לפי מחיר כניסה שכבר לא קיים.
 *
 * העוגן אינו בהכרח כניסה לקיר. אימון עם מדריך הוא בסיס אחר לגמרי, ולכן כל
 * פריט יכול להיות עוגן בפני עצמו — אבל רק ברמה אחת: עוגן שנשען על עוגן אחר
 * היה יוצר שרשרת שאיש לא יכול לעקוב אחריה בראש.
 *
 * ההנחה יכולה להיות שלילית, וזו תוספת. אימון זוגי עולה יותר מאימון אישי ולא
 * פחות, ובלי זה היה צריך עוגן שלישי רק בשביל ההפרש.
 */

import { PRODUCT_TYPES, normalizeProductType } from './posUtils.js';

/** השדות שמחזיקים את הקשר לעוגן. מרוכזים כאן כדי שהמסלולים לא ימציאו שמות. */
export const ANCHOR_FIELDS = Object.freeze([
  'is_price_anchor',
  'price_anchor_id',
  'anchor_units',
  'anchor_discount_percent',
]);

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function isPriceAnchor(item) {
  return item?.is_price_anchor === true;
}

/**
 * כמה יחידות עוגן יש בפריט.
 *
 * לכרטיסייה זה מספר הכניסות — אותו מספר שכבר מוקלד ומנפיק את הכרטיס, ואילו
 * שדה נפרד היה יכול לסתור אותו. למנוי לזמן אין כניסות, ולכן שם מקלידים כמה
 * כניסות החודש שווה.
 */
export function anchorUnitsOf(item) {
  const type = normalizeProductType(item);
  if (type === PRODUCT_TYPES.PUNCH_CARD) {
    const visits = Number(item?.visits_total);
    return Number.isFinite(visits) && visits > 0 ? visits : null;
  }
  const units = Number(item?.anchor_units);
  return Number.isFinite(units) && units > 0 ? units : null;
}

export function anchorDiscountOf(item) {
  const percent = Number(item?.anchor_discount_percent);
  if (!Number.isFinite(percent)) return 0;
  // תקרה למטה בלבד: מעל 100% ההנחה גדולה מהמחיר והפריט היה יוצא שלילי.
  return Math.min(100, percent);
}

/**
 * המחיר הנגזר, או null כשהפריט אינו קשור לעוגן או שחסר לו מידע. null אומר
 * „אל תיגע במחיר שמוקלד" — ולא „המחיר הוא אפס".
 */
export function computeAnchoredPrice(item, anchor) {
  if (!item?.price_anchor_id || !anchor) return null;
  if (String(anchor.id) === String(item.id)) return null;
  const base = Number(anchor.price);
  if (!Number.isFinite(base) || base < 0) return null;
  const units = anchorUnitsOf(item);
  if (units == null) return null;
  const gross = units * base;
  return money(Math.max(0, gross - gross * (anchorDiscountOf(item) / 100)));
}

/**
 * ההנחה שמשחזרת מחיר קיים בדיוק — הדרך להעביר מחירון קיים לעוגן בלי לשנות מחיר.
 *
 * ארבע ספרות אחרי הנקודה ולא שתיים: 410 מתוך 700 הם 41.428571%, ואחוז מעוגל
 * לשתי ספרות היה מחזיר 409.99 — אגורה שנופלת על כל כרטיסייה שמועברת לעוגן.
 * במסך מוצג האחוז מעוגל; מה שנשמר הוא המספר המדויק.
 */
export function discountPercentFor(price, units, anchorPrice) {
  const gross = (Number(units) || 0) * (Number(anchorPrice) || 0);
  if (!gross) return 0;
  return Math.round((1 - (Number(price) || 0) / gross) * 1000000) / 10000;
}

/**
 * הפריט אחרי שהמחיר הנגזר הוחל עליו. פריט בלי עוגן חוזר כמו שהוא, כי מחיר
 * מוקלד הוא עדיין מחיר לגיטימי — רק לא זה שמנוהל מכאן.
 */
export function withAnchoredPrice(item, anchor) {
  const price = computeAnchoredPrice(item, anchor);
  return price == null ? item : { ...item, price };
}

/**
 * כל הפריטים שמחירם משתנה בעקבות שינוי בעוגן.
 *
 * מוחזרים רק אלה שהמחיר שלהם באמת זז: שמירה חוזרת של אותו מחיר הייתה כותבת
 * לשורה בלי סיבה ומזיזה את `updated_at` של חצי מהמחירון.
 */
export function dependentPriceUpdates(items, anchor) {
  if (!anchor?.id) return [];
  const updates = [];
  for (const item of items || []) {
    if (String(item?.price_anchor_id || '') !== String(anchor.id)) continue;
    const price = computeAnchoredPrice(item, anchor);
    if (price == null || money(item.price) === price) continue;
    updates.push({ id: item.id, name: item.name, from: money(item.price), price });
  }
  return updates;
}

/**
 * בדיקת תקינות לפני שמירה. מחזיר הודעה בעברית או null.
 *
 * העוגן חייב להיות פריט שסומן ככזה: בלי זה כל מוצר במחירון היה יכול להיות
 * בסיס של מוצר אחר בטעות, ושינוי מחיר של קיוסק היה מזיז כרטיסיות.
 */
export function validateAnchorLink(item, anchor) {
  if (!item?.price_anchor_id) return null;
  if (!anchor) return 'פריט העוגן לא נמצא במחירון';
  if (String(anchor.id) === String(item.id)) return 'פריט לא יכול להיות העוגן של עצמו';
  if (!isPriceAnchor(anchor)) return `„${anchor.name || 'הפריט'}” אינו מסומן כפריט עוגן`;
  if (anchor.price_anchor_id) return 'פריט עוגן לא יכול להישען בעצמו על עוגן אחר';
  if (anchorUnitsOf(item) == null) {
    return normalizeProductType(item) === PRODUCT_TYPES.PUNCH_CARD
      ? 'לכרטיסייה צריך מספר כניסות כדי לגזור מחיר מהעוגן'
      : 'צריך להגדיר לכמה יחידות עוגן הפריט שווה';
  }
  return null;
}

/**
 * עוגן שמסירים ממנו את הסימון בזמן שפריטים נשענים עליו משאיר אותם עם מחיר
 * שאין לו מקור. עדיף לעצור את השמירה מאשר לגלות את זה בקופה.
 */
export function anchorInUseBy(items, anchorId) {
  return (items || []).filter((item) => String(item?.price_anchor_id || '') === String(anchorId));
}
