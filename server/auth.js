import { supa } from './supa.js';
import { db } from './db.js';
import {
  accessAtLeast,
  hasSensitiveAccess,
  legacyCrmRole,
  loadAccessRegistry,
  OPERATIONAL_PERMISSIONS,
  resolveAccessContext,
} from './userAccess.js';

// Supabase's `getUser` and the access-registry lookup are network calls. A CRM
// screen often opens several protected resources together, so repeating both
// checks for every request made a single card transition pay the same latency
// many times. Cache the resolved context briefly and share concurrent checks;
// permissions and revocations still take effect within one minute.
const AUTH_CONTEXT_TTL_MS = 60_000;
const AUTH_CONTEXT_CACHE_MAX = 250;
const authContextCache = new Map();
const authContextInFlight = new Map();

async function resolveCachedAuthContext(token) {
  const now = Date.now();
  const cached = authContextCache.get(token);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) authContextCache.delete(token);

  const pending = authContextInFlight.get(token);
  if (pending) return pending;

  const request = (async () => {
    const user = await supa.verifyAccessToken(token);
    if (!user) return { user: null, access: null };
    const registry = await loadAccessRegistry();
    const access = resolveAccessContext(user, registry, db.get('employees') || []);
    const value = { user, access };
    if (authContextCache.size >= AUTH_CONTEXT_CACHE_MAX) {
      authContextCache.delete(authContextCache.keys().next().value);
    }
    authContextCache.set(token, { value, expiresAt: Date.now() + AUTH_CONTEXT_TTL_MS });
    return value;
  })();

  authContextInFlight.set(token, request);
  try {
    return await request;
  } finally {
    authContextInFlight.delete(token);
  }
}

const PUBLIC_API_ROUTES = [
  /^\/health$/,
  /^\/public\//,
  /^\/r\/[^/]+$/,
  /^\/whatsapp\/webhook$/,
  /^\/instagram\/webhook$/,
  /^\/icount\/webhook$/,
  /^\/attendance\/ensure-today$/,
  /^\/automations\/run-scheduled$/,
  /^\/google-calendar\/webhook$/,
  /^\/google-calendar\/oauth\/callback$/,
  /^\/google-calendar\/sync-due$/,
  /^\/google-contacts\/oauth\/callback$/,
];

