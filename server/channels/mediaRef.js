// One string format for "where the bytes of this message live".
//
// The `messages` table cannot grow columns from here (no migration access), and
// `media_url` was already carrying three different things: a bare Meta media id
// from sendImageMessage, a public https link from sendDocumentMessage, and null.
// Rather than add a fourth unwritten convention, everything is encoded here:
//
//   wa-media:<metaMediaId>?mime=image%2Fjpeg&name=IMG_1234.jpg
//   storage:wa-media/2026/08/wh123.pdf?mime=application%2Fpdf&name=חשבונית.pdf
//   https://…                       public link — left exactly as it was
//   1234567890                      legacy bare Meta id, read as wa-media:
//
// `media_type` keeps holding the WhatsApp type word ('image' / 'document' / …)
// and is never overloaded with a mime type.

const META_SCHEME = 'wa-media:';
const STORAGE_SCHEME = 'storage:';

/** Meta ids are long digit strings. Anything else is not a legacy bare id. */
const BARE_META_ID = /^\d{6,}$/;

const MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

/** File extension for a mime type, without the dot. 'bin' when unknown. */
export function mediaExtensionForMime(mimeType) {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXTENSIONS[clean]) return MIME_EXTENSIONS[clean];
  const tail = clean.split('/')[1] || '';
  // image/heic → heic, but never a whole vendor tree as a "extension".
  return /^[a-z0-9]{1,5}$/.test(tail) ? tail : 'bin';
}

/**
 * WhatsApp message type for a mime type. WhatsApp routes on the type word, not
 * on the mime, and rejects a payload whose two disagree.
 */
export function mediaKindForMime(mimeType) {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  // A webp goes out as a sticker; sent as an image WhatsApp rejects it.
  if (clean === 'image/webp') return 'sticker';
  if (clean.startsWith('image/')) return 'image';
  if (clean.startsWith('video/')) return 'video';
  if (clean.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Build the stored `media_url` string. Returns null when there is nothing to
 * point at — including when the caller passes null outright, which is the
 * ordinary case: every text message has no media reference at all.
 */
export function encodeMediaRef(ref) {
  const { kind, id, mime, filename } = ref || {};
  const target = String(id || '').trim();
  if (!target) return null;

  // A public link is stored verbatim — appending our own params would corrupt
  // a URL that already has a query, and parseMediaRef reads none off a link.
  if (kind === 'link') return target;

  const base = kind === 'storage' ? `${STORAGE_SCHEME}${target}` : `${META_SCHEME}${target}`;
  const params = [];
  if (mime) params.push(`mime=${encodeURIComponent(String(mime).split(';')[0].trim())}`);
  if (filename) params.push(`name=${encodeURIComponent(filename)}`);
  return params.length ? `${base}?${params.join('&')}` : base;
}

/**
 * Read a stored `media_url` back.
 * Returns { kind, id, mime, filename } — or null when the row points nowhere.
 * Never throws: this runs on every message the panel renders.
 */
export function parseMediaRef(mediaUrl) {
  const raw = String(mediaUrl || '').trim();
  if (!raw) return null;

  try {
    // A public https link owns its own query string — a `name=` in there belongs
    // to whoever built the link, not to us. Pass it through whole and read the
    // filename off the path instead.
    if (/^https?:\/\//i.test(raw)) {
      const path = raw.split('?')[0];
      return {
        kind: 'link',
        id: raw,
        mime: '',
        filename: decodeURIComponent(path.slice(path.lastIndexOf('/') + 1) || ''),
      };
    }

    const queryAt = raw.indexOf('?');
    const head = queryAt === -1 ? raw : raw.slice(0, queryAt);
    const params = new URLSearchParams(queryAt === -1 ? '' : raw.slice(queryAt + 1));
    const mime = params.get('mime') || '';
    const filename = params.get('name') || '';

    if (head.startsWith(STORAGE_SCHEME)) {
      const id = head.slice(STORAGE_SCHEME.length);
      return id ? { kind: 'storage', id, mime, filename } : null;
    }
    if (head.startsWith(META_SCHEME)) {
      const id = head.slice(META_SCHEME.length);
      return id ? { kind: 'meta', id, mime, filename } : null;
    }
    // Legacy rows from sendImageMessage stored the bare Meta media id.
    if (BARE_META_ID.test(head)) return { kind: 'meta', id: head, mime, filename };
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Storage path for media we mirror into the client-documents bucket.
 * Dated folders keep the bucket listable once there are thousands of files.
 */
export function storagePathForMedia(messageId, mimeType, { at = new Date() } = {}) {
  const safeId = String(messageId || '').replace(/[^A-Za-z0-9_-]/g, '') || `m${Date.now()}`;
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');
  return `wa-media/${year}/${month}/${safeId}.${mediaExtensionForMime(mimeType)}`;
}

/** Types whose row carries a file. 'text' / 'interactive' / 'reaction' do not. */
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker', 'voice']);

/** The media kind of a stored row, reading either collection's field name. */
export function mediaKindOfRow(row = {}) {
  const type = String(row.media_type || row.message_type || '').toLowerCase();
  return MEDIA_TYPES.has(type) ? type : '';
}
