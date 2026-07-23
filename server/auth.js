import { supa } from './supa.js';

const PUBLIC_API_ROUTES = [
  /^\/health$/,
  /^\/public\//,
  /^\/whatsapp\/webhook$/,
  /^\/instagram\/webhook$/,
  /^\/icount\/webhook$/,
  /^\/attendance\/ensure-today$/,
];

const TEAM_RULES = [
  { methods: ['GET', 'POST', 'PUT', 'DELETE'], pattern: /^\/(parents|students|groups|attendance|check-ins)(\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/leads(\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/health-declarations(\/|$)/ },
  { methods: ['GET'], pattern: /^\/form-templates(\/|$)/ },
  { methods: ['GET'], pattern: /^\/trainers$/ },
  { methods: ['GET'], pattern: /^\/broadcast-list-defs(\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/parents\/[^/]+\/broadcast-lists$/ },
  { methods: ['GET'], pattern: /^\/students\/[^/]+\/documents$/ },
  { methods: ['GET'], pattern: /^\/documents\/[^/]+\/download$/ },
  { methods: ['GET'], pattern: /^\/whatsapp\/(thread|logs)(\/|$)/ },
  { methods: ['GET'], pattern: /^\/whatsapp\/settings$/ },
  { methods: ['POST'], pattern: /^\/whatsapp\/(reply|bot-enabled)$/ },
  { methods: ['GET'], pattern: /^\/conversations\/[^/]+$/ },
  { methods: ['POST'], pattern: /^\/conversations\/[^/]+\/reply$/ },
  { methods: ['GET'], pattern: /^\/message-templates(\/|$)/ },
  { methods: ['GET'], pattern: /^\/saved-replies(\/|$)/ },
  { methods: ['POST'], pattern: /^\/broadcast\/preview$/ },
  { methods: ['GET'], pattern: /^\/broadcast\/(interest-options|jobs)(\/|$)/ },
  { methods: ['GET'], pattern: /^\/saved-segments(\/|$)/ },
  { methods: ['GET'], pattern: /^\/channels\/status$/ },
  { methods: ['GET'], pattern: /^\/auth\/me$/ },
  { methods: ['GET'], pattern: /^\/pricelist(\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/pos\/(sale|quote|payment-link|sales)(\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/pos\/passes(\/|$)/ },
  { methods: ['GET', 'POST'], pattern: /^\/cash-register(\/|$)/ },
  { methods: ['GET'], pattern: /^\/icount\/status$/ },
];

function emailSet(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function resolveCrmRole(user) {
  const email = String(user?.email || '').toLowerCase();
  const ownerEmails = emailSet(process.env.CRM_OWNER_EMAILS);
  const staffEmails = emailSet(process.env.CRM_STAFF_EMAILS);
  if (ownerEmails.has(email)) return 'owner';
  if (staffEmails.has(email)) return 'staff';

  const rawRole =
    user?.app_metadata?.crm_role ||
    user?.user_metadata?.crm_role ||
    user?.app_metadata?.role ||
    '';
  const role = String(rawRole).toLowerCase();
  if (role === 'owner' || role === 'admin') return 'owner';
  if (role === 'staff' || role === 'team') return 'staff';
  return null;
}

export function isStaffRequestAllowed(method, requestPath) {
  const path = requestPath.replace(/^\/api/, '') || '/';
  return TEAM_RULES.some(
    (rule) => rule.methods.includes(method) && rule.pattern.test(path)
  );
}

export function isPublicApiPath(requestPath) {
  const path = requestPath.replace(/^\/api/, '') || '/';
  return PUBLIC_API_ROUTES.some((pattern) => pattern.test(path));
}

export async function apiAuth(req, res, next) {
  const path = req.path.replace(/^\/api/, '') || '/';
  if (isPublicApiPath(path)) return next();

  if (process.env.NODE_ENV !== 'production' && process.env.CRM_AUTH_DISABLED === 'true') {
    req.crmUser = { id: 'local-development', email: 'local@mywall.test', role: 'owner' };
    return next();
  }

  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'נדרשת כניסה למערכת' });

  const user = await supa.verifyAccessToken(token);
  if (!user) return res.status(401).json({ error: 'החיבור פג. יש להיכנס מחדש' });

  const role = resolveCrmRole(user);
  if (!role) return res.status(403).json({ error: 'לחשבון הזה לא הוגדרה הרשאה למערכת' });

  req.crmUser = {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
    role,
  };

  if (role === 'staff' && !isStaffRequestAllowed(req.method, path)) {
    return res.status(403).json({ error: 'לחשבון הצוות אין הרשאה לפעולה הזאת' });
  }
  return next();
}

export function requireOwner(req, res, next) {
  if (req.crmUser?.role !== 'owner') {
    return res.status(403).json({ error: 'הפעולה זמינה למנהל בלבד' });
  }
  return next();
}
