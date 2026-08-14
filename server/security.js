import crypto from 'crypto';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const EMPLOYEE_ONBOARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function secureCompare(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function securityLogRef(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'none';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function oauthStateKey(explicitSecret = '') {
  const source = String(
    explicitSecret
      || process.env.OAUTH_STATE_SECRET
      || process.env.GOOGLE_CLIENT_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || ''
  ).trim();
  if (!source) throw new Error('OAuth state signing is not configured');
  return crypto.createHmac('sha256', 'crm.oauth-state.v1').update(source).digest();
}

function employeeOnboardKey(explicitSecret = '') {
  const source = String(
    explicitSecret
      || process.env.EMPLOYEE_ONBOARD_SECRET
      || process.env.OAUTH_STATE_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || ''
  ).trim();
  if (!source) throw new Error('Employee onboarding signing is not configured');
  return crypto.createHmac('sha256', 'crm.employee-onboard.v1').update(source).digest();
}

function publicRedirectKey(explicitSecret = '') {
  const source = String(
    explicitSecret
      || process.env.PUBLIC_LINK_SECRET
      || process.env.ICOUNT_WEBHOOK_SECRET
      || process.env.EMPLOYEE_ONBOARD_SECRET
      || process.env.OAUTH_STATE_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || ''
  ).trim();
  if (!source) throw new Error('Public redirect signing is not configured');
  return crypto.createHmac('sha256', 'crm.public-redirect.v1').update(source).digest();
}

/** Purpose-bound signed suffix for public WhatsApp template buttons. */
export function issuePublicRedirectToken(purpose, recordId, { secret = '' } = {}) {
  const cleanPurpose = String(purpose || '').trim();
  const cleanId = String(recordId || '').trim();
  if (!cleanPurpose || !cleanId || cleanPurpose.length > 80 || cleanId.length > 240) return '';
  const payload = Buffer.from(cleanId, 'utf8').toString('base64url');
  const mac = crypto
    .createHmac('sha256', publicRedirectKey(secret))
    .update(`${cleanPurpose}:${payload}`)
    .digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyPublicRedirectToken(token, purpose, { secret = '' } = {}) {
  const [payload, suppliedMac, extra] = String(token || '').split('.');
  const cleanPurpose = String(purpose || '').trim();
  if (!payload || !suppliedMac || extra || !cleanPurpose || payload.length > 400) return null;
  let expectedMac;
  try {
    expectedMac = crypto
      .createHmac('sha256', publicRedirectKey(secret))
      .update(`${cleanPurpose}:${payload}`)
      .digest('base64url');
  } catch {
    return null;
  }
  if (!secureCompare(suppliedMac, expectedMac)) return null;
  try {
    const recordId = Buffer.from(payload, 'base64url').toString('utf8').trim();
    return recordId && recordId.length <= 240 ? recordId : null;
  } catch {
    return null;
  }
}

export function resolvePublicRedirectRecordId(
  value,
  purpose,
  { secret = '', legacyCutoffMs = 0 } = {}
) {
  const supplied = String(value || '').trim();
  if (!supplied) return null;
  if (supplied.includes('.')) return verifyPublicRedirectToken(supplied, purpose, { secret });

  // Legacy template buttons used the generated pa<epoch-ms>/po<epoch-ms> id.
  // Only a finite historical set is accepted; newer records must be signed.
  const prefix = purpose === 'payment' ? 'pa' : purpose === 'sale-document' ? 'po' : '';
  if (!prefix || !Number.isFinite(Number(legacyCutoffMs))) return null;
  const match = supplied.match(new RegExp(`^${prefix}(\\d{13})$`));
  if (!match) return null;
  return Number(match[1]) <= Number(legacyCutoffMs) ? supplied : null;
}

export function issueEmployeeOnboardInvite({
  secret = '',
  now = Date.now(),
  nonce = crypto.randomBytes(24).toString('base64url'),
} = {}) {
  const expiresAt = Number(now) + EMPLOYEE_ONBOARD_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    purpose: 'employee-onboard',
    nonce,
    expiresAt,
  })).toString('base64url');
  const mac = crypto.createHmac('sha256', employeeOnboardKey(secret)).update(payload).digest('base64url');
  return { token: `${payload}.${mac}`, expiresAt };
}

