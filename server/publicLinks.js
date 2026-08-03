/**
 * Hosts for links that get frozen inside approved Meta templates.
 *
 * Meta locks a template's button URL the moment it is approved, so a button
 * that points straight at the site has to be re-approved every time the site
 * moves to another domain. Instead the button points at the API, and the API
 * resolves the real destination on each click — the site can move freely and
 * links already sitting in customers' phones keep working.
 *
 * That only holds while the API host itself stays put, which is why it is a
 * deliberate constant here rather than something derived from the request.
 */

export const LIVE_API_BASE = 'https://climbing-crm-api.onrender.com';
export const LIVE_APP_BASE = 'https://app.kirboaz.co.il';

export function isLocalOrigin(origin) {
  try {
    const host = new URL(String(origin || '')).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
  } catch {
    return true;
  }
}

/**
 * Host for the frozen button. Must be the live API even when a staff machine
 * runs locally — seeding a template with a localhost button would burn it.
 */
export function apiRedirectBase() {
  const explicit = String(process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit && !isLocalOrigin(explicit) && explicit.startsWith('https://')) return explicit;
  return LIVE_API_BASE;
}

/** Where the redirect sends the click: the public site, never a local address. */
export function appPublicBase(publicAppBase = '') {
  const candidates = [publicAppBase, process.env.FRONTEND_URL, process.env.PUBLIC_APP_URL];
  for (const candidate of candidates) {
    const base = String(candidate || '').trim().replace(/\/$/, '');
    if (!base || !base.startsWith('https://') || isLocalOrigin(base)) continue;
    return base;
  }
  return LIVE_APP_BASE;
}

/**
 * A short link on our own host: `<api>/<path>/<segment>/<segment>…`.
 *
 * Every address that goes to a customer should come from here. A long one is
 * not merely ugly in WhatsApp — the community centre's signup address carries
 * the class name in its query string, so it arrives as four lines of
 * percent-encoded Hebrew that no two of which can be told apart, and WhatsApp
 * sometimes fails to make it tappable at all. Resolving at click time is also
 * what lets a destination move without breaking links already sent.
 *
 * Each segment is encoded on its own, so a path can have several of them —
 * the single-token version could not express `/s/<group>/<frequency>`, which
 * is why the first caller that needed it built its URL by hand instead.
 */
export function buildRedirectUrl(path, ...segments) {
  const parts = segments
    .flat()
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .map((s) => encodeURIComponent(s));
  if (!parts.length) return '';
  return `${apiRedirectBase()}/${path}/${parts.join('/')}`;
}
