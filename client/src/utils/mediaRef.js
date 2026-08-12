// Reading half of server/channels/mediaRef.js. Deliberately duplicated — the
// client cannot import from server/, and the panel only ever needs to answer
// "does this bubble carry a file, and what should the placeholder say".
// The encoding side stays on the server; the browser never builds a reference.

/** Types whose row carries a file. 'text' / 'interactive' / 'reaction' do not. */
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker', 'voice']);

/**
 * The media kind of a message, or '' when it carries no file.
 *
 * mergeThread mixes two collections that disagree on the field name: durable
 * `messages` rows use `media_type`, the local `whatsapp_logs` mirror uses
 * `message_type`. Reading only one of them is the bug this replaces.
 */
export function mediaKindOf(message = {}) {
  const type = String(message.media_type || message.message_type || '').toLowerCase();
  if (!MEDIA_TYPES.has(type)) return '';
  // A voice note is an audio file with a different name in some payloads.
  return type === 'voice' ? 'audio' : type;
}

/** True when the row points at bytes we can actually fetch. */
export function hasStoredMedia(message = {}) {
  return !!String(message.media_url || '').trim();
}

/** One query key off the reference, or '' when it is not there. */
function refParam(message, key) {
  const raw = String(message.media_url || '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) return '';
  try {
    const queryAt = raw.indexOf('?');
    if (queryAt === -1) return '';
    return new URLSearchParams(raw.slice(queryAt + 1)).get(key) || '';
  } catch (_) {
    return '';
  }
}

/** The filename to show, when the reference carries one. */
export function mediaFilenameOf(message = {}) {
  const raw = String(message.media_url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    const path = raw.split('?')[0];
    try {
      return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1) || '');
    } catch (_) {
      return '';
    }
  }
  return refParam(message, 'name');
}

/**
 * The Meta id of the bubble this message quotes, or '' when it quotes nothing.
 *
 * The `meta` column is where this lives. Rows written in the few hours before
 * that column existed carry it as a query key on media_url instead, so both are
 * read and the column wins.
 */
export function replyTargetOf(message = {}) {
  return message.meta?.reply_to || refParam(message, 'reply_to');
}

/** The Meta id of the bubble this reaction belongs to. */
export function reactionTargetOf(message = {}) {
  return message.meta?.reaction_to || refParam(message, 'reaction_to');
}

/** True when the row is a reaction — it belongs on another bubble, not on its own. */
export function isReactionRow(message = {}) {
  const type = String(message.media_type || message.message_type || '').toLowerCase();
  return type === 'reaction';
}

/** The emoji inside a stored reaction row ('ריאקציה: 👍'), or '' when removed. */
export function reactionEmojiOf(message = {}) {
  const body = String(message.message || message.body || '').trim();
  const match = body.match(/^ריאקציה:\s*(.+)$/u);
  return match ? match[1].trim() : '';
}

const KIND_LABELS = {
  image: { icon: '📷', noun: 'תמונה' },
  sticker: { icon: '🩹', noun: 'סטיקר' },
  video: { icon: '🎬', noun: 'סרטון' },
  audio: { icon: '🎤', noun: 'הודעה קולית' },
  document: { icon: '📄', noun: 'קובץ' },
};

export function mediaLabel(kind) {
  return KIND_LABELS[kind] || KIND_LABELS.document;
}
