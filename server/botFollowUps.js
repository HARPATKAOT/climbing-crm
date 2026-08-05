/**
 * תזכורות שהבוט קובע לעצמו.
 *
 * לקוח שאומר „תבדוק איתי מחר” קיבל עד היום תשובה מנומסת ותו לא — לבוט לא היה
 * שום מקום לרשום בו שהוא הבטיח משהו, ולמחרת אף אחד לא חזר. אותו חור בדיוק
 * נפער אחרי שיבוץ „ממתין להרשמה”: הקישור נשלח, ואם ההורה לא נרשם — איש לא ידע.
 *
 * הרשומות נשמרות באוסף הכללי `bot_followups` (kv_collections), באותו דפוס של
 * `activity_interest`, כדי שלא תידרש מיגרציה על מסד נעול.
 *
 * ## למה שעה ולא תאריך
 *
 * מטא מרשה טקסט חופשי רק בתוך 24 שעות מההודעה האחרונה של הלקוח. „מחר בבוקר”
 * הוא לרוב אחרי שהחלון נסגר, ולכן מעקב יומיים נפל בדיוק על מי שהכי חשוב לחזור
 * אליו. לכן מעקב קצר נקבע ל-23 שעות אחרי ההודעה האחרונה — עדיין בתוך החלון,
 * ובלי תבנית ובלי עלות. מעקב ארוך („נדבר בספטמבר”) אינו יכול להיכנס לחלון
 * ולכן הוא מסומן ככזה שדורש תבנית מאושרת.
 *
 * מה שנשמר הוא *מה הובטח*, לא נוסח ההודעה: את הניסוח עושים ברגע השליחה, כדי
 * שהודעת המעקב תישמע כמו המשך שיחה ולא כמו הדבקה של טקסט מלפני יום.
 */

import { israelDateStr } from './attendanceUtils.js';

export const FOLLOWUP_COLLECTION = 'bot_followups';

export const FOLLOWUP_OPEN = 'open';
export const FOLLOWUP_SENT = 'sent';
export const FOLLOWUP_CANCELLED = 'cancelled';

/** Why the bot is coming back. The reason decides the wording, not the model. */
export const FOLLOWUP_REASONS = new Set([
  'customer_asked',   // "תבדוק איתי מחר"
  'pending_signup',   // נשלח קישור הרשמה — לבדוק אם נרשמו
  'general',
]);

/** Never more than three months out: past that it is not a follow-up. */
const MAX_DAYS_AHEAD = 90;

/** Meta's free-text window, and how long before it closes we aim to write. */
const WINDOW_HOURS = 24;
const AIM_HOURS = 23;
const HOUR_MS = 60 * 60 * 1000;

function clean(value) {
  return String(value ?? '').trim();
}

/**
 * The generic id is the table prefix plus a millisecond, so two follow-ups born
 * in the same tick — a placement and a "check with me tomorrow" in one turn —
 * came out sharing an id, and only one of them was ever sent. A random suffix
 * is what keeps them apart.
 */
