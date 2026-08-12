// Single write path for every stored message (inbound, outbound, phone echo, history).
//
// The durable `messages` table in Supabase is the source of truth. `whatsapp_logs`
// is kept as a local-only mirror in the shape older screens and the bot history
// still expect, and it is rebuilt from `messages` when the server boots.
//
// A message that fails its durable write stays flagged locally and is retried in
// the background, so the conversation view and the durable store cannot diverge.

import { db, persistCore } from '../db.js';
import { supa } from '../supa.js';
import { noteMessagesChanged } from '../liveUpdates.js';

const PENDING_FLAG = '_pending_durable';
const RETRY_INTERVAL_MS = 30_000;

/** In-process lock so two webhook deliveries of the same Meta id cannot both reply. */
const inboundInflight = new Set();

let retryTimer = null;

/**
 * Claim an inbound Meta message id before any await.
 * Returns false when another handler is already processing the same id.
 * Messages without a Meta id cannot be deduped this way — always allowed.
 */
export function claimInboundMetaId(metaMessageId) {
  if (!metaMessageId) return true;
  if (inboundInflight.has(metaMessageId)) return false;
  inboundInflight.add(metaMessageId);
  return true;
}

export function releaseInboundMetaId(metaMessageId) {
  if (metaMessageId) inboundInflight.delete(metaMessageId);
}

/** Test helper — clear leftover claims between cases. */
export function clearInboundMetaClaims() {
  inboundInflight.clear();
}

/** Live wiring. Tests pass their own store instead. */
const liveStore = {
  read: (table) => db.get(table) || [],
  mergeLocal: (table, rows) => db.mergeLocal(table, rows),
  update: (table, id, patch) => db.update(table, id, patch),
  persist: (message) => persistCore('messages', message),
  isDurableStoreEnabled: () => supa.isEnabled(),
};

