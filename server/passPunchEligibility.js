/**
 * מי מותר לנקב לו כרטיסייה.
 *
 * הניקוב נעשה ידנית בדלפק — אין שער שנפתח בעקבותיו. הוא הרגע שבו מישהו
 * מהצוות מאשר למתאמן לטפס, ולכן הוא חסום למי שאין לו הצהרת בריאות והסרת
 * אחריות בתוקף, או שאין לו מבחן אבטחה בתוקף. שתי הבדיקות נדרשות יחד.
 *
 * הצהרת הבריאות והסרת האחריות הן טופס אחד עם חתימה אחת, ולכן נבדק כאן
 * תאריך חתימה אחד ולא שניים.
 */

import { declarationSignedAt, isHealthDeclarationValid } from './healthValidity.js';
import { safetyTestStatus } from './safetyTestService.js';

function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
}

/** ההצהרות של המתאמן: לפי מזהה, ובהיעדרו לפי שם המטפס בתיק אותו הורה. */
export function declarationsForStudent(student, declarations = []) {
  if (!student) return [];
  return (Array.isArray(declarations) ? declarations : []).filter((declaration) => {
    if (declaration?.studentId || declaration?.student_id) {
      return String(declaration.studentId || declaration.student_id) === String(student.id);
    }
    if (!student.parentId || String(declaration?.parentId || '') !== String(student.parentId)) {
      return false;
    }
    const name = normalizedName(declaration?.climberName || declaration?.studentName);
    return !!name && name === normalizedName(student.name);
  });
}

/**
 * מצב ההצהרה של מתאמן.
 *
 * חתימה בלי תאריך אינה נחשבת כאן. במקומות אחרים תאריך חסר נקרא לטובת
 * המתאמן כדי לא לסמן רשומות ישנות בטעות; בבדיקה שחוסמת ניקוב הוותרנות
 * הזאת הייתה מכשירה חתימה שאיש לא יודע מתי ניתנה — או אם ניתנה בכלל.
 *
 * @returns {{state:'valid'|'expired'|'missing', signed_at:string|null}}
 */
export function healthDeclarationState(student, declarations = [], now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  const dates = [
    ...declarationsForStudent(student, declarations)
      // הצהרה שנדחתה אינה חתימה, וכך גם טיוטה שאיש לא אישר. הסימנים
      // לאישור מגיעים בכמה צורות — רשומות ישנות נושאות רק חלק מהם.
      .filter((declaration) => declaration?.status !== 'rejected' && (
        declaration?.signed
        || declaration?.status === 'approved'
        || declaration?.waiverAccepted === true
        || !!declaration?.signature_url
      ))
      .map((declaration) => declarationSignedAt(declaration)),
    student?.healthSignedAt || null,
  ]
    .filter(Boolean)
    .map((value) => String(value))
    .sort((a, b) => b.localeCompare(a));

  if (dates.length === 0) return { state: 'missing', signed_at: null };
  const valid = dates.find((date) => isHealthDeclarationValid(date, at));
  return valid
    ? { state: 'valid', signed_at: valid }
    : { state: 'expired', signed_at: dates[0] };
}

/** מבחני הרמה של המתאמן — הטבלה מחזיקה כמה שמות שדה למזהה. */
export function testsForStudent(student, tests = []) {
  if (!student) return [];
  return (Array.isArray(tests) ? tests : []).filter(
    (test) => String(test?.studentId || test?.student_id || test?.climber_id || '') === String(student.id)
  );
}

function formatDay(iso) {
  const raw = String(iso || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : raw;
}

/**
 * הסיבה שאסור לנקב למתאמן הזה, או null אם מותר.
 *
 * @returns {string|null}
 */
export function passPunchBlockReason(
  { student, declarations = [], tests = [] } = {},
  refDate = new Date()
) {
  if (!student) return 'הכרטיסייה לא משויכת למתאמן — אי אפשר לנקב';

  const health = healthDeclarationState(student, declarations, refDate);
  const safety = safetyTestStatus(testsForStudent(student, tests), refDate);

  const missing = [];
  if (health.state === 'missing') missing.push('לא נחתמה הצהרת בריאות והסרת אחריות');
  else if (health.state === 'expired') {
    missing.push(`הצהרת הבריאות פגה (נחתמה ב-${formatDay(health.signed_at)})`);
  }
  if (safety.state === 'missing') missing.push('אין מבחן אבטחה');
  else if (safety.state === 'expired') {
    missing.push(`מבחן האבטחה פג תוקף (${formatDay(safety.expires_at)})`);
  }
  if (missing.length === 0) return null;

  const name = String(student.name || '').trim() || 'המתאמן';
  return `אי אפשר לנקב ל${name}: ${missing.join(' · ')}. יש להשלים לפני הטיפוס.`;
}
