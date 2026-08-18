import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorMetaMediaNow, sweepUnmirroredMedia } from './mediaMirror.js';

/** In-memory store in the shape mediaMirror expects — never touches db.json. */
function fakeStore(messages = [], logs = []) {
  const tables = { messages, whatsapp_logs: logs };
  const persisted = [];
  return {
    read: (table) => tables[table] || [],
    update: (table, id, patch) => {
      const row = (tables[table] || []).find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
    persist: async (message) => { persisted.push(message); },
    persisted,
  };
}

const VOICE_BYTES = Buffer.from('voice-note-bytes');

function fakeDeps(store, { media, uploads = [] } = {}) {
  return {
    store,
    download: async () => (media === undefined
      ? { buffer: VOICE_BYTES, mimeType: 'audio/ogg' }
      : media),
    upload: async (storagePath) => { uploads.push(storagePath); return { ok: true }; },
  };
}

test('an inbound voice note is copied into storage and the row repointed', async () => {
  const row = { id: 'wh1', media_url: 'wa-media:555001?mime=audio%2Fogg', media_type: 'audio', created_at: new Date().toISOString() };
  const log = { id: 'wh1', media_url: 'wa-media:555001?mime=audio%2Fogg' };
  const store = fakeStore([row], [log]);
  const uploads = [];

  const result = await mirrorMetaMediaNow(row, fakeDeps(store, { uploads }));

  assert.equal(result.mirrored, true);
  assert.match(row.media_url, /^storage:wa-media\//);
  assert.match(row.media_url, /mime=audio%2Fogg/);
  // The legacy mirror row must repoint too — older screens read only it.
  assert.match(log.media_url, /^storage:wa-media\//);
  assert.equal(uploads.length, 1);
  assert.equal(store.persisted.length, 1);
  assert.equal(store.persisted[0].id, 'wh1');
});

test('a message with no file, or one already mirrored, is left alone', async () => {
  const textRow = { id: 'wh2', media_url: null };
  const mirroredRow = { id: 'wh3', media_url: 'storage:wa-media/2026/08/wh3.ogg?mime=audio%2Fogg' };
  const store = fakeStore([textRow, mirroredRow]);

  assert.equal((await mirrorMetaMediaNow(textRow, fakeDeps(store))).reason, 'no_meta_file');
  assert.equal((await mirrorMetaMediaNow(mirroredRow, fakeDeps(store))).reason, 'no_meta_file');
  assert.equal(store.persisted.length, 0);
});

test('a row mirrored by the read path between listing and download is not redone', async () => {
  // The caller holds a stale copy that still says wa-media:, but the store
  // already has the storage ref — the fresh read must win.
  const staleCopy = { id: 'wh4', media_url: 'wa-media:555004' };
  const freshRow = { id: 'wh4', media_url: 'storage:wa-media/2026/08/wh4.ogg' };
  const store = fakeStore([freshRow]);

  const result = await mirrorMetaMediaNow(staleCopy, fakeDeps(store));
  assert.equal(result.mirrored, false);
  assert.equal(result.reason, 'no_meta_file');
});

test('a file Meta already deleted reports unavailable and keeps the original ref', async () => {
  const row = { id: 'wh5', media_url: 'wa-media:555005?mime=audio%2Fogg' };
  const store = fakeStore([row]);

  const result = await mirrorMetaMediaNow(row, fakeDeps(store, { media: null }));

  assert.equal(result.mirrored, false);
  assert.equal(result.reason, 'unavailable');
  assert.equal(row.media_url, 'wa-media:555005?mime=audio%2Fogg');
});

test('the sweep copies only rows that still point at Meta and are inside the window', async () => {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const rows = [
    { id: 'fresh', media_url: 'wa-media:1000001', created_at: new Date(now - 2 * day).toISOString() },
    { id: 'legacy-bare', media_url: '1000002', created_at: new Date(now - 10 * day).toISOString() },
    { id: 'too-old', media_url: 'wa-media:1000003', created_at: new Date(now - 45 * day).toISOString() },
    { id: 'already-stored', media_url: 'storage:wa-media/2026/07/x.ogg', created_at: new Date(now - day).toISOString() },
    { id: 'plain-text', media_url: null, created_at: new Date(now - day).toISOString() },
    { id: 'revoked', media_url: 'wa-media:1000004', status: 'deleted', created_at: new Date(now - day).toISOString() },
  ];
  const store = fakeStore(rows);
  const uploads = [];

  const result = await sweepUnmirroredMedia(fakeDeps(store, { uploads }));

  assert.equal(result.scanned, 2);
  assert.equal(result.mirrored, 2);
  assert.equal(result.gone, 0);
  assert.match(rows[0].media_url, /^storage:/);
  assert.match(rows[1].media_url, /^storage:/);
  assert.equal(rows[2].media_url, 'wa-media:1000003');
  assert.equal(rows[5].media_url, 'wa-media:1000004');
});

test('the sweep counts files Meta deleted without rewriting their rows', async () => {
  const row = { id: 'wh6', media_url: 'wa-media:555006', created_at: new Date().toISOString() };
  const store = fakeStore([row]);

  const result = await sweepUnmirroredMedia(fakeDeps(store, { media: null }));

  assert.equal(result.scanned, 1);
  assert.equal(result.gone, 1);
  assert.equal(result.mirrored, 0);
  assert.equal(row.media_url, 'wa-media:555006');
});
