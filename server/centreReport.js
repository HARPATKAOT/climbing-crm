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

import { normalizeAttStatus, isIntroAttStatus, getSortedGroupDays } from './attendanceUtils.js';
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

function studentGroupIds(student) {
  return [...new Set([
    ...(Array.isArray(student?.groupIds) ? student.groupIds : []),
    student?.groupId,
  ].map(String).filter(Boolean))];
}

/** Fixed monthly denominator: four for weekly, eight for twice-weekly. */
export function billingDenominator(student, groups = []) {
  const wanted = new Set(studentGroupIds(student));
  const selected = (groups || []).filter((group) => wanted.has(String(group.id)));
  if (!selected.length) return null;
  const weekdays = new Set(selected.flatMap((group) => getSortedGroupDays(group)));
  if (weekdays.size >= 2) return 8;
  if (weekdays.size === 1) return 4;
  return null;
}

export function paidIntroCountForMonth(introBookings = [], studentId, month) {
  return (introBookings || []).filter((booking) => (
    String(booking.student_id || '') === String(studentId)
    && String(booking.session_date || '').slice(0, 7) === String(month || '')
    && Boolean(booking.paid_at)
    && ['paid', 'scheduled', 'awaiting_decision', 'continued', 'expired', 'rescheduled', 'no_show'].includes(String(booking.status || ''))
  )).length;
}

export function centreBillingFraction({ student, firstBillable, groups = [], introBookings = [] } = {}) {
  if (!student?.id || !firstBillable) return null;
  const denominator = billingDenominator(student, groups);
  if (!denominator) return null;
  const paidIntros = paidIntroCountForMonth(introBookings, student.id, String(firstBillable).slice(0, 7));
  return {
    numerator: Math.max(0, denominator - paidIntros),
    denominator,
    paidIntros,
    label: `${Math.max(0, denominator - paidIntros)}/${denominator}`,
  };
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
export function buildCentreReport({ students = [], attendance = [], groups = [], introBookings = [], name = '' } = {}) {
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

  const billing = centreBillingFraction({ student, firstBillable, groups, introBookings });
  if (!billing) {
    return {
      ok: false,
      reason: 'missing_frequency',
      student,
      date: firstBillable,
      reply: `${student.name} — אימון ראשון ${formatReportDate(firstBillable)}. חסרה תדירות קבוצה מאומתת, ולכן העברתי לצוות את בדיקת החיוב.`,
    };
  }

  return {
    ok: true,
    student,
    date: firstBillable,
    billing,
    reply: [
      `${student.name} — אימון ראשון ${formatReportDate(firstBillable)}, לחייב את החודש לפי ${billing.label}.`,
      billing.paidIntros
        ? `${billing.paidIntros} אימוני היכרות ששולמו באותו חודש קוזזו, גם אם לא סומנה הגעה.`
        : 'לא נמצא אימון היכרות ששולם באותו חודש.',
      `נמצאו ${sessions} אימונים רגילים עד היום.`,
    ].join('\n'),
  };
}
