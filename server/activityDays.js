/**
 * הימים של אירוע, ומי נרשם לאילו מהם.
 *
 * אירוע רב-יומי הוא שורה אחת עם תאריך התחלה וסיום; הימים עצמם נגזרים בזמן
 * קריאה (`activityDateRange`). עד כאן הרשמה הייתה תמיד לכל הימים, כי לא היה
 * שדה שיאמר אחרת — קייטנה של חמישה ימים ייצרה חמישה תאי נוכחות לכל ילד, גם
 * למי שבא ליומיים.
 *
 * `attending_dates` על ההרשמה סוגר את זה: מערך תאריכים, או `null` שפירושו
 * „כל האירוע". הייצוג היחיד הזה ל„הכול" הוא מכוון — בלעדיו אותה הרשמה הייתה
 * יכולה להיות מיוצגת גם כ-null וגם כרשימה מלאה, ושתי בדיקות שוויון היו
 * מחזירות תשובות שונות על אותו דבר.
 */

import { activityDateRange } from './attendanceUtils.js';

/** כל ימי האירוע, לפי תאריך התחלה וסיום. */
export function activityDayList(activity) {
  return activityDateRange(activity);
}

/**
 * האם האירוע מציע הרשמה ליום בודד.
 *
 * הדגל לבדו אינו מספיק: אירוע חד-יומי לעולם לא יציע „ימים בודדים", גם אם
 * הדגל נשאר דלוק מאירוע שנערך והתקצר ליום אחד.
 */
export function singleDayEnabled(activity) {
  return activity?.allow_single_day === true && activityDayList(activity).length > 1;
}

export function singleDayPrice(activity) {
  return Math.max(0, Number(activity?.single_day_price) || 0);
}

/**
 * מנקה בחירת ימים מול ימי האירוע בפועל.
 *
 * מחזיר `null` כשאין בחירה, כשהיא מכסה את כל הימים, או כשהאירוע אינו מציע
 * ימים בודדים — בכל אלה המשמעות זהה: ההרשמה היא לכל האירוע.
 * זורק כשנבחרו רק תאריכים שאינם מימי האירוע, כי בקשה כזאת היא באג בצד הקורא
 * ולא בחירה לגיטימית, ולחייב עליה בשקט יהיה גרוע יותר.
 */
export function normalizeAttendingDates(activity, dates) {
  if (!singleDayEnabled(activity)) return null;
  if (!Array.isArray(dates) || !dates.length) return null;

  const all = activityDayList(activity);
  const allowed = new Set(all);
  const picked = [...new Set(
    dates
      .map((value) => String(value || '').slice(0, 10))
      .filter((value) => allowed.has(value))
  )].sort();

  if (!picked.length) {
    throw Object.assign(
      new Error('הימים שנבחרו אינם מימי האירוע'),
      { status: 400 }
    );
  }
  return picked.length === all.length ? null : picked;
}

/** אילו ימים ההרשמה מכסה בפועל. */
export function registrationDays(activity, registration) {
  const all = activityDayList(activity);
  const picked = registration?.attending_dates;
  if (!Array.isArray(picked) || !picked.length) return all;
  const chosen = new Set(picked.map((value) => String(value || '').slice(0, 10)));
  const filtered = all.filter((date) => chosen.has(date));
  // בחירה ששום יום בה אינו בטווח (אירוע שהתאריכים שלו שונו אחרי ההרשמה)
  // נופלת לכל הימים במקום להשאיר משתתף בלי אף יום נוכחות.
  return filtered.length ? filtered : all;
}

/** האם ההרשמה מכסה יום מסוים. */
export function registrationCoversDate(activity, registration, date) {
  return registrationDays(activity, registration).includes(String(date || '').slice(0, 10));
}

/** האם זו הרשמה חלקית — לחלק מימי האירוע בלבד. */
export function isPartialRegistration(activity, registration) {
  return registrationDays(activity, registration).length < activityDayList(activity).length;
}

/**
 * המחיר למשתתף אחד: מחיר האירוע המלא, או מחיר יום כפול מספר הימים שנבחרו.
 * מוחזר לפני מע״מ — הוספת המע״מ נעשית במקום אחד, בשירות ההרשמה.
 */
export function participantPrice(activity, attendingDates) {
  if (!attendingDates || !attendingDates.length) {
    return Math.max(0, Number(activity?.price) || 0);
  }
  return singleDayPrice(activity) * attendingDates.length;
}
