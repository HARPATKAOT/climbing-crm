/**
 * Bot quality-control loop.
 *
 * Staff ratings and corrections are retained for review and regression tests,
 * but they never change the live bot prompt. Legacy learned examples are kept
 * as an archive only so historical feedback is not destroyed.
 */

import { normalizeWaPhone, phonesMatch } from './whatsappConnect.js';

export const FEEDBACK_COLLECTION = 'bot_reply_feedback';
export const LEARNED_COLLECTION = 'bot_learned_replies';

export const FEEDBACK_SAVED = 'saved';
export const FEEDBACK_PENDING = 'pending';
export const FEEDBACK_APPROVED = 'approved';
export const FEEDBACK_REJECTED = 'rejected';

const MAX_EXCERPT = 500;
const MAX_ALTERNATIVE = 900;

function clip(text, max) {
  const body = String(text || '').trim();
  if (body.length <= max) return body;
  return `${body.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\u0590-\u05FFa-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/** Simple overlap score — enough for a small curated store. */
export function textOverlapScore(a, b) {
  const left = new Set(tokens(a));
  const right = tokens(b);
  if (!left.size || !right.length) return 0;
  let hit = 0;
  for (const t of right) {
    if (left.has(t)) hit += 1;
  }
  return hit / Math.max(left.size, right.length);
}

export function listFeedback(db, { status } = {}) {
  const rows = db.get(FEEDBACK_COLLECTION) || [];
  if (!status) return rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return rows
    .filter((r) => r.status === status)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export function listLearned(db, { activeOnly = true } = {}) {
  const rows = db.get(LEARNED_COLLECTION) || [];
  if (activeOnly) return [];
  return rows
    .map((r) => ({ ...r, active: false }))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export function feedbackStats(db, { days = 7 } = {}) {
  const since = Date.now() - Number(days) * 24 * 60 * 60 * 1000;
  const rows = (db.get(FEEDBACK_COLLECTION) || []).filter((r) => {
    const t = Date.parse(r.created_at || '');
    return Number.isFinite(t) && t >= since;
  });
  const up = rows.filter((r) => r.rating === 'up').length;
  const down = rows.filter((r) => r.rating === 'down').length;
  const pending = rows.filter((r) => r.status === FEEDBACK_PENDING).length;
  return { days, up, down, pending, total: rows.length };
}

export async function recordFeedback({
  db,
  persist,
  messageId,
  parentId = null,
  phone = '',
  rating,
  note = '',
  alternative = '',
  replyExcerpt = '',
  inboundExcerpt = '',
  createdBy = '',
} = {}) {
  const rate = rating === 'up' || rating === 'down' ? rating : null;
  if (!rate) return { ok: false, error: 'דירוג לא תקין' };
  if (!messageId) return { ok: false, error: 'חסר מזהה הודעה' };

  const existing = (db.get(FEEDBACK_COLLECTION) || []).find(
    (r) => String(r.message_id) === String(messageId) && r.created_by === (createdBy || '')
  );
  if (existing) {
    const patch = {
      rating: rate,
      note: clip(note, 300),
      alternative: clip(alternative, MAX_ALTERNATIVE),
      reply_excerpt: clip(replyExcerpt || existing.reply_excerpt, MAX_EXCERPT),
      inbound_excerpt: clip(inboundExcerpt || existing.inbound_excerpt, MAX_EXCERPT),
      status: rate === 'down' && String(alternative || '').trim()
        ? FEEDBACK_PENDING
        : rate === 'up'
          ? FEEDBACK_SAVED
          : FEEDBACK_SAVED,
      updated_at: new Date().toISOString(),
    };
    const row = db.update(FEEDBACK_COLLECTION, existing.id, patch);
    if (row && persist) await persist(FEEDBACK_COLLECTION, row);
    return { ok: true, row };
  }

  const row = db.insert(FEEDBACK_COLLECTION, {
    message_id: messageId,
    parent_id: parentId || null,
    phone: normalizeWaPhone(phone) || phone || '',
    rating: rate,
    note: clip(note, 300),
    alternative: clip(alternative, MAX_ALTERNATIVE),
    reply_excerpt: clip(replyExcerpt, MAX_EXCERPT),
    inbound_excerpt: clip(inboundExcerpt, MAX_EXCERPT),
    status: rate === 'down' && String(alternative || '').trim() ? FEEDBACK_PENDING : FEEDBACK_SAVED,
    created_by: createdBy || '',
    created_at: new Date().toISOString(),
  });
  if (persist) await persist(FEEDBACK_COLLECTION, row);

  return { ok: true, row };
}

export async function upsertLearned({
  db,
  persist,
  question,
  answer,
  tags = [],
  sourceFeedbackId = null,
  createdBy = '',
  autoActive = false,
} = {}) {
  const q = clip(question, MAX_EXCERPT);
  const a = clip(answer, MAX_ALTERNATIVE);
  if (!q || !a) return { ok: false, error: 'חסרים שאלה או תשובה' };

  const row = db.insert(LEARNED_COLLECTION, {
    question: q,
    answer: a,
    tags: Array.isArray(tags) ? tags : [],
    active: !!autoActive,
    source_feedback_id: sourceFeedbackId || null,
    created_by: createdBy || '',
    created_at: new Date().toISOString(),
  });
  if (persist) await persist(LEARNED_COLLECTION, row);
  return { ok: true, row };
}

export async function approveFeedback({ db, persist, id, actor = '', editedAlternative = null } = {}) {
  const current = (db.get(FEEDBACK_COLLECTION) || []).find((r) => String(r.id) === String(id));
  if (!current) return { ok: false, error: 'לא נמצא' };
  const answer = clip(editedAlternative != null ? editedAlternative : current.alternative, MAX_ALTERNATIVE);
  const question = clip(current.inbound_excerpt, MAX_EXCERPT);
  if (!answer || !question) return { ok: false, error: 'חסרה חלופה או שאלת לקוח' };

  const row = db.update(FEEDBACK_COLLECTION, current.id, {
    status: FEEDBACK_APPROVED,
    alternative: answer,
    approved_by: actor || '',
    approved_at: new Date().toISOString(),
    learned_id: null,
  });
  if (row && persist) await persist(FEEDBACK_COLLECTION, row);
  return { ok: true, row, learned: null };
}

export async function rejectFeedback({ db, persist, id, actor = '' } = {}) {
  const current = (db.get(FEEDBACK_COLLECTION) || []).find((r) => String(r.id) === String(id));
  if (!current) return { ok: false, error: 'לא נמצא' };
  const row = db.update(FEEDBACK_COLLECTION, current.id, {
    status: FEEDBACK_REJECTED,
    rejected_by: actor || '',
    rejected_at: new Date().toISOString(),
  });
  if (row && persist) await persist(FEEDBACK_COLLECTION, row);
  return { ok: true, row };
}

export async function setLearnedActive({ db, persist, id, active } = {}) {
  // Legacy examples are permanently archived. Keep accepting the old endpoint
  // so bookmarked/open screens do not fail, but never reactivate an example.
  const row = db.update(LEARNED_COLLECTION, id, { active: false, updated_at: new Date().toISOString() });
  if (!row) return { ok: false, error: 'לא נמצא' };
  if (persist) await persist(LEARNED_COLLECTION, row);
  return { ok: true, row };
}

export function matchLearnedReplies() {
  return [];
}

export function formatLearnedRepliesForPrompt(examples = []) {
  if (!examples.length) return '';
  const lines = examples.map((ex, i) => (
    `${i + 1}. שאלה: ${ex.question}\n   תשובה מאושרת: ${ex.answer}`
  ));
  return [
    '## דוגמאות מאושרות מהצוות',
    'אם השאלה דומה — העדף את הניסוח המאושר.',
    'אל תדרוס נתונים חיים (מחיר קבוצה, שעות מהיומן, תפוסה) ואל תעבור על נושאים אסורים.',
    lines.join('\n'),
  ].join('\n');
}

/**
 * Fill in what the bot said, for rows that were written before it was stored.
 *
 * A queue where the answer is blank cannot be judged: approving a replacement
 * means seeing what it replaces. The reply is still in the conversation, so it
 * is looked up at read time rather than left as an empty line on the screen.
 */
export function withBotReplies(db, rows = []) {
  const messages = db.get('messages') || [];
  return rows.map((row) => {
    if (String(row.reply_excerpt || '').trim()) return row;
    const at = Date.parse(row.created_at || '');
    if (!Number.isFinite(at) || !row.phone) return row;
    const thread = messages
      .filter((m) => phonesMatch(m.phone || '', row.phone))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    // The question on the card, found in the thread — then whatever the bot
    // said to it. Matching the text keeps the pair together even for rows
    // written before the reply was stored.
    const wanted = String(row.inbound_excerpt || '').trim();
    const inbound = [...thread].reverse().find((m) => m.direction === 'inbound'
      && Date.parse(m.created_at || '') <= at + 60_000
      && (!wanted || String(m.message || m.body || '').trim() === wanted));
    if (!inbound) return row;
    return { ...row, reply_excerpt: clip(botAnswerTo(thread, inbound), MAX_EXCERPT) };
  });
}

/**
 * What the bot answered *to this message* — the reply that comes after it and
 * before the customer writes again.
 *
 * Reading backwards from the handoff instead put the wrong pair on the screen:
 * the customer's "שהם" was shown against "נעים מאוד אלון, ומה שם המשפחה?", the
 * question that had prompted it. The card read backwards, and the staff
 * alternative was being judged against a reply to a different message.
 *
 * The handoff acknowledgement ("מעבירים אתכם לצוות") is not an answer — it is
 * the bot saying it has none — and it is written with `source: 'bot_control'`.
 * When that is all there is, the answer is empty, which is the truth.
 */
function botAnswerTo(messages, inbound) {
  const index = messages.findIndex((m) => m === inbound);
  if (index < 0) return '';
  for (const message of messages.slice(index + 1)) {
    if (message.direction === 'inbound') break;
    if (message.direction !== 'outbound' || !message.is_ai) continue;
    if (String(message.source || '') === 'bot_control') continue;
    return String(message.message || message.body || '');
  }
  return '';
}

/**
 * After a handoff, when staff sends a free-text reply, propose that Q→A pair
 * into the learning queue (still needs approval).
 */
export async function proposeFromHandoffStaffReply({
  db,
  persist,
  phone,
  parent,
  staffText,
  createdBy = 'handoff_mine',
} = {}) {
  // A human reply is specific to its conversation. It must not silently become
  // a reusable bot rule or even a pending training proposal.
  return { ok: false, skipped: true, reason: 'quality_control_only' };
}
