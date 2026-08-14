/** Paths that must work without staff login (registered outside AuthGate in main.jsx). */
export const PUBLIC_PATH_PREFIXES = [
  '/register',
  '/health',
  '/onboard',
  '/event',
  '/event-host',
  '/equipment',
  '/shop',
  '/privacy',
  '/shift-signup',
  '/mailing-preferences',
];

export function isPublicPath(pathname) {
  const path = String(pathname || '');
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}