export function newFollowUpId() {
  return `bf${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

export function followUpRows(db) {
  const rows = db.get(FOLLOWUP_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

/** Minutes past midnight, Israel time, for a moment in time. */
function israelMinutes(at) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function parseHhMm(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clean(value));
  if (!m) return fallback;
  return Math.min(24 * 60, Number(m[1]) * 60 + Number(m[2]));
}

/**
 * When to write, so the message lands inside the free-text window *and* at an
 * hour a person would actually write at.
 *
 * Aiming at 23 hours is right until the customer's last message came in at 4am:
 * then 23 hours later is 3am, and nobody sends a nudge at 3am. In that case the
 * latest civilised moment still inside the window is the answer — usually the
 * evening before. If there is no such moment left, this returns null and the
 * caller falls back to a template or to the team.
 *
 * @returns {string|null} ISO timestamp
 */
export function inWindowSendAt({
  lastInboundAt,
  now = new Date(),
  activeStart = '09:00',
  activeEnd = '21:00',
} = {}) {
  const inbound = new Date(lastInboundAt || 0).getTime();
  if (!inbound) return null;
  const closesAt = inbound + WINDOW_HOURS * HOUR_MS;
  const nowMs = new Date(now).getTime();
  if (closesAt <= nowMs) return null;

  const startMin = parseHhMm(activeStart, 9 * 60);
  const endMin = parseHhMm(activeEnd, 21 * 60);
  const inHours = (ms) => {
    const minutes = israelMinutes(new Date(ms));
    return minutes >= startMin && minutes <= endMin;
  };

  const aim = inbound + AIM_HOURS * HOUR_MS;
  if (aim > nowMs && aim < closesAt && inHours(aim)) return new Date(aim).toISOString();

  // Walk back from the moment the window shuts, a quarter-hour at a time, to
  // the last slot that is both inside the window and inside working hours.
  const step = 15 * 60 * 1000;
  for (let t = closesAt - step; t > nowMs; t -= step) {
    if (inHours(t)) return new Date(t).toISOString();
  }
  // Nothing civilised left, but the window is open now and we are awake.
  if (inHours(nowMs)) return new Date(nowMs).toISOString();
  return null;
}

/**
 * `days` beats an explicit date: the model is far better at "מחר" than at
 * working out today's date, and a date it invents lands in the past.
 */
export function resolveDueDate({ days = null, dueDate = '', today = israelDateStr() } = {}) {
  // Number(null) is 0, so a missing `days` used to read as "today" — a promise
  // to come back tomorrow would have gone out the same afternoon.
  const given = days !== null && days !== undefined && days !== '';
  const requested = given ? Number(days) : NaN;
  if (Number.isFinite(requested) && requested >= 0) {
    const base = new Date(`${today}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + Math.min(MAX_DAYS_AHEAD, Math.round(requested)));
    return base.toISOString().slice(0, 10);
  }
  const explicit = clean(dueDate).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit) && explicit >= today) {
    const limit = new Date(`${today}T12:00:00Z`);
    limit.setUTCDate(limit.getUTCDate() + MAX_DAYS_AHEAD);
    return explicit <= limit.toISOString().slice(0, 10) ? explicit : limit.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Everything the caller needs to store a follow-up: when to write, and whether
 * that moment is inside the free-text window or needs an approved template.
 */
export function planFollowUp({
  days,
  lastInboundAt,
  now = new Date(),
  settings = {},
} = {}) {
  // `now` has to reach the date too. It did not, so the day was taken from the
  // real clock while the hour was taken from the argument — the two disagreed
  // the moment midnight passed, which is exactly when a test notices and a
  // caller does not.
  const dueDate = resolveDueDate({ days, today: israelDateStr(new Date(now)) });
  if (!dueDate) return null;

  // One day out is the case the window can still cover.
  if (Number(days) <= 1) {
    const sendAt = inWindowSendAt({
      lastInboundAt,
      now,
      activeStart: settings.aiActiveHoursStart,
      activeEnd: settings.aiActiveHoursEnd,
    });
    if (sendAt) return { due_at: sendAt, due_date: sendAt.slice(0, 10), needs_template: false };
  }
  // Further out than the window can reach: noon on the day, by template.
  return {
    due_at: `${dueDate}T09:00:00.000Z`,
    due_date: dueDate,
    needs_template: true,
  };
}

/** One open follow-up per customer per reason — a chat that circles back to the
 *  same promise must not turn into three messages the next morning. */
export function findOpenFollowUp(db, { parentId, reason }) {
  return followUpRows(db).find(
    (row) => String(row.parent_id || '') === String(parentId)
      && String(row.reason || '') === String(reason)
      && String(row.status || FOLLOWUP_OPEN) === FOLLOWUP_OPEN
  ) || null;
}

/** Open follow-ups whose moment has arrived. Older rows carry a date only. */
export function dueFollowUps(db, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  const today = israelDateStr(new Date(now));
  return followUpRows(db)
    .filter((row) => String(row.status || FOLLOWUP_OPEN) === FOLLOWUP_OPEN)
    .filter((row) => (row.due_at
      ? new Date(row.due_at).getTime() <= nowMs
      : clean(row.due_date) && clean(row.due_date) <= today))
    .sort((a, b) => String(a.due_at || a.due_date || '').localeCompare(String(b.due_at || b.due_date || '')));
}

export function followUpSendId(row) {
  return `bf-${String(row?.id || '')}`;
}

/**
 * Claim before talking to Meta. `automation_sends` has a durable unique
 * (collection,id) key, so two API processes cannot both claim the same
 * follow-up even when each holds an old in-memory copy of the open row.
 */
export async function claimFollowUpSend(db, row, {
  date = israelDateStr(),
  phone = '',
  now = new Date(),
} = {}) {
  const id = followUpSendId(row);
  if (!row?.id) return { claimed: false, id, reason: 'missing_followup_id' };
  if ((db.get('automation_sends') || []).some((item) => String(item.id) === id)) {
    return { claimed: false, id, reason: 'already_claimed' };
  }
  if (typeof db.appendOnly !== 'function') {
    return { claimed: false, id, reason: 'durable_claim_unavailable' };
  }

  const claimedAt = new Date(now).toISOString();
  const result = await db.appendOnly('automation_sends', {
    id,
    event: 'bot_followup',
    date,
    phone,
    status: 'claimed',
    claimed_at: claimedAt,
  });
  if (!result?.ok) {
    return { claimed: false, id, reason: 'already_claimed', error: result?.error || '' };
  }
  return { claimed: true, id, record: result.record };
}

/** A successful claim stays as the permanent dedupe marker. */
export async function finishFollowUpSend(db, claimId, {
  persist = null,
  now = new Date(),
} = {}) {
  const sentAt = new Date(now).toISOString();
  const updated = db.update('automation_sends', claimId, {
    status: 'sent',
    sent_at: sentAt,
  });
  if (updated && typeof persist === 'function') {
    const durable = await persist('automation_sends', updated);
    if (durable?.ok === false) return { ok: false, error: durable.error || 'claim_finalize_failed' };
  }
  return { ok: true, record: updated || null };
}

/** A failed delivery releases the claim so a later scan may retry safely. */
export async function releaseFollowUpSend(db, claimId) {
  if (!claimId) return { ok: true };
  if (typeof db.deleteDurable === 'function') return db.deleteDurable('automation_sends', claimId);
  if (typeof db.delete === 'function') return { ok: db.delete('automation_sends', claimId) };
  return { ok: false, error: 'claim_release_unavailable' };
}

/**
 * The message the customer gets. Built from what was promised, so "תבדוק איתי
 * מחר" comes back as that subject and a placement comes back asking about the
 * registration — never as a generic "just checking in".
 */
export function followUpMessage(row, { firstName = '' } = {}) {
  const hello = firstName ? `היי ${firstName},` : 'היי,';
  const note = clean(row?.note);
  if (String(row?.reason) === 'pending_signup') {
    const child = clean(row?.subject);
    return [
      `${hello} רק בודק מה קורה 🙂`,
      child
        ? `הספקתם להשלים את ההרשמה של ${child} במתנ״ס?`
        : 'הספקתם להשלים את ההרשמה במתנ״ס?',
      'אם נתקלתם במשהו — כתבו לי ואשמח לעזור.',
    ].join('\n');
  }
  return [
    `${hello} חוזר אליכם כמו שסיכמנו 🙂`,
    note ? `לגבי ${note} — יש התקדמות?` : 'יש התקדמות בעניין שדיברנו עליו?',
  ].join('\n');
}
