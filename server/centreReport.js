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

/**
 * Words the centre types around a name that are not part of it.
 *
 * „אלימלך קרני נרשם” was looked up whole, verb included, and came back as a
 * child we do not have. „הוא נרשם במתנס” was looked up as though it were
 * somebody's name.
 */
const REPORT_NOISE = new Set([
  'נרשם', 'נרשמה', 'נרשמו', 'נרשמת', 'רשום', 'רשומה', 'רשומים', 'הרשמה',
  'שילם', 'שילמה', 'שולם', 'אושר', 'אושרה', 'אישור', 'הושלמה', 'הושלם',
  // «שלום» and «תודה» are missing on purpose: a child may be called שלום, and
  // a message that is only a greeting is recognised as one before we get here.
  'הוא', 'היא', 'הם', 'כבר', 'גם', 'אצלנו', 'אצלכם',
  'במתנס', 'במתנ״ס', 'במתנ"ס', 'מתנס', 'מתנ״ס', 'מתנ"ס', 'לחוג', 'לקבוצה',
]);

/** The words of a name, with the reporting verbs around it removed. */
export function centreNameTokens(text) {
  return normalizedName(text)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !REPORT_NOISE.has(word));
}

/**
 * The trainees a typed name can mean.
 *
 * Order is not fixed — the centre writes „יאירי נטע” as readily as „נטע
 * יאירי” — so the words are compared as a set. What is fixed is that every
 * word typed has to appear in the trainee's name: matching on a fragment used
 * to return four children called יאיר for a message about נטע יאירי, and the
 * list offered to the team named none of them properly.
 */
export function findStudentsByName(students, name) {
  const wanted = centreNameTokens(name);
  if (!wanted.length || wanted.join(' ').length < 2) return [];
  const exact = students.filter((s) => normalizedName(s.name) === wanted.join(' '));
  if (exact.length) return exact;
  return students.filter((s) => {
    const candidate = new Set(centreNameTokens(s.name));
    if (!candidate.size) return false;
    return wanted.every((word) => candidate.has(word));
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
 * The trainee's first training day of the season, when the season has not
 * started yet. Null once it has: from then on the register is the only thing
 * allowed to say when a child began, because it is the only thing that knows.
 *
 * @param {string} seasonStart ISO date the classes open on
 * @param {string} today ISO date
 */
export function seasonOpeningSession(student, groups = [], { seasonStart = '', today = '' } = {}) {
  const start = String(seasonStart || '').slice(0, 10);
  const now = String(today || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(now)) return null;
  if (now >= start) return null;

  const wanted = new Set(studentGroupIds(student));
  const weekdays = new Set((groups || [])
    .filter((group) => wanted.has(String(group.id)))
    .flatMap((group) => getSortedGroupDays(group))
    .filter((day) => Number.isInteger(day)));
  if (!weekdays.size) return null;

  // The first of those weekdays on or after the day the season opens.
  const opening = new Date(`${start}T12:00:00Z`);
  for (let step = 0; step < 7; step += 1) {
    if (weekdays.has(opening.getUTCDay())) return opening.toISOString().slice(0, 10);
    opening.setUTCDate(opening.getUTCDate() + 1);
  }
  return null;
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
export function buildCentreReport({
  students = [],
  attendance = [],
  groups = [],
  introBookings = [],
  name = '',
  seasonStart = '',
  today = '',
} = {}) {
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
    // Before the season opens nobody has attendance, and „אין לי תאריך חיוב”
    // was the answer to every name the centre sent in August. The date is
    // knowable without a register: it is the group's first training day of the
    // season, and a child starting on it is charged the month in full.
    const opening = seasonOpeningSession(student, groups, { seasonStart, today });
    if (opening) {
      const denominator = billingDenominator(student, groups);
      return {
        ok: true,
        student,
        date: opening,
        beforeSeason: true,
        billing: denominator ? { numerator: denominator, denominator, paidIntros: 0, label: 'חודש מלא' } : null,
        reply: `${student.name} — האימונים טרם התחילו. האימון הראשון ${formatReportDate(opening)}, `
          + 'ולכן החודש מחויב במלואו.',
      };
    }
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
