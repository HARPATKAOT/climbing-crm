import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMessage,
  toLogRow,
  findStoredMessage,
  isMissingParentError,
  isDuplicateMetaIdError,
  recordMessageDurable,
  flushPendingMessages,
  countPendingMessages,
  rebuildLogMirrorFromMessages,
  setMessageStatusByMetaId,
  applyMessageEditByMetaId,
  applyMessageRevokeByMetaId,
  claimInboundMetaId,
  releaseInboundMetaId,
  clearInboundMetaClaims,
} from './messageStore.js';

/** In-memory stand-in for the local cache + durable store. */
function createStore({ persist, enabled = true } = {}) {
  const tables = { messages: [], whatsapp_logs: [] };
  const persisted = [];
  return {
    tables,
    persisted,
    read: (table) => tables[table] || [],
    mergeLocal: (table, rows) => {
      tables[table] ||= [];
      let added = 0;
      for (const row of rows) {
        const index = tables[table].findIndex((item) => item.id === row.id);
        if (index >= 0) continue;
        tables[table].push(row);
        added += 1;
      }
      return added;
    },
    update: (table, id, patch) => {
      const index = (tables[table] || []).findIndex((item) => item.id === id);
      if (index < 0) return null;
      tables[table][index] = { ...tables[table][index], ...patch };
      return tables[table][index];
    },
    persist: persist || (async (message) => {
      persisted.push(message);
      return { ok: true };
    }),
    isDurableStoreEnabled: () => enabled,
  };
}

test('legacy log fields are normalized into the durable message shape', () => {
  const message = normalizeMessage({
    phone: '972508862878',
    direction: 'inbound',
    message: 'שלום',
    template_id: 't2',
    message_type: 'image',
  });
  assert.equal(message.template_name, 't2');
  assert.equal(message.media_type, 'image');
  assert.equal(message.status, 'received');
  assert.equal(message.source, 'customer');
  assert.ok(message.id);
});

test('the mirror row keeps the field names older screens read', () => {
  const log = toLogRow(normalizeMessage({
    phone: '972508862878',
    template_name: 't2',
    media_type: 'image',
  }));
  assert.equal(log.template_id, 't2');
  assert.equal(log.message_type, 'image');
});

test('two messages created together never share an id', () => {
  const first = normalizeMessage({ message: 'a' });
  const second = normalizeMessage({ message: 'b' });
  assert.notEqual(first.id, second.id);
});

test('a message still waiting for its durable write is not treated as stored', () => {
  const messages = [{ id: 'wh1', meta_message_id: 'wamid.1', _pending_durable: true }];
  const found = findStoredMessage('wamid.1', { messages });
  assert.equal(found.durable, false);
});

test('an inbound message is stored durably before anything else happens', async () => {
  const store = createStore();
  const result = await recordMessageDurable({
    phone: '972508862878',
    direction: 'inbound',
    message: 'היי',
    meta_message_id: 'wamid.abc',
    parent_id: 'p1',
  }, store);

  assert.equal(result.ok, true);
  assert.equal(store.persisted.length, 1);
  assert.equal(store.tables.messages.length, 1);
  assert.equal(store.tables.whatsapp_logs.length, 1);
  assert.equal(countPendingMessages(store), 0);
});

test('a repeated webhook delivery stores one row only', async () => {
  const store = createStore();
  const payload = {
    phone: '972508862878',
    direction: 'inbound',
    message: 'היי',
    meta_message_id: 'wamid.abc',
  };
  await recordMessageDurable(payload, store);
  const second = await recordMessageDurable(payload, store);

  assert.equal(second.duplicate, true);
  assert.equal(store.tables.messages.length, 1);
  assert.equal(store.persisted.length, 1);
});

test('concurrent claim blocks a second handler for the same Meta id', () => {
  clearInboundMetaClaims();
  assert.equal(claimInboundMetaId('wamid.race'), true);
  assert.equal(claimInboundMetaId('wamid.race'), false);
  releaseInboundMetaId('wamid.race');
  assert.equal(claimInboundMetaId('wamid.race'), true);
  clearInboundMetaClaims();
});

test('unique-constraint failure on Meta id is treated as a duplicate', async () => {
  const store = createStore({
    persist: async () => ({
      ok: false,
      error: 'duplicate key value violates unique constraint "messages_meta_message_id_uidx"',
    }),
  });
  const result = await recordMessageDurable({
    phone: '972508862878',
    direction: 'inbound',
    message: 'שלום',
    meta_message_id: 'wamid.uniq',
  }, store);

  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(countPendingMessages(store), 0);
});

test('isDuplicateMetaIdError recognizes Postgres unique errors', () => {
  assert.equal(
    isDuplicateMetaIdError('duplicate key value violates unique constraint "messages_meta_message_id_uidx"'),
    true
  );
  assert.equal(isDuplicateMetaIdError('network down'), false);
});

test('a failed durable write reports failure so the queue does not move', async () => {
  const store = createStore({ persist: async () => ({ ok: false, error: 'network down' }) });
  const result = await recordMessageDurable({
    phone: '972508862878',
    direction: 'inbound',
    message: 'היי',
    meta_message_id: 'wamid.down',
  }, store);

  assert.equal(result.ok, false);
  assert.equal(countPendingMessages(store), 1);
  // The team still sees the message in the conversation.
  assert.equal(store.tables.whatsapp_logs.length, 1);
});

