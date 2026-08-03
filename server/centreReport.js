/**
 * הדיווח למתנ״ס: ממתי הילד מתאמן, לצורך חיוב.
 *
 * זה תהליך קבוע. כרמית מהמתנ״ס כותבת שם של ילד שנרשם — „יונתן כהן” — ומישהו
 * אצלנו פותח את הנוכחות, מוצא ממתי הוא באמת מתאמן, מדווח לה, ומעדכן אצלנו
 * שהילד רשום. שלושה שלבים שאיש לא זוכר לעשות באותו יום.
 *
 * ## מה נחשב האימון הראשון
 *
 * אימון ההיכרות שולם בנפרד ולכן אינו נספר בחיוב. הנוכחות כבר יודעת את זה
 * בעצמה: שורת היכרות נשמרת בסטטוס משלה (`intro_attended`), שנקבע כשהשורה
 * נוצרת ולא נגזר מהסטטוס הנוכחי של הילד. לכן „האימון הראשון לחיוב” הוא פשוט
 * ההגעה המוקדמת ביותר שאיננה שורת היכרות — בלי לנחש ובלי לספור אחורה.
 *
 * ## מה הבוט לא עושה לבד
 *
 * שם שמתאים לשני ילדים, שם שלא נמצא, או ילד שעדיין לא סומנה לו נוכחות —
 * שלושתם עוברים לצוות עם הסיבה. דיווח שגוי למתנ״ס הוא חיוב שגוי למשפחה.
 */

import { normalizeAttStatus, isIntroAttStatus } from './attendanceUtils.js';
import { normalizedName } from './activityInterest.js';

/** Attendance marks that mean the trainee actually climbed that day. */
const ARRIVED = new Set(['attended', 'makeup', 'saturday_makeup']);

export function attendanceCounts(status) {
  const normalized = normalizeAttStatus(status);
  return ARRIVED.has(normalized) && !isIntroAttStatus(normalized);
}

/** Loose match on a name the community centre typed, against the trainees. */
export function findStudentsByName(students, name) {
  const wanted = normalizedName(name);
  if (wanted.length < 2) return [];
  const exact = students.filter((s) => normalizedName(s.name) === wanted);
  if (exact.length) return exact;
  return students.filter((s) => {
    const candidate = normalizedName(s.name);
    return candidate.includes(wanted) || wanted.includes(candidate);
  });
}

/**
 * The first session that counts for billing, and the intro that preceded it.
 * @returns {{ firstBillable: string|null, introDate: string|null, sessions: number }}
 */
export function firstBillableSession(attendance, studentId) {
  const rows = (attendance || [])
    .filter((row) => String(row.student_id || row.studentId || '') === String(studentId))
    .filter((row) => row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const billable = rows.filter((row) => attendanceCounts(row.status));
  const intro = rows.find((row) => isIntroAttStatus(normalizeAttStatus(row.status)));

  return {
    firstBillable: billable[0]?.date || null,
    introDate: intro?.date || null,
    sessions: billable.length,
  };
}

/** dd.mm.yyyy — how a date is written to somebody outside the system. */
export function formatReportDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1]}` : String(dateStr || '');
}

/**
 * The whole answer to one name, decided before anything is sent or changed.
 *
 * Separated from the sending so it can be tested against real data and read in
 * one sitting: every branch here ends either in a report or in a reason the
 * team has to look.
 *
 * @returns {{ ok: boolean, reply: string, student?: object, date?: string, reason?: string }}
 */
export function buildCentreReport({ students = [], attendance = [], name = '' } = {}) {
  const typed = String(name || '').trim();
  if (typed.length < 2) {
    return { ok: false, reason: 'no_name', reply: 'אפשר לכתוב את שם הילד/ה ואבדוק ממתי הוא מתאמן 🙂' };
  }

  const matches = findStudentsByName(students, typed);
  if (!matches.length) {
    return {
      ok: false,
      reason: 'not_found',
      reply: `לא מצאתי אצלנו מתאמן בשם ${typed} 🙏\nהעברתי לצוות שיבדוק ויחזור אלייך.`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      reply: `יש לנו יותר ממתאמן אחד בשם ${typed}:\n`
        + matches.map((s) => `• ${s.name}`).join('\n')
        + '\nהעברתי לצוות כדי לוודא על מי מדובר.',
    };
  }

  const student = matches[0];
  const { firstBillable, introDate, sessions } = firstBillableSession(attendance, student.id);
  if (!firstBillable) {
    return {
      ok: false,
      reason: 'no_attendance',
      student,
      reply: `${student.name} עדיין לא סומנה לו נוכחות באימון רגיל אצלנו 🙏\n`
        + (introDate ? `יש רק אימון היכרות (${formatReportDate(introDate)}), והוא שולם בנפרד.\n` : '')
        + 'העברתי לצוות שיבדוק ויחזור אלייך.',
    };
  }

  return {
    ok: true,
    student,
    date: firstBillable,
    reply: [
      `${student.name} מתאמן/ת אצלנו מ-${formatReportDate(firstBillable)} 🧗`,
      introDate
        ? `(אימון ההיכרות ב-${formatReportDate(introDate)} שולם בנפרד ואינו נכלל בחיוב)`
        : '(ללא אימון היכרות קודם)',
      `סה״כ ${sessions} אימונים עד היום.`,
    ].join('\n'),
  };
}
