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

/** The filename to show, when the reference carries one. */
export function mediaFilenameOf(message = {}) {
  const raw = String(message.media_url || '').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) {
      const path = raw.split('?')[0];
      return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1) || '');
    }
    const queryAt = raw.indexOf('?');
    if (queryAt === -1) return '';
    return new URLSearchParams(raw.slice(queryAt + 1)).get('name') || '';
  } catch (_) {
    return '';
  }
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