test('a message left pending is recovered on the next flush', async () => {
  let failNext = true;
  const store = createStore({
    persist: async (message) => {
      if (failNext) {
        failNext = false;
        return { ok: false, error: 'network down' };
      }
      store.persisted.push(message);
      return { ok: true };
    },
  });

  await recordMessageDurable({
    phone: '972508862878',
    direction: 'inbound',
    message: 'היי',
    meta_message_id: 'wamid.retry',
  }, store);
  assert.equal(countPendingMessages(store), 1);

  const flushed = await flushPendingMessages(store);
  assert.equal(flushed.recovered, 1);
  assert.equal(countPendingMessages(store), 0);
});

test('a retried webhook can still rescue a message that failed to persist', async () => {
  let failNext = true;
  const store = createStore({
    persist: async () => {
      if (failNext) {
        failNext = false;
        return { ok: false, error: 'network down' };
      }
      return { ok: true };
    },
  });
  const payload = {
    phone: '972508862878',
    direction: 'inbound',
    message: 'היי',
    meta_message_id: 'wamid.rescue',
  };

  const first = await recordMessageDurable(payload, store);
  assert.equal(first.ok, false);

  const retry = await recordMessageDurable(payload, store);
  assert.equal(retry.ok, true);
  assert.equal(store.tables.messages.length, 1);
  assert.equal(countPendingMessages(store), 0);
});

test('a message pointing at a deleted customer card is stored unlinked', async () => {
  const attempts = [];
  const store = createStore({
    persist: async (message) => {
      attempts.push(message.parent_id);
      if (message.parent_id) {
        return { ok: false, error: 'violates foreign key constraint "messages_parent_id_fkey"' };
      }
      return { ok: true };
    },
  });

  const result = await recordMessageDurable({
    phone: '972508862878',
    direction: 'inbound',
    message: 'היי',
    meta_message_id: 'wamid.orphan',
    parent_id: 'p-deleted',
  }, store);

  assert.equal(result.ok, true);
  assert.equal(result.message.parent_id, null);
  assert.deepEqual(attempts, ['p-deleted', null]);
});

test('foreign key rejections are told apart from real outages', () => {
  assert.equal(isMissingParentError('violates foreign key constraint'), true);
  assert.equal(isMissingParentError('network down'), false);
});

test('the conversation mirror is rebuilt from durable messages after a restart', () => {
  const store = createStore();
  store.tables.messages.push(normalizeMessage({
    id: 'wh1',
    phone: '972508862878',
    direction: 'inbound',
    message: 'הודעה מלפני ההפעלה מחדש',
  }));

  const rebuilt = rebuildLogMirrorFromMessages(store);
  assert.equal(rebuilt, 1);
  assert.equal(store.tables.whatsapp_logs[0].message, 'הודעה מלפני ההפעלה מחדש');
  // Running again must not duplicate the thread.
  assert.equal(rebuildLogMirrorFromMessages(store), 0);
});

test('a delivery receipt updates both the durable row and the mirror', async () => {
  const store = createStore();
  await recordMessageDurable({
    phone: '972508862878',
    message: 'שלום',
    meta_message_id: 'wamid.sent',
  }, store);

  setMessageStatusByMetaId('wamid.sent', 'read', store);
  assert.equal(store.tables.messages[0].status, 'read');
  assert.equal(store.tables.whatsapp_logs[0].status, 'read');
});

test('an edit updates the original body and marks edited_at', async () => {
  const store = createStore();
  await recordMessageDurable({
    phone: '972508862878',
    direction: 'outbound',
    message: 'טקסט ישן',
    meta_message_id: 'wamid.orig',
  }, store);

  const edited = applyMessageEditByMetaId('wamid.orig', {
    text: 'טקסט מתוקן',
    at: '2026-08-01T11:00:00.000Z',
  }, store);

  assert.ok(edited);
  assert.equal(store.tables.messages[0].message, 'טקסט מתוקן');
  assert.equal(store.tables.messages[0].edited_at, '2026-08-01T11:00:00.000Z');
  assert.equal(store.tables.whatsapp_logs[0].message, 'טקסט מתוקן');
  assert.equal(store.tables.whatsapp_logs[0].edited_at, '2026-08-01T11:00:00.000Z');
  // Edit event id must not create a second row.
  assert.equal(store.tables.messages.length, 1);
});

test('a revoke marks the original row deleted without removing it', async () => {
  const store = createStore();
  await recordMessageDurable({
    phone: '972508862878',
    direction: 'outbound',
    message: 'למחוק',
    meta_message_id: 'wamid.del',
  }, store);

  const revoked = applyMessageRevokeByMetaId('wamid.del', {
    at: '2026-08-01T11:05:00.000Z',
  }, store);

  assert.ok(revoked);
  assert.equal(store.tables.messages[0].status, 'deleted');
  assert.equal(store.tables.messages[0].deleted_at, '2026-08-01T11:05:00.000Z');
  assert.equal(store.tables.messages[0].message, 'למחוק');
  assert.equal(store.tables.whatsapp_logs[0].status, 'deleted');
  assert.equal(store.tables.messages.length, 1);
});

test('edit and revoke on an unknown meta id are no-ops', () => {
  const store = createStore();
  assert.equal(applyMessageEditByMetaId('wamid.missing', { text: 'x' }, store), null);
  assert.equal(applyMessageRevokeByMetaId('wamid.missing', {}, store), null);
});