function newMessageId() {
  // Random suffix: two messages in the same millisecond must not share an id.
  return `wh${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
}

/** One canonical shape for every message we store. Matches the `messages` columns. */
export function normalizeMessage(input = {}) {
  const direction = input.direction === 'inbound' ? 'inbound' : 'outbound';
  return {
    id: input.id || newMessageId(),
    parent_id: input.parent_id || null,
    student_id: input.student_id || null,
    channel: input.channel || 'whatsapp',
    direction,
    message: input.message || '',
    media_url: input.media_url || null,
    media_type: input.media_type || input.message_type || 'text',
    template_name: input.template_name || input.template_id || null,
    status: input.status || (direction === 'inbound' ? 'received' : 'sent'),
    source: input.source || (direction === 'inbound' ? 'customer' : 'crm'),
    is_ai: !!input.is_ai,
    meta_message_id: input.meta_message_id || null,
    phone: input.phone || input.recipient_id || '',
    recipient_id: input.recipient_id || null,
    edited_at: input.edited_at || null,
    deleted_at: input.deleted_at || null,
    // What this message points at: reply_to / reaction_to, both wamids. Kept
    // out of media_url so that column means one thing again — where the file is.
    meta: normalizeMessageMeta(input.meta),
    created_at: input.created_at || new Date().toISOString(),
  };
}

/** Only the keys we know, and null rather than an empty object. */
export function normalizeMessageMeta(input) {
  if (!input || typeof input !== 'object') return null;
  const meta = {};
  if (input.reply_to || input.replyTo) meta.reply_to = String(input.reply_to || input.replyTo);
  if (input.reaction_to || input.reactionTo) meta.reaction_to = String(input.reaction_to || input.reactionTo);
  return Object.keys(meta).length ? meta : null;
}

/** Local mirror row in the legacy `whatsapp_logs` shape. */
export function toLogRow(message) {
  return {
    id: message.id,
    phone: message.phone || '',
    channel: message.channel || 'whatsapp',
    direction: message.direction || 'outbound',
    message: message.message || '',
    status: message.status || 'sent',
    is_ai: !!message.is_ai,
    source: message.source || 'crm',
    meta_message_id: message.meta_message_id || null,
    template_id: message.template_name || null,
    message_type: message.media_type || 'text',
    media_url: message.media_url || null,
    parent_id: message.parent_id || null,
    student_id: message.student_id || null,
    edited_at: message.edited_at || null,
    deleted_at: message.deleted_at || null,
    meta: message.meta || null,
    created_at: message.created_at,
  };
}

/** A write rejected because the customer card it points at is gone. */
export function isMissingParentError(error) {
  return /foreign key|messages_parent_id_fkey/i.test(String(error || ''));
}

/** Unique index on meta_message_id rejected a second durable insert. */
export function isDuplicateMetaIdError(error) {
  return /messages_meta_message_id|duplicate key|unique constraint/i.test(String(error || ''));
}

/**
 * Look for a message we already stored, by Meta id.
 * `durable` is false while the record still waits for its Supabase write.
 */
export function findStoredMessage(metaMessageId, { messages = [], logs = [] } = {}) {
  if (!metaMessageId) return null;
  const stored = messages.find((m) => m.meta_message_id === metaMessageId);
  if (stored) return { message: stored, durable: !stored[PENDING_FLAG] };
  // Legacy rows written before the unified store — already persisted in kv_collections.
  const legacy = logs.find((l) => l.meta_message_id === metaMessageId);
  if (legacy) return { message: legacy, durable: true };
  return null;
}

export function findMessageByMetaId(metaMessageId, store = liveStore) {
  return findStoredMessage(metaMessageId, {
    messages: store.read('messages'),
    logs: store.read('whatsapp_logs'),
  });
}

export function newerInboundMessage(rows = [], { parentId = '', phone = '', after = '' } = {}) {
  const afterMs = Date.parse(String(after || ''));
  if (!Number.isFinite(afterMs)) return null;
  const phoneVariants = new Set(supa.phoneVariants(phone).map(String));
  return (rows || []).find((row) => {
    if (row?.direction !== 'inbound' || row?.deleted_at || row?.status === 'deleted') return false;
    const belongsToThread = (parentId && String(row?.parent_id || '') === String(parentId))
      || (phoneVariants.size && phoneVariants.has(String(row?.phone || '')));
    return belongsToThread && Date.parse(String(row?.created_at || '')) > afterMs;
  }) || null;
}

/**
 * The in-memory burst coordinator cannot see a second webhook that reached a
 * different server instance during a rolling deploy. Check the durable thread
 * before sending a completed draft, so the newer customer bubble always owns
 * the eventual answer across every instance.
 */
export async function hasNewerDurableInbound({ parentId = '', phone = '', after = '' } = {}) {
  const local = newerInboundMessage(liveStore.read('messages'), { parentId, phone, after });
  if (local) return true;
  if (!supa.isEnabled()) return false;
  const durable = await supa.getMessagesForParent({ parentId, phone });
  return !!newerInboundMessage(durable || [], { parentId, phone, after });
}

function storeLocal(message, { pending = false } = {}, store = liveStore) {
  const record = pending ? { ...message, [PENDING_FLAG]: true } : message;
  store.mergeLocal('messages', [record]);
  store.mergeLocal('whatsapp_logs', [toLogRow(record)]);
  // Every message — inbound, outbound, bot — passes through here, so this is
  // the one place an open conversation panel needs to hear about.
  noteMessagesChanged();
  return record;
}

function clearPendingFlag(id, store = liveStore) {
  const stored = store.read('messages').find((m) => m.id === id);
  if (!stored || !stored[PENDING_FLAG]) return;
  store.update('messages', id, { [PENDING_FLAG]: false });
}

/**
 * Persist a message, and never lose it over a stale customer card reference:
 * a merged-away parent_id is dropped and the message is stored unlinked.
 */
async function persistMessage(message, store = liveStore) {
  const result = await store.persist(message);
  if (result?.ok !== false) return { ok: true, message };
  if (!message.parent_id || !isMissingParentError(result.error)) {
    return { ok: false, error: result.error, message };
  }

  console.warn(
    `message ${message.id} points at a customer card that no longer exists — storing it unlinked`
  );
  const unlinked = { ...message, parent_id: null };
  const retry = await store.persist(unlinked);
  if (retry?.ok === false) return { ok: false, error: retry.error, message: unlinked };
  return { ok: true, message: unlinked };
}

/** How many messages are still waiting for their durable write. */
export function countPendingMessages(store = liveStore) {
  return store.read('messages').filter((m) => m[PENDING_FLAG]).length;
}

/** Retry every message whose durable write did not go through yet. */
export async function flushPendingMessages(store = liveStore) {
  if (!store.isDurableStoreEnabled()) return { attempted: 0, recovered: 0 };
  const pending = store.read('messages').filter((m) => m[PENDING_FLAG]);
  let recovered = 0;
  for (const message of pending) {
    const result = await persistMessage(message, store);
    if (result.ok) {
      clearPendingFlag(message.id, store);
      recovered += 1;
    }
  }
  if (recovered) {
    console.log(`🩹 Recovered ${recovered} message(s) into the durable store`);
  }
  return { attempted: pending.length, recovered };
}

/** Background retry loop — safe to call more than once. */
export function startPendingMessageRetry(intervalMs = RETRY_INTERVAL_MS) {
  if (retryTimer) return retryTimer;
  retryTimer = setInterval(() => {
    flushPendingMessages().catch((err) =>
      console.error('flushPendingMessages failed:', err.message)
    );
  }, intervalMs);
  if (retryTimer.unref) retryTimer.unref();
  return retryTimer;
}

export function stopPendingMessageRetry() {
  if (!retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

/**
 * Store a message without waiting for the durable write.
 * Use for outbound traffic, where the send itself already succeeded or failed.
 */
export function recordMessage(input = {}, store = liveStore) {
  const message = normalizeMessage(input);
  const existing = findMessageByMetaId(message.meta_message_id, store);
  if (existing?.durable) return existing.message;

  if (!store.isDurableStoreEnabled()) return storeLocal(message, {}, store);

  const stored = storeLocal(message, { pending: true }, store);
  persistMessage(message, store)
    .then((result) => {
      if (!result.ok) {
        console.error('message durable write failed:', result.error);
        return;
      }
      clearPendingFlag(message.id, store);
    })
    .catch((err) => console.error('message durable write failed:', err.message));
  return stored;
}

/**
 * Store a message and wait for the durable write.
 * Use for inbound traffic: the handling queue may only move after this succeeds.
 */
export async function recordMessageDurable(input = {}, store = liveStore) {
  const message = normalizeMessage(input);
  const existing = findMessageByMetaId(message.meta_message_id, store);
  if (existing?.durable) {
    return { ok: true, duplicate: true, message: existing.message };
  }

  // Retrying a message we already saw: persist the stored copy, keep its id.
  const target = existing?.message || message;

  if (!store.isDurableStoreEnabled()) {
    return { ok: true, durable: false, message: storeLocal(target, {}, store) };
  }

  const result = await persistMessage(target, store);
  if (!result.ok) {
    // Another process already stored this Meta id — treat as handled, do not reply again.
    if (message.meta_message_id && isDuplicateMetaIdError(result.error)) {
      const winner = findMessageByMetaId(message.meta_message_id, store);
      return {
        ok: true,
        duplicate: true,
        message: winner?.message || target,
      };
    }
    console.error('inbound message durable write failed:', result.error);
    return {
      ok: false,
      error: result.error,
      message: storeLocal(target, { pending: true }, store),
      duplicate: !!existing,
    };
  }

  storeLocal(result.message, {}, store);
  clearPendingFlag(result.message.id, store);
  return { ok: true, durable: true, message: result.message, duplicate: !!existing };
}

/** Keep delivery/read receipts aligned across the durable table and the mirror. */
export function setMessageStatusByMetaId(metaMessageId, status, store = liveStore) {
  if (!metaMessageId || !status) return;
  const stored = store.read('messages').find((m) => m.meta_message_id === metaMessageId);
  if (stored) store.update('messages', stored.id, { status });
  const log = store.read('whatsapp_logs').find((l) => l.meta_message_id === metaMessageId);
  if (log) store.update('whatsapp_logs', log.id, { status });
}

/**
 * Apply a WhatsApp edit (coexistence / customer) onto the original row.
 * Looks up by Meta id of the original message, not the edit event id.
 */
export function applyMessageEditByMetaId(originalMetaId, { text, at } = {}, store = liveStore) {
  if (!originalMetaId) return null;
  const found = findMessageByMetaId(originalMetaId, store);
  if (!found?.message) return null;

  const editedAt = at || new Date().toISOString();
  const patch = {
    message: text != null ? String(text) : found.message.message,
    edited_at: editedAt,
    updated_at: editedAt,
  };
  // A deleted message that is later edited (rare) should still show as deleted.
  const updated = store.update('messages', found.message.id, patch)
    || { ...found.message, ...patch };
  const log = store.read('whatsapp_logs').find((l) => l.id === found.message.id
    || l.meta_message_id === originalMetaId);
  if (log) {
    store.update('whatsapp_logs', log.id, {
      message: patch.message,
      edited_at: editedAt,
    });
  }

  if (store.isDurableStoreEnabled()) {
    persistMessage(updated, store).catch((err) =>
      console.error('message edit durable write failed:', err.message)
    );
  }
  return updated;
}

/**
 * Apply a WhatsApp revoke (delete for everyone) onto the original row.
 * The row stays so the conversation panel can show "הודעה זו נמחקה".
 */
export function applyMessageRevokeByMetaId(originalMetaId, { at } = {}, store = liveStore) {
  if (!originalMetaId) return null;
  const found = findMessageByMetaId(originalMetaId, store);
  if (!found?.message) return null;

  const deletedAt = at || new Date().toISOString();
  const patch = {
    status: 'deleted',
    deleted_at: deletedAt,
    updated_at: deletedAt,
  };
  const updated = store.update('messages', found.message.id, patch)
    || { ...found.message, ...patch };
  const log = store.read('whatsapp_logs').find((l) => l.id === found.message.id
    || l.meta_message_id === originalMetaId);
  if (log) {
    store.update('whatsapp_logs', log.id, {
      status: 'deleted',
      deleted_at: deletedAt,
    });
  }

  if (store.isDurableStoreEnabled()) {
    persistMessage(updated, store).catch((err) =>
      console.error('message revoke durable write failed:', err.message)
    );
  }
  return updated;
}

/** Rebuild the local `whatsapp_logs` mirror from durable messages (boot time). */
export function rebuildLogMirrorFromMessages(store = liveStore) {
  const messages = store.read('messages');
  if (!messages.length) return 0;
  return store.mergeLocal('whatsapp_logs', messages.map(toLogRow));
}
