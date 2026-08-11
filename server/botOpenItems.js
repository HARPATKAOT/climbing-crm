/**
 * „מה פתוח” — כל מה שהבוט השאיר פתוח, במקום אחד.
 *
 * לבוט יש שלושה סוגי חובות שאיש לא רואה עד שהם מתפוצצים: לקוח שהועבר לצוות
 * ואיש לא ענה לו, מעקב שהובטח ועוד לא יצא, וילד שדווח למתנ״ס ועוד לא אושר.
 * כל אחד מהם יושב באוסף אחר, ובאף מסך לא הופיעה השאלה „מי ממתין עכשיו”.
 * שני לקוחות חיכו יום שלם ואיש לא ידע — לא בגלל באג, אלא בגלל שלא היה איפה
 * לראות.
 *
 * המודול קורא בלבד. הוא לא משנה סטטוס ולא שולח כלום — הוא רק מרכיב את התמונה
 * מתוך מה שכבר נשמר: `parents`, `messages`, `bot_followups` ו-
 * `centre_registration_checks`. `db` מוזרק, כדי שאפשר יהיה לבדוק אותו בלי מסד.
 */

import { isHumanOutboundLog } from './whatsappBot.js';
import { FOLLOWUP_COLLECTION, FOLLOWUP_OPEN } from './botFollowUps.js';
import {
  CENTRE_CHECK_COLLECTION,
  CENTRE_CHECK_ASKED,
  CENTRE_CHECK_CONFIRMED,
  CENTRE_CHECK_REPORTED,
  CENTRE_CHECK_UNCONFIRMED,
} from './centreRegistrationChecks.js';

/** A handoff older than this is history, not a queue. */
export const MAX_WAIT_DAYS = 14;

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/** Israeli numbers arrive as 05x…, 9725x… and +9725x… — the last nine agree. */
function lineKey(value) {
  const only = digits(value);
  return only.length >= 9 ? only.slice(-9) : '';
}

function rowsOf(db, table) {
  const list = db?.get?.(table);
  return Array.isArray(list) ? list : [];
}

/**
 * Every conversation, keyed by phone line, newest last.
 *
 * `messages` is the source of truth and `whatsapp_logs` is a local mirror of
 * it; reading only one of them is how a staff reply sent from the CRM went
 * unseen. Both are read and the overlap is dropped.
 */
