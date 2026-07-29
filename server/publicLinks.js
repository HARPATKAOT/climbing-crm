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

/** Short link behind a template button: `<api>/<path>/<token>`. */
export function buildRedirectUrl(path, token) {
  if (!token) return '';
  return `${apiRedirectBase()}/${path}/${encodeURIComponent(String(token))}`;
}
