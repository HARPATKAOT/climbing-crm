/**
 * The live CRM must never run from Render's ephemeral db.json without its
 * durable Supabase store. Local development may still use the fixture file.
 */
export function requiresDurableStore(env = process.env) {
  return env.NODE_ENV === 'production'
    || Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_URL);
}

/**
 * Timers that send messages or mutate live CRM data belong to one production
 * worker only. A local preview often loads the real Supabase/Meta credentials
 * from server/.env, so NODE_ENV=development must never silently become a
 * second scheduler. RUN_SCHEDULED_JOBS remains an explicit maintenance escape
 * hatch in either direction.
 */
export function scheduledJobsEnabled(env = process.env) {
  const explicit = String(env.RUN_SCHEDULED_JOBS || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(explicit)) return true;
  if (['0', 'false', 'no', 'off'].includes(explicit)) return false;
  return env.NODE_ENV === 'production'
    || Boolean(env.RENDER || env.RENDER_SERVICE_ID || env.RENDER_EXTERNAL_URL);
}

export function publicStoreUnavailableError() {
  return {
    status: 503,
    body: {
      error: 'מערכת ההרשמה אינה זמינה זמנית. נא לנסות שוב בעוד מספר דקות.',
      code: 'DURABLE_STORE_UNAVAILABLE',
    },
  };
}
