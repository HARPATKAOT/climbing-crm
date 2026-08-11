import crypto from 'crypto';
import { supa } from './supa.js';

export const BOT_REPLY_CLAIMS = 'bot_reply_claims';

function clean(value) {
  return String(value ?? '').trim();
}

export function replyKeyForBurst(phone, items = []) {
  const ids = (Array.isArray(items) ? items : [])
    .map((item) => clean(item?.messageId || `${item?.createdAt || ''}:${item?.text || ''}`))
    .filter(Boolean)
    .sort();
  if (!ids.length) return '';
  const digest = crypto.createHash('sha256').update(`${clean(phone)}|${ids.join('|')}`).digest('hex').slice(0, 32);
  return `br-${digest}`;
}

/**
 * How long a claim may sit half-finished before it is treated as abandoned.
 *
 * A claim is taken before the model runs and closed after the send. If the
 * worker dies in between — a restart, a crashed turn — the row stays "sending"
 * for ever and every later attempt at that same message is refused as already
 * claimed. One customer sat unanswered behind a claim like that: the recovery
 * sweep picked her up, took the claim, lost the worker, and from then on
 * refused itself.
 */
export const CLAIM_STALE_MS = 5 * 60 * 1000;

export function claimIsStale(row, now = Date.now()) {
  if (!row || row.status !== 'sending') return false;
  const at = Date.parse(row.claimed_at || '');
  return !Number.isFinite(at) || now - at > CLAIM_STALE_MS;
}

export async function claimBotReply(db, replyKey, { phone = '', now = new Date() } = {}) {
  const id = clean(replyKey);
  if (!id) return { claimed: true, id: '', durable: false };
  const existing = (db.get(BOT_REPLY_CLAIMS) || []).find((row) => String(row.id) === id);
  if (existing && !claimIsStale(existing, new Date(now).getTime())) {
    return { claimed: false, id, reason: 'already_claimed' };
  }
  if (existing) {
    // Abandoned mid-flight. Clear it so this attempt can take it properly.
    await releaseBotReplyClaim(db, id).catch(() => {});
  }
  const record = {
    id,
    phone: clean(phone),
    status: 'sending',
    claimed_at: new Date(now).toISOString(),
  };
  const durable = await supa.insertOnly(BOT_REPLY_CLAIMS, record);
  if (durable.configured && !durable.ok) {
    return { claimed: false, id, reason: 'already_claimed', error: durable.error || '' };
  }
  const local = db.insert(BOT_REPLY_CLAIMS, record);
  return { claimed: Boolean(local), id, record: local, durable: Boolean(durable.configured) };
}

export async function finishBotReplyClaim(db, persist, replyKey, {
  messageId = '',
  status = 'sent',
  now = new Date(),
} = {}) {
  if (!replyKey) return null;
  const completedAt = new Date(now).toISOString();
  const updated = db.update(BOT_REPLY_CLAIMS, replyKey, {
    status,
    message_id: messageId || null,
    completed_at: completedAt,
    ...(status === 'sent' ? { sent_at: completedAt } : {}),
  });
  if (updated && typeof persist === 'function') await persist(BOT_REPLY_CLAIMS, updated);
  return updated;
}

export async function releaseBotReplyClaim(db, replyKey) {
  if (!replyKey) return true;
  if (typeof db.deleteDurable === 'function') {
    const result = await db.deleteDurable(BOT_REPLY_CLAIMS, replyKey);
    return result?.ok !== false;
  }
  db.delete(BOT_REPLY_CLAIMS, replyKey);
  await supa.remove(BOT_REPLY_CLAIMS, replyKey);
  return true;
}
