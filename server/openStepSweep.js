/**
 * מעבר יומי על המתאמנים, ולא על השיחות.
 *
 * הבוט רדף עד היום אחרי שיחות: הוא שלח טופס, קבע לעצמו תזכורת, וחזר. מי
 * שנתקע בלי לדבר איתו — נרשם בדלפק, מילא טופס ולא המשיך, שובץ ולא נרשם
 * במתנ״ס — לא היה בשום תור, ואיש לא פנה אליו לעולם.
 *
 * המעבר הזה מוצא אותם. הוא אינו שולח דבר בעצמו: הוא פותח שורת מעקב, ומי
 * ששולח הוא אותו מנגנון שכבר יודע לכבד השהיה, הסרה מדיוור, אדם שמטפל, חלון
 * 24 השעות ותבנית מאושרת. שורה אחת פחות לתחזק, וכל ההגנות מגיעות בחינם.
 *
 * ## על מי לא עוברים
 *
 * מי שממתין *לנו* אינו „פתוח אצלו”: רשימת המתנה, אימון היכרות ששולם, ודיווח
 * שכבר נמסר וממתין לאישור המתנ״ס. גם מתעניין שטרם מילא טופס אינו כאן — פנייה
 * אליו היא שיווק, לא שירות, ויש לזה מסך אחר.
 */

import { israelDateStr } from './attendanceUtils.js';
import {
  FOLLOWUP_COLLECTION,
  FOLLOWUP_OPEN,
  newFollowUpId,
} from './botFollowUps.js';
import {
  hasLiveGroup,
  holdIsCounting,
  registrationStep,
  STEP_FOLLOWUP_REASON,
} from './registrationSteps.js';
import { outreachPausedUntil } from './botOutreachPause.js';
import { isOptedOut } from './whatsappBot.js';

/** הסטטוסים שבהם הכדור אצל הלקוח. */
export const SWEEPABLE_STATUSES = new Set([
  'details_completed',
  'health_signed',
  'pending_signup',
  'awaiting_parent_confirmation',
  'registered',
]);

/**
 * האם המתאמן בכלל בתוך תהליך של חוג.
 *
 * הריצה היבשה הראשונה מצאה 47 משפחות, ומתוכן 23 היו „טופס חתום בלי קבוצה” —
 * כולן אנשים שבאו לטפס פעם אחת וחתמו על הוויתור בדלפק. הם לא ביקשו חוג
 * מעולם, ו„יש לכם טופס חתום אבל אין קבוצה, איזה יום נוח?” הוא פרסום לאדם
 * שלא ביקש כלום — בדיוק מה שהמעבר הזה לא אמור להיות.
 *
 * הסימן היחיד שמחזיק הוא קבוצה: שיבוץ, רישום פעיל או שמירת מקום. חתימה על
 * טופס אינה מעידה על כלום, וגם שורת ציוד לא — הן קיימות אצל מאות אנשים
 * מהייבוא ההיסטורי. המשמעות: „טופס חתום בלי קבוצה” אינו מקרה שאפשר לזהות
 * מכאן, והמעבר הזה מוותר עליו במקום לנחש. מי שנתקע שם עדיין מגיע דרך שיחה.
 */
export function inClassProcess(db, student) {
  return hasLiveGroup(db, student);
}

/** אותו אדם לא נדחף יותר מפעם בשבוע, גם אם פתוחים אצלו שלושה דברים. */
export const SWEEP_COOLDOWN_DAYS = 7;

export const SWEEP_SOURCE = 'open_step_sweep';

function daysBetween(fromIso, now) {
  const at = Date.parse(fromIso || '');
  if (!Number.isFinite(at)) return Infinity;
  return (new Date(now).getTime() - at) / 86_400_000;
}

/**
 * המתאמנים שיש להם צעד פתוח שהוא שלהם, מקובצים לפי הורה.
 * @returns {{ parent: object, students: object[], step: string, reason: string }[]}
 */
