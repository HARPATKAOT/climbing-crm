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

const PENDING_FLAG = '_pending_durable';
const RETRY_INTERVAL_MS = 30_000;

let retryTimer = null;

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
    created_at: input.created_at || new Date().toISOString(),
  };
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
    created_at: message.created_at,
  };
}

/** A write rejected because the customer card it points at is gone. */
export function isMissingParentError(error) {
  return /foreign key|messages_parent_id_fkey/i.test(String(error || ''));
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

function storeLocal(message, { pending = false } = {}, store = liveStore) {
  const record = pending ? { ...message, [PENDING_FLAG]: true } : message;
  store.mergeLocal('messages', [record]);
  store.mergeLocal('whatsapp_logs', [toLogRow(record)]);
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

/** Rebuild the local `whatsapp_logs` mirror from durable messages (boot time). */
export function rebuildLogMirrorFromMessages(store = liveStore) {
  const messages = store.read('messages');
  if (!messages.length) return 0;
  return store.mergeLocal('whatsapp_logs', messages.map(toLogRow));
}
