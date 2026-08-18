// Keeping message files alive past Meta's 30-day deletion.
//
// Meta stores a WhatsApp file (voice note, photo, document) for 30 days and
// then deletes it for good. The CRM used to fetch a file from Meta only when
// someone opened it — so a voice note nobody clicked for a month was lost.
// Copies are made at three points now: the moment a message arrives
// (whatsapp.js), the moment one is opened (conversations.js read path, the
// original behavior), and a periodic sweep (index.js) that catches whatever
// slipped past both — a crash mid-webhook, a storage blip, and every message
// from before this file existed.

import { db, persistCore } from '../db.js';
import { supa } from '../supa.js';
import { downloadWhatsAppMedia } from './media.js';
import { parseMediaRef, encodeMediaRef, storagePathForMedia } from './mediaRef.js';

// Meta's retention is 30 days; past 31 a fetch cannot succeed, so stop trying.
const META_RETENTION_DAYS = 31;
// One sweep never works through more than this many rows — it reruns anyway,
// and a webhook burst must not turn the sweep into a half-hour Meta crawl.
const SWEEP_BATCH_LIMIT = 40;

/** Live wiring. Tests pass their own store instead. */
const liveStore = {
  read: (table) => db.get(table) || [],
  update: (table, id, patch) => db.update(table, id, patch),
  persist: (message) => persistCore('messages', message),
};

const liveUpload = (storagePath, buffer, mimeType) =>
  supa.uploadClientDocument(storagePath, buffer, mimeType);

/**
 * Write fetched bytes into our bucket and repoint the row at the copy.
 * Best effort in every step: callers include a read path, and a failed copy
 * must never turn a working preview into an error.
 */
export async function saveMediaCopy(row, buffer, mimeType, filename, deps = {}) {
  const store = deps.store || liveStore;
  const upload = deps.upload || liveUpload;
  try {
    if (!buffer?.length) return false;
    const storagePath = storagePathForMedia(row.id, mimeType);
    const uploaded = await upload(storagePath, buffer, mimeType);
    if (uploaded?.ok === false) return false;

    const mediaUrl = encodeMediaRef({ kind: 'storage', id: storagePath, mime: mimeType, filename });
    // Both collections carry media_url under the same name, and mergeThread reads
    // whichever it finds — so a half-done rewrite would still be consistent.
    const updated = store.update('messages', row.id, { media_url: mediaUrl });
    store.update('whatsapp_logs', row.id, { media_url: mediaUrl });
    if (updated) await store.persist(updated);
    return true;
  } catch (err) {
    console.warn(`mirroring media for message ${row?.id} failed:`, err.message);
    return false;
  }
}

/**
 * Copy one message's file off Meta into our own storage, right now.
 * Quiet no-op for rows that carry no file or are already mirrored.
 */
export async function mirrorMetaMediaNow(rowLike, deps = {}) {
  const store = deps.store || liveStore;
  const download = deps.download || downloadWhatsAppMedia;

  // Read the row fresh: the open-on-read path may have mirrored it meanwhile,
  // and mirroring twice would repoint media_url at a second, identical copy.
  const row = store.read('messages').find((m) => m.id === rowLike?.id) || rowLike;
  const ref = parseMediaRef(row?.media_url);
  if (ref?.kind !== 'meta' || !ref.id) return { mirrored: false, reason: 'no_meta_file' };

  const media = await download(ref.id);
  if (!media?.buffer?.length) return { mirrored: false, reason: 'unavailable' };

  const mimeType = media.mimeType || ref.mime || 'application/octet-stream';
  const saved = await saveMediaCopy(row, media.buffer, mimeType, ref.filename, deps);
  return saved ? { mirrored: true } : { mirrored: false, reason: 'upload_failed' };
}

/**
 * Mirror every stored message whose file still lives only on Meta.
 *
 * Newest first: the sweep is capped per run, and a file sent yesterday has a
 * month of chances left while one sent four weeks ago is about to vanish —
 * but a fresh row is also the one a customer is most likely to open today.
 * Rows past Meta's retention window are skipped outright; their files are
 * gone and the read path already explains that to the user.
 */
export async function sweepUnmirroredMedia(deps = {}) {
  const store = deps.store || liveStore;
  const cutoff = Date.now() - META_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const candidates = store.read('messages')
    .filter((m) => m.status !== 'deleted' && !m.deleted_at)
    .filter((m) => parseMediaRef(m.media_url)?.kind === 'meta')
    .filter((m) => {
      const ts = Date.parse(m.created_at || '');
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .sort((a, b) => (Date.parse(b.created_at || 0) || 0) - (Date.parse(a.created_at || 0) || 0))
    .slice(0, SWEEP_BATCH_LIMIT);

  const result = { scanned: candidates.length, mirrored: 0, gone: 0, failed: 0 };
  // One at a time on purpose — this is a background chore, and it must not
  // race the webhook path for Meta's rate limit or the storage bucket.
  for (const row of candidates) {
    const one = await mirrorMetaMediaNow(row, deps);
    if (one.mirrored) result.mirrored += 1;
    else if (one.reason === 'unavailable') result.gone += 1;
    else if (one.reason !== 'no_meta_file') result.failed += 1;
  }
  return result;
}
