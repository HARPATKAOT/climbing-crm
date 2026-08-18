/**
 * אחוז הגעה, הברזות והחלפות — לכל עובד.
 *
 * שלוש הכרעות שקובעות אם המספר הזה הוגן:
 *
 * 1. **המכנה הוא רק מה שסומן.** מפגש שאיש לא סימן אינו הגעה ואינו הברזה — הוא
 *    חוסר מידע. אחרת שכחה של מדריך למלא גיליון נרשמת כהברזה של המתנדב, ואין לו
 *    שום דרך לתקן אותה.
 * 2. **החלפה נספרת בנפרד.** מי שלא הגיע אבל דאג שמישהו יגיע במקומו לא הפקיר את
 *    המשמרת. ספירה שלה כהברזה מלמדת אנשים פשוט לא להודיע.
 * 3. **חוגים ואירועים נספרים בנפרד.** מדריך חוג שבועי עובר כל סף כמותי מעצם
 *    היותו מדריך, ואז הדגל הכמותי שותק בדיוק על מי שהוא נועד לו.
 */

/** YYYY-MM של תאריך. */
function monthOf(date) {
  return String(date || '').slice(0, 7);
}

function blank() {
  return { marked: 0, present: 0, absent: 0, substituted: 0 };
}

function pctOf(bucket) {
  // המכנה הוא רק מה שסומן, והחלפה יוצאת ממנו: היא לא הגעה ולא הברזה.
  const judged = bucket.present + bucket.absent;
  if (!judged) return null;
  return Math.round((bucket.present / judged) * 1000) / 10;
}

/**
 * הרשומות של עובד אחד, מקובצות ומדוגלות.
 *
 * @param {object[]} rows שורות `staff_attendance` של אותו עובד.
 * @param {object} settings ספי הדגלים.
 * @param {string} today היום, לחישוב חלון החודשים.
 */
export function staffReliability(rows = [], settings = {}, today = '') {
  const {
    reliability_min_pct: minPct = 80,
    reliability_min_marked: minMarked = 4,
    volume_min_events_per_month: minEvents = 2,
    volume_window_months: windowMonths = 3,
  } = settings;

  const total = blank();
  const classes = blank();
  const events = blank();
  const perMonth = new Map();

  for (const row of rows) {
    if (!row?.date) continue;
    const status = row.status;
    if (!['present', 'absent', 'substituted'].includes(status)) continue;
    const bucket = row.group_id ? classes : events;
    for (const target of [bucket, total]) {
      target.marked += 1;
      target[status] += 1;
    }
    if (status === 'present' && !row.group_id) {
      const key = monthOf(row.date);
      perMonth.set(key, (perMonth.get(key) || 0) + 1);
    }
  }

  // חלון החודשים נספר אחורה מהיום, כולל חודשים ריקים — חודש בלי אף אירוע הוא
  // בדיוק מה שהדגל מחפש, ודילוג עליו היה מעלים אותו מהממוצע.
  const months = [];
  const cursor = today ? new Date(`${monthOf(today)}-01T12:00:00Z`) : null;
  if (cursor) {
    for (let i = 0; i < windowMonths; i += 1) {
      const key = cursor.toISOString().slice(0, 7);
      months.push({ ym: key, count: perMonth.get(key) || 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
    months.reverse();
  }
  const monthlyAverage = months.length
    ? Math.round((months.reduce((sum, m) => sum + m.count, 0) / months.length) * 10) / 10
    : 0;

  const attendancePct = pctOf(total);
  return {
    total: { ...total, attendance_pct: attendancePct },
    classes: { ...classes, attendance_pct: pctOf(classes) },
    events: { ...events, attendance_pct: pctOf(events) },
    per_month: months,
    monthly_average: monthlyAverage,
    flags: {
      // מתחת למינימום הסימונים אין דפוס, רק רעש — ולכן אין דגל.
      reliability: attendancePct !== null
        && total.marked >= minMarked
        && attendancePct < minPct,
      // הכמות נמדדת באירועים בלבד, ורק כשהיה בכלל חלון להשוות אליו.
      volume: months.length > 0 && monthlyAverage < minEvents,
    },
    thresholds: {
      reliability_min_pct: minPct,
      reliability_min_marked: minMarked,
      volume_min_events_per_month: minEvents,
      volume_window_months: windowMonths,
    },
  };
}
