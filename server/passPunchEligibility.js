/**
 * מי מותר לנקב לו כרטיסייה.
 *
 * הניקוב נעשה ידנית בדלפק — אין שער שנפתח בעקבותיו. הוא הרגע שבו הכניסה
 * נגבית, ולכן הוא חסום למי שאין לו הצהרת בריאות והסרת אחריות בתוקף: על אלה
 * חותמים לפני שנכנסים, ואי אפשר לגבות כניסה ממי שלא חתם.
 *
 * מבחן האבטחה **אינו** חוסם ניקוב, אף שהוא נדרש לטיפוס. סדר היום בקיר הוא
 * שהמתאמן נכנס, מנקב, ורק אז יוצא עם המדריך לתדריך ולמבחן — חסימה כאן הייתה
 * מונעת את הניקוב בדיוק ברגע שבו עוד לא ייתכן שיהיה לו מבחן. הוא מוחזר
 * כהערה (`passPunchSafetyNote`) שהדלפק מציג, כדי שאפשר יהיה לראות מי עוד לא
 * עשה אותו בלי לעצור את התור.
 *
 * הצהרת הבריאות והסרת האחריות הן טופס אחד עם חתימה אחת, ולכן נבדק כאן
 * תאריך חתימה אחד ולא שניים.
 */

import { declarationSignedAt, isHealthDeclarationValid } from './healthValidity.js';
import { safetyTestStatus } from './safetyTestService.js';
import { participationEligibility } from './participationEligibility.js';

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
  {
    student,
    declarations = [],
    waivers = [],
    healthHolds = [],
  } = {},
  refDate = new Date()
) {
  if (!student) return 'הכרטיסייה לא משויכת למתאמן — אי אפשר לנקב';

  const documentDb = {
    get(table) {
      if (table === 'health_declarations') return declarations;
      if (table === 'participation_waivers') return waivers;
      if (table === 'health_holds') return healthHolds;
      return [];
    },
  };
  const eligibility = participationEligibility(documentDb, {
    studentId: student.id,
    scope: 'wall',
    now: refDate,
  });

  // חסימה רפואית נשארת נפרדת: אותה לא פותרים בחתימה על טופס, ומשפט שאומר
  // „לחתום” היה שולח את הדלפק לשלוח קישור שלא יסיר את החסימה.
  if (eligibility.health.state === 'blocked') {
    return 'קיימת חסימה רפואית — לא ניתן להכניס עד למילוי הצהרה חדשה';
  }

  // כל השאר הוא אותו מחסום אחד ואותה פעולה אחת: לחתום. אילו מסמכים חסרים
  // ומתי פגו אינו משנה למי שעומד בדלפק — הוא רק מאריך משפט שצריך להיקרא
  // בשנייה, ומופיע ממילא בתווית שליד.
  if (eligibility.health.state !== 'valid' || eligibility.waiver.state !== 'valid') {
    return 'לא ניתן להכניס לפני חתימה על אישור השתתפות';
  }
  return null;
}

/**
 * אותה תשובה בדיוק, בגרסה קצרה לתווית ברשימה.
 *
 * מסך הכניסה חישב את הסטטוס הרפואי בעצמו לפי כלל רופף יותר — התאמה לפי שם
 * ולא לפי מזהה, וסטטוס "רשום" שנחשב כחתימה — ולכן הציג «תקין» ירוק בדיוק
 * למי שהניקוב שלו נדחה. תווית וגייט חייבים לענות על אותה שאלה.
 *
 * @returns {{state:'valid'|'expired'|'missing'|'blocked', ok:boolean, label:string}}
 */
export function wallDocumentsStatus(
  { student, declarations = [], waivers = [], healthHolds = [] } = {},
  refDate = new Date()
) {
  if (!student) return { state: 'missing', ok: false, label: 'אין מתאמן' };
  const documentDb = {
    get(table) {
      if (table === 'health_declarations') return declarations;
      if (table === 'participation_waivers') return waivers;
      if (table === 'health_holds') return healthHolds;
      return [];
    },
  };
  const { health, waiver } = participationEligibility(documentDb, {
    studentId: student.id,
    scope: 'wall',
    now: refDate,
  });
  if (health.state === 'blocked') return { state: 'blocked', ok: false, label: 'חסימה רפואית' };
  if (health.state === 'missing') return { state: 'missing', ok: false, label: 'אין הצהרת בריאות' };
  if (health.state === 'expired') return { state: 'expired', ok: false, label: 'הצהרת בריאות פגה' };
  if (waiver.state === 'missing') return { state: 'missing', ok: false, label: 'אין אישור קיר' };
  if (waiver.state === 'expired') return { state: 'expired', ok: false, label: 'אישור הקיר פג' };
  return { state: 'valid', ok: true, label: 'תקין' };
}

/**
 * מה שהדלפק צריך לדעת על המתאמן הזה בלי שזה יעצור את הניקוב.
 *
 * מבחן אבטחה חסר אינו סיבה לא לגבות את הכניסה — הוא סיבה לא לתת לו לטפס עד
 * שיעבור אותו עם מדריך. ההבחנה הזאת היא כל ההבדל בין הודעה שהצוות פועל לפיה
 * לבין הודעה שהוא לומד לעקוף.
 *
 * @returns {string|null}
 */
export function passPunchSafetyNote({ student, tests = [] } = {}, refDate = new Date()) {
  if (!student) return null;
  const safety = safetyTestStatus(testsForStudent(student, tests), refDate);
  const name = String(student.name || '').trim() || 'המתאמן';
  if (safety.state === 'missing') return `ל${name} אין עדיין מבחן אבטחה — לטיפוס רק אחרי תדריך ומבחן עם מדריך`;
  if (safety.state === 'expired') {
    return `מבחן האבטחה של ${name} פג תוקף (${formatDay(safety.expires_at)}) — נדרש מבחן מחדש לפני טיפוס`;
  }
  return null;
}
