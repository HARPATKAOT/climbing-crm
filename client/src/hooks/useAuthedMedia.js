import { useEffect, useState } from 'react';

// An <img src="/api/…"> carries no Authorization header — the fetch wrapper in
// main.jsx only touches window.fetch, not tag loads. So media is fetched as a
// blob and rendered from an object URL, the same way document downloads work.
//
// The cache has to live outside React. useLiveMessages replaces the whole
// messages array on every stored message, so every bubble remounts with fresh
// object identities; without a module-level cache the entire thread would
// re-download and visibly flicker each time anyone sends a message.

const MAX_CACHED = 60;

/** messageKey → { url, mimeType } */
const cache = new Map();
/** messageKey → Promise, so two bubbles for one id do not both fetch. */
const inFlight = new Map();

function evictOldest() {
  while (cache.size > MAX_CACHED) {
    const [oldestKey, entry] = cache.entries().next().value;
    cache.delete(oldestKey);
    try {
      URL.revokeObjectURL(entry.url);
    } catch (_) { /* already revoked */ }
  }
}

function keyFor(parentId, messageId) {
  return `${parentId}::${messageId}`;
}

/** Drop a cached blob so the next render re-fetches it (used after a resend). */
export function forgetMedia(parentId, messageId) {
  const key = keyFor(parentId, messageId);
  const entry = cache.get(key);
  if (!entry) return;
  cache.delete(key);
  try {
    URL.revokeObjectURL(entry.url);
  } catch (_) { /* already revoked */ }
}

async function loadMedia(parentId, messageId) {
  const key = keyFor(parentId, messageId);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const request = (async () => {
    const res = await fetch(
      `/api/conversations/${encodeURIComponent(parentId)}/media/${encodeURIComponent(messageId)}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const error = new Error(body.error || 'טעינת הקובץ נכשלה');
      error.reason = body.reason || 'failed';
      throw error;
    }
    const blob = await res.blob();
    const entry = { url: URL.createObjectURL(blob), mimeType: blob.type || '' };
    cache.set(key, entry);
    evictOldest();
    return entry;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

/**
 * Fetch the file behind one message. Nothing happens until `enabled` is true,
 * so images load when they scroll into view and a video only on click.
 */
export function useAuthedMedia(parentId, messageId, enabled = true) {
  const key = parentId && messageId ? keyFor(parentId, messageId) : '';
  const cached = key ? cache.get(key) : null;
  const [state, setState] = useState(
    cached ? { url: cached.url, loading: false, error: '', reason: '' } : { url: '', loading: false, error: '', reason: '' }
  );

  useEffect(() => {
    if (!enabled || !parentId || !messageId) return undefined;

    const hit = cache.get(keyFor(parentId, messageId));
    if (hit) {
      setState({ url: hit.url, loading: false, error: '', reason: '' });
      return undefined;
    }

    let alive = true;
    setState({ url: '', loading: true, error: '', reason: '' });
    loadMedia(parentId, messageId)
      .then((entry) => {
        if (alive) setState({ url: entry.url, loading: false, error: '', reason: '' });
      })
      .catch((err) => {
        if (alive) setState({ url: '', loading: false, error: err.message, reason: err.reason || 'failed' });
      });
    return () => { alive = false; };
  }, [parentId, messageId, enabled]);

  return state;
}
