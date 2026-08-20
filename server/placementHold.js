/**
 * שיבוץ שתופס מקום, ולזמן קצוב.
 *
 * עד היום שיבוץ „ממתין להרשמה” לא תפס מקום בקבוצה, כדי שהמתנה לאישור המתנ״ס
 * לא תחסום אחרים. המחיר היה הפוך: המשכנו להציע קבוצה שבפועל כבר מלאה, ואחר כך
 * נאלצנו לומר לאנשים שאין מקום — אחרי ששלחנו אותם להירשם.
 *
 * לכן שיבוץ תופס מקום מהרגע הראשון, אבל רק לשלושה ימים. ההורה יודע שהמקום שמור
 * ושצריך להשלים הרשמה במתנ״ס ולעדכן; ברגע שהוא מעדכן, ההחזקה הופכת לקבועה
 * ומחכה רק לאישור המתנ״ס. מי שלא עדכן — המקום משתחרר מעצמו ולא נשאר תפוס
 * לנצח על סמך שיחה מלפני חודש.
 *
 * ## פעמיים בשבוע
 *
 * בכיתות ה'-ו' „פעמיים בשבוע” הוא יום א' *וגם* יום ד' — שתי קבוצות נפרדות,
 * שכל אחת מהן מוכרת גם את המנוי הכפול. בכרטיס המתאמן יש שדה קבוצה אחד, ולכן
 * מי שביקש ראשון ורביעי נשמר על יום אחד: המדריך של היום השני לא ידע עליו, ולא
 * הייתה לו נוכחות שם. השיבוץ תופס עכשיו את שני הימים.
 */

export const HOLD_DAYS = 3;

export const TWICE_WEEKLY = 'פעמיים בשבוע';

export function holdExpiryFrom(now = new Date(), days = HOLD_DAYS) {
  const at = new Date(now);
  at.setDate(at.getDate() + days);
  return at.toISOString();
}

/**
 * האם ההחזקה עדיין חיה.
 *
 * שיבוץ שנשמר לפני שהיה שדה תפוגה נחשב מוחזק — הוא שיבוץ אמיתי שממתין
 * להרשמה, ולא נכון לשחרר אותו רק משום שנוצר לפני השינוי.
 */
export function holdIsLive(student, now = new Date()) {
  const until = String(student?.placement_hold_until || '').trim();
  if (!until) return true;
  return new Date(until).getTime() > new Date(now).getTime();
}

/** מי שכבר מסר שנרשם — ההחזקה שלו אינה פגה יותר. */
export function holdIsFirm(student) {
  return student?.placement_hold_firm === true;
}

/**
 * הקבוצה השנייה של מנוי פעמיים בשבוע.
 *
 * הזוג מזוהה לפי מה שמשותף לו באמת: אותה שכבת גיל, אותה שעה, ושתיהן מוכרות
 * מנוי כפול — ביום אחר. קבוצות שנמכרות רק פעם בשבוע (`priceTwice` אפס) לא
 * ייספרו כזוג גם אם השעה מקרית.
 */
export function pairedTwiceWeeklyGroup(groups = [], group) {
  if (!group?.id) return null;
  if (!(Number(group.priceTwice) > 0)) return null;
  const band = String(group.ageCategory || '').trim();
  const time = String(group.time || '').trim();
  if (!band || !time) return null;
  return (groups || []).find((other) => (
    String(other.id) !== String(group.id)
      && String(other.ageCategory || '').trim() === band
      && String(other.time || '').trim() === time
      && Number(other.priceTwice) > 0
      && String(other.day) !== String(group.day)
  )) || null;
}

/**
 * לאילו קבוצות המתאמן נכנס בפועל.
 *
 * פעם בשבוע — קבוצה אחת. פעמיים בשבוע בקבוצה שכבר נפגשת פעמיים (מתקדמים,
 * נבחרת) — גם כן אחת, כי היום השני כבר בתוכה. פעמיים בשבוע בקבוצה של יום
 * אחד — שתיים.
 */
export function groupsForFrequency(groups = [], group, frequency = '') {
  if (String(frequency || '').trim() !== TWICE_WEEKLY) return [group];
  const paired = pairedTwiceWeeklyGroup(groups, group);
  return paired ? [group, paired] : [group];
}

export const ONCE_WEEKLY = 'פעם בשבוע';

/**
 * יום שנאמר הוא תדירות שנבחרה.
 *
 * דריה כתבה „יום א'”, והבוט שאל אותה אם היא רוצה פעם או פעמיים בשבוע במקום
 * לשלוח לה את הקישור. אבל פעמיים בשבוע הן *שני* ימים — מי שנוקב ביום אחד כבר
 * ענה על השאלה. השאלה נשארת רק כשלא נאמר יום כלל.
 */
export function frequencyForRequest({ frequency = '', day = null, frequencies = [] } = {}) {
  const chosen = String(frequency || '').trim();
  if (chosen) return chosen;
  if (day === null || day === undefined || day === '') return '';
  return frequencies.includes(ONCE_WEEKLY) ? ONCE_WEEKLY : '';
}

/** מה שנאמר להורה: המקום שמור, וצריך לחזור אלינו. */
export function holdNoticeForCustomer({ days = HOLD_DAYS } = {}) {
  return `המקום שמור ל-${days} ימים עד להשלמת ההרשמה במתנ״ס. `
    + 'כשנרשמתם — עדכנו אותי כאן, ואשמור את המקום עד לאישור מהמתנ״ס.';
}

/**
 * מי שההחזקה שלו פגה ואיש לא דיווח.
 *
 * הסטטוס לא משתנה — המתאמן עדיין ממתין לאישור הרשמה, ומי שיסתכל בכרטיס יראה
 * בדיוק את זה. מה שמשתחרר הוא הכיסא: התפוגה כבר עשתה את זה מעצמה בספירה, וכאן
 * רק מסמנים שהצוות צריך לדעת, כדי שההחלטה מה לעשות תישאר של אדם.
 */
export function expiredHolds(students = [], now = new Date()) {
  return (students || []).filter((student) => {
    if (String(student?.status || '') !== 'awaiting_parent_confirmation') return false;
    if (holdIsFirm(student)) return false;
    if (student.placement_hold_released_at) return false;
    const until = String(student.placement_hold_until || '').trim();
    if (!until) return false;
    return new Date(until).getTime() <= new Date(now).getTime();
  });
}

/** מה שהצוות מקבל כשמקום משתחרר. */
export function releasedHoldNotice(rows = []) {
  const lines = rows.slice(0, 15).map((r) => `• ${r.name || 'מתאמן'} — ${r.groupLabel || ''}`);
  return [
    '⌛ מקומות שהשתחררו — שיבוץ שלא הושלם במתנ״ס',
    ...lines,
    rows.length > lines.length ? `ועוד ${rows.length - lines.length}…` : '',
    '← המקום כבר פנוי להצעה. הסטטוס נשאר «ממתין להרשמה» עד שתחליטו.',
  ].filter(Boolean).join('\n');
}
