/**
 * The live CRM must never run from Render's ephemeral db.json without its
 * durable Supabase store. Local development may still use the fixture file.
 */
export function requiresDurableStore(env = process.env) {
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