export function threadsByLine(db, { since = '' } = {}) {
  const map = new Map();
  const seen = new Set();
  const from = String(since || '');
  for (const row of [...rowsOf(db, 'messages'), ...rowsOf(db, 'whatsapp_logs')]) {
    // The screen polls, and the whole message table is tens of thousands of
    // rows. Nothing older than the oldest handoff we would show can change an
    // answer here, so it is never read.
    if (from && String(row.created_at || '') < from) continue;
    const key = lineKey(row.phone || row.to || row.from);
    if (!key) continue;
    const dedupe = `${row.id || ''}|${row.created_at || ''}|${row.direction || ''}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }
  return map;
}

function lastInbound(thread = []) {
  for (let i = thread.length - 1; i >= 0; i -= 1) {
    if (thread[i].direction === 'inbound') return thread[i];
  }
  return null;
}

/** Did a person — not the bot, not an automation — write after this moment? */
function answeredByHumanSince(thread = [], sinceTs) {
  return thread.some((row) => row.direction === 'outbound'
    && Date.parse(row.created_at || '') > sinceTs
    && isHumanOutboundLog(row));
}

/**
 * Customers the bot handed to the team and nobody has answered.
 *
 * A handoff closes in one of two ways: a human writes to the customer, or
 * somebody clears the card from the awaiting queue (`communication_handled_at`).
 * Anything else is still a person waiting, however politely the bot phrased it.
 *
 * Several cards can share one phone — a parent card and a child's card — so the
 * queue is per line, holding the earliest handoff on it.
 */
export function waitingForStaff(db, { now = new Date(), maxWaitDays = MAX_WAIT_DAYS } = {}) {
  const nowMs = new Date(now).getTime();
  const threads = threadsByLine(db, {
    since: new Date(nowMs - maxWaitDays * DAY_MS).toISOString(),
  });
  const byLine = new Map();

  for (const parent of rowsOf(db, 'parents')) {
    const handedTs = Date.parse(parent.bot_handoff_at || '');
    if (!Number.isFinite(handedTs)) continue;
    if (nowMs - handedTs > maxWaitDays * DAY_MS) continue;

    const key = lineKey(parent.phone);
    const thread = key ? (threads.get(key) || []) : [];
    if (answeredByHumanSince(thread, handedTs)) continue;
    const handledTs = Date.parse(parent.communication_handled_at || '');
    if (Number.isFinite(handledTs) && handledTs >= handedTs) continue;

    const inbound = lastInbound(thread);
    const row = {
      parent_id: parent.id || null,
      name: String(parent.name || '').trim(),
      phone: parent.phone || '',
      handed_at: new Date(handedTs).toISOString(),
      waiting_minutes: Math.max(0, Math.round((nowMs - handedTs) / MINUTE_MS)),
      last_message: String(inbound?.message || '').slice(0, 160),
      last_message_at: inbound?.created_at || null,
      opted_out: !!parent.bot_opted_out,
    };
    const existing = byLine.get(key || `card:${parent.id}`);
    // The oldest handoff on the line is the one that has been waiting.
    if (!existing || row.handed_at < existing.handed_at) {
      byLine.set(key || `card:${parent.id}`, existing ? { ...row, name: row.name || existing.name } : row);
    }
  }

  return [...byLine.values()].sort((a, b) => a.handed_at.localeCompare(b.handed_at));
}

/**
 * Reminders the bot set itself and has not sent yet.
 *
 * `overdue` is the column that matters: an open follow-up whose moment passed
 * means the 15-minute scan did not send it, and that is a fault worth seeing —
 * a follow-up still ahead of its time is simply the queue working.
 */
export function pendingFollowUps(db, { now = new Date(), limit = 100 } = {}) {
  const nowMs = new Date(now).getTime();
  const names = new Map(rowsOf(db, 'parents').map((p) => [String(p.id), p]));

  return rowsOf(db, FOLLOWUP_COLLECTION)
    .filter((row) => String(row.status || FOLLOWUP_OPEN) === FOLLOWUP_OPEN)
    .map((row) => {
      const parent = names.get(String(row.parent_id || '')) || null;
      const dueAt = row.due_at || (row.due_date ? `${row.due_date}T09:00:00.000Z` : '');
      const dueTs = Date.parse(dueAt || '');
      return {
        id: row.id || '',
        parent_id: row.parent_id || null,
        name: String(parent?.name || '').trim(),
        phone: parent?.phone || row.phone || '',
        reason: String(row.reason || 'general'),
        subject: String(row.subject || row.note || '').slice(0, 120),
        due_at: Number.isFinite(dueTs) ? new Date(dueTs).toISOString() : '',
        needs_template: !!row.needs_template,
        overdue: Number.isFinite(dueTs) && dueTs <= nowMs,
      };
    })
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

const CENTRE_STATUS_LABELS = {
  [CENTRE_CHECK_REPORTED]: 'ההורה דיווח — טרם נשאלה כרמית',
  [CENTRE_CHECK_ASKED]: 'נשאלה כרמית — אין תשובה',
  [CENTRE_CHECK_UNCONFIRMED]: 'נשאל ההורה שוב — אין אישור',
};

/**
 * Trainees whose parent said "we registered at the מתנ״ס" and nobody has
 * confirmed. Whoever is here is *not* marked registered, on purpose — this is
 * the list a person has to close.
 */
export function openCentreChecks(db, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  return rowsOf(db, CENTRE_CHECK_COLLECTION)
    .filter((row) => String(row.status || '') !== CENTRE_CHECK_CONFIRMED)
    .map((row) => {
      const reportedTs = Date.parse(row.reported_at || row.created_at || '');
      return {
        id: row.id || '',
        student_id: row.student_id || null,
        student_name: String(row.student_name || '').trim(),
        phone: row.phone || '',
        status: String(row.status || CENTRE_CHECK_REPORTED),
        status_label: CENTRE_STATUS_LABELS[String(row.status || '')] || CENTRE_STATUS_LABELS[CENTRE_CHECK_REPORTED],
        rounds: Number(row.rounds || 0),
        reported_at: Number.isFinite(reportedTs) ? new Date(reportedTs).toISOString() : '',
        waiting_days: Number.isFinite(reportedTs) ? Math.max(0, Math.floor((nowMs - reportedTs) / DAY_MS)) : 0,
      };
    })
    .sort((a, b) => String(a.reported_at).localeCompare(String(b.reported_at)));
}

/**
 * The whole screen in one read. `needsAttention` is what a badge shows: the
 * people waiting plus the reminders that should already have gone out.
 */
export function botOpenItems(db, { now = new Date() } = {}) {
  const waiting = waitingForStaff(db, { now });
  const followUps = pendingFollowUps(db, { now });
  const centreChecks = openCentreChecks(db, { now });
  const overdue = followUps.filter((row) => row.overdue).length;
  return {
    waiting,
    followUps,
    centreChecks,
    summary: {
      waiting: waiting.length,
      // Anyone waiting over an hour is no longer "the team is on it".
      waitingOverHour: waiting.filter((row) => row.waiting_minutes >= 60).length,
      followUps: followUps.length,
      overdueFollowUps: overdue,
      centreChecks: centreChecks.length,
      needsAttention: waiting.length + overdue,
    },
  };
}