export function verifyEmployeeOnboardInvite(token, { secret = '', now = Date.now() } = {}) {
  const [payload, suppliedMac, extra] = String(token || '').split('.');
  if (!payload || !suppliedMac || extra) return null;
  const expectedMac = crypto.createHmac('sha256', employeeOnboardKey(secret)).update(payload).digest('base64url');
  if (!secureCompare(suppliedMac, expectedMac)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      parsed?.v !== 1
      || parsed.purpose !== 'employee-onboard'
      || typeof parsed.nonce !== 'string'
      || parsed.nonce.length < 20
      || Number(parsed.expiresAt) < Number(now)
      || Number(parsed.expiresAt) > Number(now) + EMPLOYEE_ONBOARD_TTL_MS
    ) return null;
    return {
      expiresAt: Number(parsed.expiresAt),
      inviteId: crypto.createHash('sha256').update(parsed.nonce).digest('hex'),
    };
  } catch {
    return null;
  }
}

export function issueOAuthState(provider, {
  secret = '',
  now = Date.now(),
  nonce = crypto.randomBytes(24).toString('base64url'),
} = {}) {
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    provider: String(provider || ''),
    nonce,
    expiresAt: Number(now) + OAUTH_STATE_TTL_MS,
  })).toString('base64url');
  const mac = crypto.createHmac('sha256', oauthStateKey(secret)).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function verifyOAuthState(state, provider, { secret = '', now = Date.now() } = {}) {
  const [payload, suppliedMac, extra] = String(state || '').split('.');
  if (!payload || !suppliedMac || extra) return false;
  const expectedMac = crypto.createHmac('sha256', oauthStateKey(secret)).update(payload).digest('base64url');
  if (!secureCompare(suppliedMac, expectedMac)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed?.v === 1
      && parsed.provider === String(provider || '')
      && typeof parsed.nonce === 'string'
      && parsed.nonce.length >= 20
      && Number(parsed.expiresAt) >= Number(now)
      && Number(parsed.expiresAt) <= Number(now) + OAUTH_STATE_TTL_MS;
  } catch {
    return false;
  }
}

export function requireCronSecret(req, res, next) {
  const expected = String(process.env.CRON_SECRET || '').trim();
  if (!expected) return res.status(503).json({ error: 'CRON_SECRET is not configured' });
  const supplied = String(req.get('x-cron-secret') || '').trim();
  if (!secureCompare(supplied, expected)) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

export function allowedCorsOrigins(configuredOrigins = [], nodeEnv = process.env.NODE_ENV) {
  const origins = new Set([
    'https://app.kirboaz.co.il',
    'https://client-omega-topaz-35.vercel.app',
  ]);
  for (const raw of configuredOrigins) {
    try {
      const url = new URL(String(raw || '').trim());
      if (url.protocol === 'https:' || (nodeEnv !== 'production' && url.protocol === 'http:')) {
        origins.add(url.origin);
      }
    } catch {
      // Ignore malformed configuration rather than accidentally widening CORS.
    }
  }
  if (nodeEnv !== 'production') {
    for (const port of [3000, 3001, 5173]) {
      origins.add(`http://localhost:${port}`);
      origins.add(`http://127.0.0.1:${port}`);
    }
  }
  return origins;
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  if (req.secure || forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  return next();
}

export function safeIcountDocumentUrl(value, configuredHosts = process.env.ICOUNT_DOCUMENT_HOSTS || '') {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    const extraHosts = String(configuredHosts || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    if (host === 'icount.co.il' || host.endsWith('.icount.co.il') || extraHosts.includes(host)) {
      return url.toString();
    }
  } catch {
    // Invalid URLs are never fetched by the API.
  }
  return null;
}

export function safeHttpsRedirectUrl(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2048) return null;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
