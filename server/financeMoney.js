/**
 * כסף במרכז הפיננסי נשמר באגורות — מספר שלם, אף פעם לא float.
 *
 * שאר המערכת (payments, pos_sales, finance_documents) שומרת שקלים בנקודה
 * צפה מעוגלת ל-2 ספרות. אסור לשנות אותה (FINANCE_SPEC כלל 9), ולכן ההמרה
 * חיה כאן, בגבול: כל קריאה מהטבלאות הישנות עוברת דרך toAgorot, וכל תצוגה
 * חזרה דרך toShekels. בתוך סכמת finance_* אין המרות ואין עיגולים.
 */

import { VAT_RATE } from './vat.js';

/** שקלים (float של המערכת הישנה) → אגורות שלמות. */
export function toAgorot(shekels) {
  const value = Number(shekels);
  if (!Number.isFinite(value)) {
    throw new Error(`סכום לא תקין להמרה לאגורות: ${shekels}`);
  }
  return Math.round(value * 100);
}

/** אגורות → שקלים, לתצוגה ולכתיבה חזרה לטבלאות הישנות בלבד. */
export function toShekels(agorot) {
  assertAgorot(agorot);
  return agorot / 100;
}

/** מוודא שסכום הוא אגורות שלמות. זריקה מוקדמת עדיפה על ספר חשבונות מזוהם. */
export function assertAgorot(value, label = 'סכום') {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} חייב להיות אגורות שלמות, התקבל: ${value}`);
  }
  return value;
}

/**
 * פירוק סכום ברוטו לנטו ומע״מ, הכול באגורות שלמות.
 * הנטו מעוגל; המע״מ הוא ההפרש — כך net + vat == gross תמיד, בלי אגורה
 * שהולכת לאיבוד בעיגול כפול.
 */
export function splitGrossAgorot(grossAgorot, rate = VAT_RATE) {
  assertAgorot(grossAgorot, 'ברוטו');
  const net = Math.round(grossAgorot / (1 + rate));
  return { gross: grossAgorot, net, vat: grossAgorot - net };
}

/** סכימה בטוחה: מפילה float אחד שהתגנב במקום לזהם את הסכום כולו. */
export function sumAgorot(values = []) {
  let total = 0;
  for (const value of values) total += assertAgorot(value);
  return total;
}

/** עיצוב לתצוגה עברית: 1234567 אגורות → "12,345.67". בלי סימן ₪ — הוא ב-UI. */
export function formatAgorot(agorot) {
  assertAgorot(agorot);
  return (agorot / 100).toLocaleString('he-IL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