const READ = ['GET'];
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'];
const TEAM_RULES = [
  { methods: READ, pattern: /^\/auth\/me$/, publicToTeam: true },
  { methods: [...READ, ...WRITE], pattern: /^\/me\/employee(\/|$)/, selfEmployee: true },
  { methods: READ, pattern: /^\/operations\/roster$/, anyModules: ['attendance', 'checkin', 'classes', 'safety_tests', 'level_tests'] },
  { methods: READ, pattern: /^\/trainers$/, anyModules: ['classes', 'safety_checks', 'level_tests', 'safety_tests', 'lead_tests', 'employees'] },

  { methods: READ, pattern: /^\/dashboard(\/|$)/, module: 'dashboard' },
  { methods: WRITE, pattern: /^\/dashboard(\/|$)/, module: 'dashboard', level: 'edit' },
  { methods: READ, pattern: /^\/tasks(\/|$)/, anyModules: ['dashboard', 'assistant'] },
  { methods: WRITE, pattern: /^\/tasks(\/|$)/, anyModules: ['dashboard', 'assistant'], level: 'edit' },
  // הדלפק חייב יכולת לשלוח להורה קישור לחתימה על הצהרת בריאות והסרת אחריות —
  // בלעדיה מי שמגיע בלי טפסים נתקע במסוף בלי דרך קדימה. זו שליחת קישור בלבד,
  // ולכן היא נפתחת למי שמפעיל את מסוף הכניסה בלי לפתוח לו את תיקי הלקוחות.
  { methods: WRITE, pattern: /^\/leads\/[^/]+\/send-health-form$/, anyModules: ['customers', 'checkin', 'health'], level: 'edit' },
  { methods: READ, pattern: /^\/(parents|students|leads)(\/|$)/, module: 'customers' },
  { methods: WRITE, pattern: /^\/(parents|students|leads)(\/|$)/, module: 'customers', level: 'edit' },
  { methods: READ, pattern: /^\/groups\/[^/]+\/staff-attendance$/, module: 'attendance' },
  { methods: WRITE, pattern: /^\/groups\/[^/]+\/staff-attendance$/, module: 'attendance', level: 'edit' },
  { methods: READ, pattern: /^\/attendance(\/|$)/, module: 'attendance' },
  { methods: WRITE, pattern: /^\/attendance(\/|$)/, module: 'attendance', level: 'edit' },
  { methods: READ, pattern: /^\/groups(\/|$)/, module: 'classes' },
  { methods: WRITE, pattern: /^\/groups(\/|$)/, module: 'classes', level: 'edit' },
  { methods: READ, pattern: /^\/check-ins(\/|$)/, module: 'checkin' },
  { methods: WRITE, pattern: /^\/check-ins(\/|$)/, module: 'checkin', level: 'edit' },
  { methods: READ, pattern: /^\/wall-shift(\/|$)/, module: 'checkin' },
  { methods: WRITE, pattern: /^\/wall-shift(\/|$)/, module: 'checkin', level: 'edit' },
  { methods: READ, pattern: /^\/checkin\//, module: 'checkin' },
  { methods: WRITE, pattern: /^\/checkin\/pending\//, module: 'checkin', level: 'edit' },
  { methods: READ, pattern: /^\/settings\/staff-attendance$/, anyModules: ['attendance', 'checkin', 'shifts'] },

  { methods: READ, pattern: /^\/equipment-settings$/, module: 'equipment' },
  { methods: READ, pattern: /^\/(equipment|student-equipment)(\/|$)/, module: 'equipment' },
  { methods: WRITE, pattern: /^\/(equipment|student-equipment)(\/|$)/, module: 'equipment', level: 'edit' },
  { methods: READ, pattern: /^\/students\/[^/]+\/equipment(\/|$)/, module: 'equipment' },
  { methods: WRITE, pattern: /^\/students\/[^/]+\/equipment(\/|$)/, module: 'equipment', level: 'edit' },

  { methods: [...READ, ...WRITE], pattern: /^\/activities\/[^/]+\/(host-payment|registration-link|send-registration-link|registrations\/[^/]+\/refund)(\/|$)/, module: 'activity_registrations', level: 'edit', sensitive: 'finance' },
  { methods: READ, pattern: /^\/activities\/[^/]+\/(registrations|interested|attendance)(\/|$)/, module: 'activity_registrations' },
  { methods: WRITE, pattern: /^\/activities\/[^/]+\/(registrations|interested|attendance)(\/|$)/, module: 'activity_registrations', level: 'edit' },
  { methods: READ, pattern: /^\/(activities|activity-templates|google-calendar)(\/|$)/, module: 'activities' },
  { methods: WRITE, pattern: /^\/(activities|activity-templates|google-calendar)(\/|$)/, module: 'activities', level: 'edit' },
  { methods: READ, pattern: /^\/activity-types(\/|$)/, module: 'activities' },
  { methods: WRITE, pattern: /^\/activity-types(\/|$)/, module: 'activities', level: 'edit' },
  { methods: WRITE, pattern: /^\/activity-attendance(\/|$)/, module: 'activity_registrations', level: 'edit' },

  { methods: READ, pattern: /^\/(broadcast|broadcasts|broadcast-list-defs|message-templates|saved-replies|saved-segments|conversations|channels|whatsapp)(\/|$)/, module: 'broadcasts' },
  { methods: WRITE, pattern: /^\/(broadcast|broadcasts|broadcast-list-defs|message-templates|saved-replies|saved-segments|conversations|channels|whatsapp)(\/|$)/, module: 'broadcasts', level: 'edit' },

  { methods: [...READ, ...WRITE], pattern: /^\/pos\/(reports|sales\/[^/]+\/(invoice|refund))(\/|$)/, module: 'cash_management', level: 'edit', sensitive: 'finance' },
  { methods: READ, pattern: /^\/(pricelist|product-categories|pos)(\/|$)/, module: 'pos' },
  { methods: WRITE, pattern: /^\/(pricelist|product-categories|pos)(\/|$)/, module: 'pos', level: 'edit' },
  { methods: WRITE, pattern: /^\/checkout(\/|$)/, module: 'pos', level: 'edit' },
  // A shared wall station may open/close the physical till, but it must not gain
  // access to finance reports, payments or the manager cash terminal.
  { methods: READ, pattern: /^\/cash-register\/session$/, module: 'cash_management' },
  { methods: WRITE, pattern: /^\/cash-register\/(open|close)$/, module: 'cash_management', level: 'edit' },
  // בניית בייטים להדפסת קבלה ולפתיחת המגירה היא פעולת דלפק, לא דוח כספי —
  // היא לא מחזירה שום נתון על העסק. בלעדיה עמדת הקיר לא יכולה להדפיס בכלל.
  { methods: WRITE, pattern: /^\/cash-register\/receipt-bytes$/, module: 'cash_management', level: 'edit' },
  { methods: [...READ, ...WRITE], pattern: /^\/(cash-register|payments|icount)(\/|$)/, module: 'cash_management', sensitive: 'finance' },

  { methods: READ, pattern: /^\/safety\/check-types(\/|$)/, anyModules: ['safety_checks', 'safety_settings'] },
  { methods: WRITE, pattern: /^\/safety\/check-types(\/|$)/, module: 'safety_settings', level: 'edit' },
  { methods: READ, pattern: /^\/safety\/(due-today|inspections|incidents)(\/|$)/, module: 'safety_checks' },
  { methods: WRITE, pattern: /^\/safety\/(inspections|incidents)(\/|$)/, module: 'safety_checks', level: 'edit' },
  { methods: [...READ, ...WRITE], pattern: /^\/level-tests(\/|$)/, anyModules: ['level_tests', 'safety_tests', 'lead_tests'], writeLevel: true },

  { methods: [...READ, ...WRITE], pattern: /^\/employees\/[^/]+\/(documents|payroll-documents|attendance-summary|shift-journal)(\/|$)/, module: 'hr', sensitive: 'hr' },
  { methods: READ, pattern: /^\/employees\/onboard-fields$/, module: 'employees' },
  { methods: READ, pattern: /^\/employees(\/|$)/, module: 'employees' },
  { methods: WRITE, pattern: /^\/employees(\/|$)/, module: 'employees', level: 'edit' },
  { methods: [...READ, ...WRITE], pattern: /^\/wages(\/|$)/, module: 'hr', sensitive: 'hr' },
  { methods: READ, pattern: /^\/(work-assignments|shifts)(\/|$)/, module: 'shifts' },
  { methods: WRITE, pattern: /^\/(work-assignments|shifts)(\/|$)/, module: 'shifts', level: 'edit' },
  { methods: READ, pattern: /^\/staff-roles(\/|$)/, module: 'employees' },
  { methods: WRITE, pattern: /^\/staff-roles(\/|$)/, module: 'hr', level: 'edit', sensitive: 'hr' },

  { methods: READ, pattern: /^\/(health-declarations|form-templates|documents)(\/|$)/, module: 'health' },
  { methods: WRITE, pattern: /^\/(health-declarations|form-templates|documents)(\/|$)/, module: 'health', level: 'edit' },
  { methods: READ, pattern: /^\/automations(\/|$)/, module: 'automations' },
  { methods: WRITE, pattern: /^\/automations(\/|$)/, module: 'automations', level: 'edit' },
  { methods: READ, pattern: /^\/agenda-digest(\/|$)/, module: 'automations' },
  { methods: WRITE, pattern: /^\/agenda-digest(\/|$)/, module: 'automations', level: 'edit' },
  { methods: [...READ, ...WRITE], pattern: /^\/ai(\/|$)/, module: 'assistant' },
  { methods: [...READ, ...WRITE], pattern: /^\/bot-learning(\/|$)/, module: 'assistant' },
  { methods: READ, pattern: /^\/signature-evidence(\/|$)/, module: 'health' },
];

export const resolveCrmRole = legacyCrmRole;

export function isStaffRequestAllowed(
  method,
  requestPath,
  access = OPERATIONAL_PERMISSIONS.map((permission) => permission.id)
) {
  const path = requestPath.replace(/^\/api/, '') || '/';
  const context = Array.isArray(access)
    ? {
        role: 'staff',
        modules: {
          attendance: access.includes('attendance') ? 'edit' : 'none',
          classes: access.includes('attendance') ? 'view' : 'none',
          safety_checks: access.includes('safety') ? 'edit' : 'none',
          safety_tests: access.includes('safety') ? 'view' : 'none',
          checkin: access.includes('wall_entry') ? 'edit' : 'none',
        },
        sensitive: {},
      }
    : access;
  const rule = TEAM_RULES.find((candidate) => candidate.methods.includes(method) && candidate.pattern.test(path));
  if (!rule) return false;
  if (rule.publicToTeam) return true;
  if (rule.selfEmployee) return Boolean(context?.employee_id);
  const level = rule.level || (rule.writeLevel && method !== 'GET' ? 'edit' : 'view');
  const moduleAllowed = rule.anyModules
    ? rule.anyModules.some((moduleId) => accessAtLeast(context, moduleId, level))
    : accessAtLeast(context, rule.module, level);
  return moduleAllowed && (!rule.sensitive || hasSensitiveAccess(context, rule.sensitive));
}

export function isPublicApiPath(requestPath) {
  const path = requestPath.replace(/^\/api/, '') || '/';
  return PUBLIC_API_ROUTES.some((pattern) => pattern.test(path));
}

function isLoopbackRequest(req) {
  const hostname = String(req.hostname || '').toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export async function apiAuth(req, res, next) {
  const path = req.path.replace(/^\/api/, '') || '/';
  if (isPublicApiPath(path)) return next();

  const localDevelopment =
    process.env.NODE_ENV !== 'production' &&
    (
      process.env.CRM_AUTH_DISABLED === 'true' ||
      (!supa.isEnabled() && isLoopbackRequest(req))
    );
  if (localDevelopment) {
    req.crmUser = { id: 'local-development', email: 'local@crm.test', role: 'owner' };
    return next();
  }

  const authorization = req.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'נדרשת כניסה למערכת' });

  const { user, access } = await resolveCachedAuthContext(token);
  if (!user) return res.status(401).json({ error: 'החיבור פג. יש להיכנס מחדש' });
  if (!access) return res.status(403).json({ error: 'לחשבון הזה אין הרשאה פעילה למערכת' });

  req.crmUser = {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || user.email,
    ...access,
  };

  if (access.role === 'staff' && !isStaffRequestAllowed(req.method, path, access)) {
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
