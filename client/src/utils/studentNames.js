/**
 * שם המשפחה של המתאמן יושב על ההורה ולא עליו — בטפסים נרשם שם פרטי
 * בלבד לילד. הפונקציות כאן מחברות ביניהם לתצוגה, בלי לשנות נתונים.
 */

/** שם המשפחה כפי שהוא מופיע על ההורה. */
export function familyNameOf(parent) {
  const stored = String(parent?.lastName || '').trim();
  if (stored) return stored;
  const parts = String(parent?.name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * שם מלא לתצוגה. אם בשם המתאמן כבר יש יותר ממילה אחת מניחים ששם
 * המשפחה כלול בו, ולא מוסיפים שוב.
 */
export function studentDisplayName(student, parent) {
  const name = String(student?.name || '').trim();
  if (!name) return '';
  if (name.split(/\s+/).filter(Boolean).length > 1) return name;
  const family = familyNameOf(parent);
  return family ? `${name} ${family}` : name;
}
