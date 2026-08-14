export const PUBLIC_REDIRECT_SECURITY_COLLECTION = 'security_runtime';
export const PUBLIC_REDIRECT_SECURITY_ID = 'public-redirect-signing-v1';

function validCutoff(value, now) {
  const cutoffMs = Number(value);
  return Number.isSafeInteger(cutoffMs) && cutoffMs > 0 && cutoffMs <= now + 5 * 60 * 1000
    ? cutoffMs
    : 0;
}

/**
 * Freeze the last id that may use the legacy unsigned public-link format.
 * The value is written before the HTTP server starts and reused on every boot,
 * so pre-deployment links keep working while newer raw ids stay invalid.
 */
export async function ensurePublicRedirectLegacyCutoff({
  db,
  persist,
  now = Date.now(),
  requireDurable = false,
} = {}) {
  if (!db?.getOne || !db?.insert || !db?.update) {
    throw new Error('Public redirect migration requires a database');
  }

  const existing = db.getOne(PUBLIC_REDIRECT_SECURITY_COLLECTION, PUBLIC_REDIRECT_SECURITY_ID);
  const storedCutoff = validCutoff(existing?.legacy_cutoff_ms, now);
  if (storedCutoff) return { cutoffMs: storedCutoff, created: false };

  // Subtract one millisecond so records created after this point cannot fall on
  // the compatibility boundary even if the listener starts immediately.
  const cutoffMs = Math.max(1, Math.floor(Number(now)) - 1);
  const record = {
    ...(existing || {}),
    id: PUBLIC_REDIRECT_SECURITY_ID,
    legacy_cutoff_ms: cutoffMs,
    migration: 'signed-public-redirects-v1',
    created_at: existing?.created_at || new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  };
  const saved = existing
    ? db.update(PUBLIC_REDIRECT_SECURITY_COLLECTION, PUBLIC_REDIRECT_SECURITY_ID, record)
    : db.insert(PUBLIC_REDIRECT_SECURITY_COLLECTION, record);
  const durable = typeof persist === 'function'
    ? await persist(PUBLIC_REDIRECT_SECURITY_COLLECTION, saved)
    : { ok: !requireDurable };
  if (durable?.ok === false && requireDurable) {
    throw new Error(`Could not persist public redirect security boundary: ${durable.error || 'unknown error'}`);
  }
  return { cutoffMs, created: true, durable: durable?.ok !== false };
}