export function openStepCandidates(db, { now = new Date() } = {}) {
  const parents = db?.get?.('parents') || [];
  const parentById = new Map(parents.map((row) => [String(row.id), row]));
  const groups = db?.get?.('groups') || [];
  const byParent = new Map();

  for (const student of db?.get?.('students') || []) {
    if (!SWEEPABLE_STATUSES.has(String(student.status || ''))) continue;
    const parent = parentById.get(String(student.parentId || student.parent_id || ''));
    if (!parent?.phone) continue;
    if (isOptedOut(parent)) continue;
    if (!inClassProcess(db, student)) continue;
    // Still inside the three days we promised. That clock has its own reminder
    // on the morning it runs out, and this sweep must not pre-empt it.
    if (holdIsCounting(db, student, now)) continue;

    const group = groups.find((row) => String(row.id) === String(student.groupId || ''));
    const progress = registrationStep(db, student, { group });
    if (progress.complete || !progress.step) continue;

    const key = String(parent.id);
    if (!byParent.has(key)) byParent.set(key, { parent, students: [], step: progress.step });
    const entry = byParent.get(key);
    entry.students.push({ student, step: progress.step, label: progress.label });
  }

  return [...byParent.values()]
    // The first open step in the family decides what the message is about;
    // asking about three errands in one nudge is how a nudge gets ignored.
    .map((entry) => {
      const step = entry.students[0].step;
      return { ...entry, step, reason: STEP_FOLLOWUP_REASON[step] };
    })
    .filter((entry) => entry.reason)
    // A pause on this very subject — „אני רוצה לחשוב על הציוד עוד שבוע” — is
    // the customer answering this sweep before it ran.
    .filter((entry) => !outreachPausedUntil(db, entry.parent.id, now, { reason: entry.reason }))
    .filter((entry) => !sweptRecently(db, entry.parent.id, now))
    .filter((entry) => !hasOpenFollowUp(db, entry.parent.id));
}

/** שורת מעקב פתוחה כלשהי — הלקוח כבר בתור, ואין להוסיף לו שנייה. */
export function hasOpenFollowUp(db, parentId) {
  return (db?.get?.(FOLLOWUP_COLLECTION) || []).some((row) => (
    String(row.parent_id || '') === String(parentId)
    && String(row.status || FOLLOWUP_OPEN) === FOLLOWUP_OPEN
  ));
}

export function sweptRecently(db, parentId, now = new Date()) {
  return (db?.get?.(FOLLOWUP_COLLECTION) || []).some((row) => (
    String(row.parent_id || '') === String(parentId)
    && String(row.source || '') === SWEEP_SOURCE
    && daysBetween(row.created_at, now) < SWEEP_COOLDOWN_DAYS
  ));
}

/**
 * Open a follow-up row for everyone the sweep found. Sending is deliberately
 * somebody else's job — see the module note.
 */
export async function runOpenStepSweep(db, persist, { now = new Date(), limit = 40 } = {}) {
  const candidates = openStepCandidates(db, { now });
  const created = [];

  for (const entry of candidates.slice(0, Math.max(0, limit))) {
    const names = entry.students.map((item) => String(item.student.name || '').trim().split(/\s+/)[0]).filter(Boolean);
    const row = db.insert(FOLLOWUP_COLLECTION, {
      id: newFollowUpId(),
      parent_id: entry.parent.id,
      phone: entry.parent.phone || '',
      reason: entry.reason,
      note: entry.students[0].label,
      subject: names.join(' ו'),
      // Due now: the sender decides the civilised hour and whether the
      // free-text window is still open.
      due_at: new Date(now).toISOString(),
      due_date: israelDateStr(new Date(now)),
      needs_template: true,
      status: FOLLOWUP_OPEN,
      source: SWEEP_SOURCE,
      created_by: 'sweep',
      created_at: new Date(now).toISOString(),
    });
    if (!row?.id) continue;
    if (typeof persist === 'function') await persist(FOLLOWUP_COLLECTION, row);
    created.push(row);
  }

  return {
    event: 'open_step_sweep',
    date: israelDateStr(new Date(now)),
    candidates: candidates.length,
    created: created.length,
    skipped: Math.max(0, candidates.length - created.length),
  };
}
