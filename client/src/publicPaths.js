/** Paths that must work without staff login (registered outside AuthGate in main.jsx). */
export const PUBLIC_PATH_PREFIXES = [
  '/health',
  '/join',
  '/onboard',
  '/event',
  '/event-host',
  '/equipment',
  '/shop',
  '/privacy',
];

export function isPublicPath(pathname) {
  const path = String(pathname || '');
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}
