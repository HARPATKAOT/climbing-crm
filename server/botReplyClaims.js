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

export async function claimBotReply(db, replyKey, { phone = '', now = new Date() } = {}) {
  const id = clean(replyKey);
  if (!id) return { claimed: true, id: '', durable: false };
  if ((db.get(BOT_REPLY_CLAIMS) || []).some((row) => String(row.id) === id)) {
    return { claimed: false, id, reason: 'already_claimed' };
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

export async function finishBotReplyClaim(db, persist, replyKey, { messageId = '', now = new Date() } = {}) {
  if (!replyKey) return null;
  const updated = db.update(BOT_REPLY_CLAIMS, replyKey, {
    status: 'sent',
    message_id: messageId || null,
    sent_at: new Date(now).toISOString(),
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
