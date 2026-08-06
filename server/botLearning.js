/**
 * Bot learning loop: staff rates replies → optional correction → approve into
 * a learned-examples store that is injected into the next prompt.
 *
 * Same propose/approve pattern as aiActions — nothing goes live without staff.
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
const MAX_INJECT = 4;

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
  return rows
    .filter((r) => (activeOnly ? r.active !== false : true))
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

  // Thumbs-up can seed a learned example from the successful reply itself.
  if (rate === 'up' && row.inbound_excerpt && row.reply_excerpt) {
    await upsertLearned({
      db,
      persist,
      question: row.inbound_excerpt,
      answer: row.reply_excerpt,
      sourceFeedbackId: row.id,
      createdBy,
      autoActive: true,
    });
  }

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

  const learned = await upsertLearned({
    db,
    persist,
    question,
    answer,
    sourceFeedbackId: current.id,
    createdBy: actor,
    autoActive: true,
  });
  if (!learned.ok) return learned;

  const row = db.update(FEEDBACK_COLLECTION, current.id, {
    status: FEEDBACK_APPROVED,
    alternative: answer,
    approved_by: actor || '',
    approved_at: new Date().toISOString(),
    learned_id: learned.row?.id || null,
  });
  if (row && persist) await persist(FEEDBACK_COLLECTION, row);
  return { ok: true, row, learned: learned.row };
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
  const row = db.update(LEARNED_COLLECTION, id, { active: !!active, updated_at: new Date().toISOString() });
  if (!row) return { ok: false, error: 'לא נמצא' };
  if (persist) await persist(LEARNED_COLLECTION, row);
  return { ok: true, row };
}

export function matchLearnedReplies(db, incomingText, { limit = MAX_INJECT } = {}) {
  const q = String(incomingText || '').trim();
  if (!q) return [];
  return listLearned(db, { activeOnly: true })
    .map((row) => ({ row, score: textOverlapScore(q, row.question) }))
    .filter((x) => x.score >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.row);
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

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker', 'reaction']);

/**
 * Is this inbound message a question a reply could ever be learned from?
 *
 * A 🙏 reaction reached the queue as "the customer's question", next to a staff
 * reply of "אוי, שירגיש טוב ❤️" — approving that would teach the bot to answer
 * an emoji with a get-well message. Reactions are conversation metadata, and a
 * photo is something the model never even sees.
 */
function isAnswerableQuestion(message) {
  const type = String(message?.message_type || '').toLowerCase();
  if (MEDIA_TYPES.has(type)) return false;
  const text = String(message?.message || message?.body || '').trim();
  if (!text) return false;
  if (/^ריאקציה:/u.test(text)) return false;
  // The stored placeholder for media that arrived with no caption.
  if (/^\[[^\]\r\n]+\]$/u.test(text)) return false;
  return true;
}

/**
 * The last thing the bot actually answered before it handed over. The handoff
 * acknowledgement itself ("מעבירים אתכם לצוות") is not an answer — it is the
 * bot saying it has none, and it is written with `source: 'bot_control'`.
 */
function lastBotAnswer(messages, handoffAt) {
  const answer = [...messages].reverse().find((m) => m.direction === 'outbound'
    && m.is_ai
    && String(m.source || '') !== 'bot_control'
    && Date.parse(m.created_at || '') <= handoffAt + 60_000);
  return answer ? String(answer.message || answer.body || '') : '';
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
  const normalized = normalizeWaPhone(phone) || phone;
  if (!normalized || !String(staffText || '').trim()) return { ok: false, skipped: true };

  const parents = (db.get('parents') || []).filter((p) => phonesMatch(p.phone, normalized));
  const card = parent || parents[0];
  if (!card?.bot_handoff_at) return { ok: false, skipped: true, reason: 'no_handoff' };

  const handoffAt = Date.parse(card.bot_handoff_at);
  if (!Number.isFinite(handoffAt)) return { ok: false, skipped: true };

  const messages = (db.get('messages') || [])
    .filter((m) => phonesMatch(m.phone || '', normalized))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  const inbound = [...messages]
    .reverse()
    .find((m) => m.direction === 'inbound'
      && Date.parse(m.created_at || '') <= handoffAt + 60_000
      && isAnswerableQuestion(m));
  if (!inbound) return { ok: false, skipped: true, reason: 'no_inbound' };

  return recordFeedback({
    db,
    persist,
    messageId: `handoff-${inbound.id || handoffAt}`,
    parentId: card.id || null,
    phone: normalized,
    rating: 'down',
    alternative: staffText,
    // What the bot said before it gave up, so the approval screen can show
    // "instead of this — say that". Without it the card asked staff to judge a
    // replacement for an answer they could not see.
    replyExcerpt: lastBotAnswer(messages, handoffAt),
    inboundExcerpt: inbound.message || inbound.body || '',
    note: 'הוצע אוטומטית מתשובת צוות אחרי העברה',
    createdBy,
  });
}
