/**
 * „אני בחו״ל ולא מצליחה לשלם”, „נירשם רק באוקטובר”.
 *
 * שתי המשפחות האלה קיבלו את אותה תזכורת שוב ושוב, לפעמים באותו יום שבו כתבו
 * שהן לא יכולות עכשיו. הבוט ענה להן נכון בכל פעם — מה שלא נעצר היה המעקבים
 * המתוזמנים, שיודעים רק שהטופס לא מולא ושהציוד לא הוסדר.
 *
 * לכן יש כאן שדה אחד: עד מתי לא פונים מיוזמתנו. הוא אינו משתיק את הבוט —
 * לקוחה שכותבת מקבלת תשובה כרגיל — הוא עוצר רק את הפניות שאנחנו יוזמים.
 *
 * האוסף יושב ב-kv_collections כמו `bot_followups`, ולכן אינו דורש מיגרציית
 * סכימה.
 */

import { israelDateStr } from './attendanceUtils.js';
import { israelTimeToEpoch } from './shiftAlerts.js';

export const OUTREACH_PAUSE_COLLECTION = 'bot_outreach_pauses';

/** Never further out than a season: past that it is not a pause, it is a lost customer. */
export const MAX_PAUSE_DAYS = 120;

/** What a customer said, so a person reading the row knows why we went quiet. */
export const PAUSE_REASONS = new Set([
  'customer_unavailable', // „אני בחו״ל”, „אני בטיול”
  'customer_later',       // „נירשם רק באוקטובר”
  'awaiting_customer_date', // אמר שאינו יכול, טרם אמר מתי כן
  'staff_handling',       // הועבר לצוות ואדם מטפל
  'general',
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function outreachPauseRows(db) {
  const rows = db?.get?.(OUTREACH_PAUSE_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

/**
 * הנושאים שאפשר להשהות בנפרד, וסיבת המעקב שכל אחד מהם עוצר.
 *
 * „אני רוצה לחשוב על הציוד עוד שבוע” אינו „אל תפנו אליי”: ההרשמה במתנ״ס עדיין
 * צריכה להגיע ממנו. השהיה בלי נושא היא על הכול, כמו קודם.
 */
export const PAUSE_TOPICS = Object.freeze({
  equipment: 'equipment_unpaid',
  centre: 'pending_signup',
  form: 'form_not_filled',
  group: 'no_group_yet',
});

export function pauseRowId(parentId, topic = '') {
  const scope = clean(topic);
  return scope ? `bop-${clean(parentId)}-${scope}` : `bop-${clean(parentId)}`;
}

/** Does this pause hold back a follow-up sent for `reason`? */
export function pauseCovers(row, reason = '') {
  const topics = (Array.isArray(row?.topics) ? row.topics : []).map(clean).filter(Boolean);
  if (!topics.length) return true;
  if (!clean(reason)) return false;
  return topics.some((topic) => PAUSE_TOPICS[topic] === reason || topic === reason);
}

/**
 * The moment proactive contact may resume, or '' when nothing is holding it.
 * An expired row is simply ignored — it stays as a record of what was asked.
 *
 * `reason` is the follow-up the caller is about to send. Without it only a
 * whole-customer pause answers, which is what „is this customer on hold?”
 * means; a topic pause is an answer about that topic alone.
 */
export function outreachPausedUntil(db, parentId, now = new Date(), { reason = '' } = {}) {
  const nowMs = new Date(now).getTime();
  const mine = outreachPauseRows(db).filter((row) => (
    String(row.parent_id || '') === String(parentId)
    || String(row.id || '').startsWith(`${pauseRowId(parentId)}-`)
    || String(row.id || '') === pauseRowId(parentId)
  ));
  const live = mine
    .filter((row) => pauseCovers(row, reason))
    .map((row) => Date.parse(row.until || ''))
    .filter((until) => Number.isFinite(until) && until > nowMs);
  if (!live.length) return '';
  return new Date(Math.max(...live)).toISOString();
}

export function isOutreachPaused(db, parentId, now = new Date(), options = {}) {
  return Boolean(outreachPausedUntil(db, parentId, now, options));
}

/**
 * Turn what the customer said into the day we may write again.
 *
 * `days` and a month name are the two things a customer actually gives us.
 * A month means the week before it starts — registering *in* October is a
 * conversation that has to happen while September is still running.
 */
export function resolvePauseUntil({
  days = null,
  untilDate = '',
  targetMonth = '',
  now = new Date(),
} = {}) {
  const today = israelDateStr(new Date(now));
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + MAX_PAUSE_DAYS);
  const maxDate = limit.toISOString().slice(0, 10);

  const cap = (date) => {
    if (!date) return '';
    if (date <= today) return '';
    return date > maxDate ? maxDate : date;
  };

  const month = monthStartDate(targetMonth, today);
  if (month) {
    // A week before the month opens: enough time to place and to register.
    const lead = new Date(`${month}T12:00:00Z`);
    lead.setUTCDate(lead.getUTCDate() - 7);
    const date = cap(lead.toISOString().slice(0, 10));
    if (date) return { date, until: new Date(israelTimeToEpoch(date, '09:00')).toISOString() };
  }

  const requested = days === null || days === undefined || days === '' ? NaN : Number(days);
  if (Number.isFinite(requested) && requested > 0) {
    const base = new Date(`${today}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + Math.min(MAX_PAUSE_DAYS, Math.round(requested)));
    const date = cap(base.toISOString().slice(0, 10));
    if (date) return { date, until: new Date(israelTimeToEpoch(date, '09:00')).toISOString() };
  }

  const explicit = clean(untilDate).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) {
    const date = cap(explicit);
    if (date) return { date, until: new Date(israelTimeToEpoch(date, '09:00')).toISOString() };
  }
  return null;
}

/**
 * „אני בחו״ל” with no date at all.
 *
 * Guessing a fortnight is how the reminders came back on a customer who had
 * not said anything of the sort. The owner's call: ask when to come back, and
 * stay quiet until they answer. Quiet means the season ceiling — an inbound
 * message is answered as usual throughout, because the pause only ever held
 * back what we start.
 */
export function openEndedPause({ now = new Date() } = {}) {
  return resolvePauseUntil({ days: MAX_PAUSE_DAYS, now });
}

const MONTHS_HE = new Map([
  ['ינואר', 1], ['פברואר', 2], ['מרץ', 3], ['אפריל', 4], ['מאי', 5], ['יוני', 6],
  ['יולי', 7], ['אוגוסט', 8], ['ספטמבר', 9], ['אוקטובר', 10], ['נובמבר', 11], ['דצמבר', 12],
]);

function monthStartDate(targetMonth, today) {
  const source = clean(targetMonth);
  if (!source) return '';
  const iso = /^(\d{4})-(\d{1,2})$/.exec(source);
  let year = Number(today.slice(0, 4));
  let month;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
  } else {
    month = MONTHS_HE.get(source.replace(/^ב/u, '')) || Number(source);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) return '';
  let start = `${year}-${String(month).padStart(2, '0')}-01`;
  if (start < today && start.slice(0, 7) !== today.slice(0, 7)) {
    start = `${year + 1}-${String(month).padStart(2, '0')}-01`;
  }
  return start;
}

/**
 * One row per customer. A second „תחזרו אליי מאוחר יותר” in the same
 * conversation moves the date; it does not add a second pause.
 */
export async function setOutreachPause(db, persist, {
  parentId,
  until,
  reason = 'general',
  note = '',
  topics = [],
  now = new Date(),
} = {}) {
  const scope = (Array.isArray(topics) ? topics : [topics])
    .map(clean)
    .filter((topic) => Object.prototype.hasOwnProperty.call(PAUSE_TOPICS, topic));
  const id = pauseRowId(parentId, scope.join('-'));
  if (!clean(parentId) || !clean(until)) return null;
  const stamp = new Date(now).toISOString();
  const existing = db?.getOne?.(OUTREACH_PAUSE_COLLECTION, id);
  const payload = {
    id,
    parent_id: String(parentId),
    until: new Date(until).toISOString(),
    reason: PAUSE_REASONS.has(String(reason)) ? String(reason) : 'general',
    topics: scope,
    note: clean(note),
    created_at: existing?.created_at || stamp,
    updated_at: stamp,
  };
  const saved = existing
    ? db.update(OUTREACH_PAUSE_COLLECTION, id, payload)
    : db.insert(OUTREACH_PAUSE_COLLECTION, payload);
  if (saved && typeof persist === 'function') await persist(OUTREACH_PAUSE_COLLECTION, saved);
  return saved;
}

export async function clearOutreachPause(db, persist, parentId, { now = new Date() } = {}) {
  const id = pauseRowId(parentId);
  const existing = db?.getOne?.(OUTREACH_PAUSE_COLLECTION, id);
  if (!existing) return null;
  const updated = db.update(OUTREACH_PAUSE_COLLECTION, id, {
    until: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  });
  if (updated && typeof persist === 'function') await persist(OUTREACH_PAUSE_COLLECTION, updated);
  return updated;
}
