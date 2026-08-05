import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { supa } from './supa.js';

export const USER_ACCESS_KEY = 'crm_authorized_users';
const LOCAL_ACCESS_TABLE = 'crm_user_access_registry';
export const USER_STATUSES = new Set(['invited', 'active', 'blocked']);
export const ACCESS_LEVEL = Object.freeze({ none: 0, view: 1, edit: 2 });
export const ACCESS_LEVELS = new Set(Object.keys(ACCESS_LEVEL));

export const MODULE_CATALOG = Object.freeze([
  { id: 'dashboard', name: 'מסך עבודה', group: 'כללי', levels: ['none', 'view'] },
  { id: 'checkin', name: 'מסוף כניסה', group: 'לקוחות ותפעול' },
  { id: 'customers', name: 'לקוחות ולידים', group: 'לקוחות ותפעול' },
  { id: 'classes', name: 'חוגים ומחירי חוגים', group: 'לקוחות ותפעול' },
  { id: 'attendance', name: 'נוכחות בחוגים', group: 'לקוחות ותפעול' },
  { id: 'equipment', name: 'ציוד', group: 'לקוחות ותפעול' },
  { id: 'activities', name: 'אירועים וטיולים', group: 'אירועים ותקשורת' },
  { id: 'activity_registrations', name: 'הרשמות לאירועים', group: 'אירועים ותקשורת' },
  { id: 'broadcasts', name: 'דיוור ותקשורת', group: 'אירועים ותקשורת' },
  { id: 'pos', name: 'מכירה שוטפת', group: 'כספים ומכירה' },
  { id: 'cash_management', name: 'ניהול קופה ודוחות', group: 'כספים ומכירה' },
  { id: 'safety_checks', name: 'בדיקות בטיחות', group: 'בטיחות ומבחנים' },
  { id: 'safety_settings', name: 'הגדרות וסוגי בדיקות בטיחות', group: 'בטיחות ומבחנים' },
  { id: 'level_tests', name: 'מבחני רמה', group: 'בטיחות ומבחנים' },
  { id: 'safety_tests', name: 'מבחני אבטחה', group: 'בטיחות ומבחנים' },
  { id: 'lead_tests', name: 'מבחני הובלה', group: 'בטיחות ומבחנים' },
  { id: 'employees', name: 'תיקי עובדים בסיסיים', group: 'עובדים' },
  { id: 'shifts', name: 'משמרות ונוכחות עובדים', group: 'עובדים' },
  { id: 'hr', name: 'הסכמי שכר ומידע אישי', group: 'עובדים' },
  { id: 'health', name: 'הצהרות בריאות וטפסים', group: 'ניהול' },
  { id: 'automations', name: 'אוטומציות', group: 'ניהול' },
  { id: 'assistant', name: 'עוזר חכם', group: 'ניהול' },
]);

export const SENSITIVE_CATALOG = Object.freeze([
  { id: 'finance', name: 'נתונים פיננסיים של העסק' },
  { id: 'hr', name: 'שכר ומידע אישי של עובדים אחרים' },
]);

export const OPERATIONAL_PERMISSIONS = Object.freeze([
  { id: 'attendance', name: 'נוכחות בחוגים' },
  { id: 'safety', name: 'בדיקות בטיחות' },
  { id: 'wall_entry', name: 'כניסה לקיר' },
]);

const MODULE_IDS = new Set(MODULE_CATALOG.map((item) => item.id));
const ALL_EDIT = Object.freeze(Object.fromEntries(MODULE_CATALOG.map((item) => [item.id, item.levels?.includes('edit') === false ? 'view' : 'edit'])));

const modulesOf = (entries = {}) => Object.fromEntries(
  MODULE_CATALOG.map(({ id, levels }) => {
    const requested = String(entries?.[id] || 'none');
    const allowed = levels || ['none', 'view', 'edit'];
    return [id, allowed.includes(requested) ? requested : 'none'];
  })
);

const preset = (id, name, modules, sensitive = {}) => ({
  id,
  name,
  modules: modulesOf(modules),
  sensitive: { finance: sensitive.finance === true, hr: sensitive.hr === true },
  preset: true,
});

export const DEFAULT_ROLES = Object.freeze([
  preset('operations-manager', 'מנהל תפעול', {
    dashboard: 'view', checkin: 'edit', customers: 'edit', classes: 'edit', attendance: 'edit',
    equipment: 'edit', activities: 'edit', activity_registrations: 'edit', broadcasts: 'edit',
    pos: 'edit', safety_checks: 'edit', safety_settings: 'view', level_tests: 'edit',
    safety_tests: 'edit', lead_tests: 'edit', employees: 'edit', shifts: 'edit', health: 'edit',
    automations: 'edit', assistant: 'edit',
  }),
  preset('instructor', 'מדריך חוגים', {
    dashboard: 'view', customers: 'view', classes: 'view', attendance: 'edit',
    activities: 'view', level_tests: 'edit', employees: 'view', shifts: 'view', health: 'view',
  }),
  preset('safety-officer', 'אחראי בטיחות', {
    dashboard: 'view', customers: 'view', classes: 'view', safety_checks: 'edit',
    safety_settings: 'view', safety_tests: 'edit', employees: 'view', equipment: 'view',
  }),
  preset('reception', 'קבלה וכניסה לקיר', {
    dashboard: 'view', checkin: 'edit', customers: 'edit', classes: 'view', attendance: 'view',
    activity_registrations: 'edit', pos: 'edit', health: 'view',
  }),
  preset('staff', 'צוות תפעול', {
    checkin: 'edit', attendance: 'edit', safety_checks: 'edit', safety_tests: 'view',
  }),
]);

function emailSet(value) {
  return new Set(String(value || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const unique = (values) => [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];

export function legacyCrmRole(user) {
  const email = normalizeEmail(user?.email);
  if (emailSet(process.env.CRM_OWNER_EMAILS).has(email)) return 'owner';
  if (emailSet(process.env.CRM_STAFF_EMAILS).has(email)) return 'staff';
  const rawRole = user?.app_metadata?.crm_role || user?.user_metadata?.crm_role || user?.app_metadata?.role || '';
  const role = String(rawRole).toLowerCase();
  if (role === 'owner' || role === 'admin') return 'owner';
  if (role === 'staff' || role === 'team') return 'staff';
  return null;
}

function legacyModules(permissions = []) {
  const set = new Set(Array.isArray(permissions) ? permissions : []);
  return modulesOf({
    attendance: set.has('attendance') ? 'edit' : 'none',
    classes: set.has('attendance') ? 'view' : 'none',
    safety_checks: set.has('safety') ? 'edit' : 'none',
    safety_tests: set.has('safety') ? 'view' : 'none',
    checkin: set.has('wall_entry') ? 'edit' : 'none',
  });
}

export function legacyPermissionIds(modules = {}) {
  const ids = [];
  if (ACCESS_LEVEL[modules.attendance] >= ACCESS_LEVEL.view) ids.push('attendance');
  if (ACCESS_LEVEL[modules.safety_checks] >= ACCESS_LEVEL.view) ids.push('safety');
  if (ACCESS_LEVEL[modules.checkin] >= ACCESS_LEVEL.view) ids.push('wall_entry');
  return ids;
}

export function normalizeAccessEntry(raw = {}) {
  const email = normalizeEmail(raw.email);
  if (!email) return null;
  const legacyRole = String(raw.role || raw.role_id || '').trim();
  const roleIds = unique(Array.isArray(raw.role_ids)
    ? raw.role_ids
    : (legacyRole && legacyRole !== 'owner' ? [legacyRole] : ['staff']));
  return {
    id: String(raw.id || raw.auth_user_id || `email:${email}`),
    auth_user_id: raw.auth_user_id ? String(raw.auth_user_id) : null,
    name: String(raw.name || email).trim(),
    email,
    role_ids: roleIds,
    role: roleIds[0] || 'staff',
    status: USER_STATUSES.has(raw.status) ? raw.status : 'invited',
    invited_at: raw.invited_at || null,
    updated_at: raw.updated_at || null,
  };
}

export function normalizeAccessRoleDefinition(raw = {}) {
  const id = String(raw.id || '').trim();
  const name = String(raw.name || '').trim();
  if (!id || !name || id === 'owner' || id === 'employee') return null;
  const sourceModules = raw.modules && typeof raw.modules === 'object'
    ? raw.modules
    : legacyModules(raw.permissions);
  const modules = modulesOf(sourceModules);
  return {
    id,
    name,
    modules,
    sensitive: {
      finance: raw.sensitive?.finance === true,
      hr: raw.sensitive?.hr === true,
    },
    permissions: legacyPermissionIds(modules),
    preset: raw.preset === true,
  };
}

function defaultRoles() {
  return DEFAULT_ROLES.map((role) => normalizeAccessRoleDefinition(role));
}

function mergeDefaultRoles(roles = []) {
  const normalized = roles.map(normalizeAccessRoleDefinition).filter(Boolean);
  const names = new Set(normalized.map((role) => role.name.toLowerCase()));
  const ids = new Set(normalized.map((role) => role.id));
  for (const role of defaultRoles()) {
    if (!ids.has(role.id) && !names.has(role.name.toLowerCase())) normalized.push(role);
  }
  return normalized;
}

function accessRole(registry, roleId) {
  const found = (registry?.roles || []).find((role) => role.id === roleId)
    || (!Array.isArray(registry?.roles) ? defaultRoles().find((role) => role.id === roleId) : null)
    || null;
  return found ? normalizeAccessRoleDefinition(found) : null;
}

function ensureRegistryAvailable(registry) {
  if (registry?.unavailable) throw new Error('שירות ההרשאות אינו זמין כרגע; לא בוצע שינוי');
  return registry;
}

export function employeeMatchForEmail(email, employees = db.get('employees') || []) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { employee_id: null, employee_match: 'missing' };
  const matches = employees.filter((employee) => normalizeEmail(employee?.email) === normalized);
  if (matches.length === 1) return { employee_id: String(matches[0].id), employee_match: 'matched' };
  if (matches.length > 1) return { employee_id: null, employee_match: 'duplicate' };
  return { employee_id: null, employee_match: 'missing' };
}

export function validateRequestedEmployeeAccess(email, requested, employees) {
  const match = employeeMatchForEmail(email, employees);
  if (!requested || match.employee_id) return match;
  const message = match.employee_match === 'duplicate'
    ? 'לא ניתן להזמין כעובד: כתובת המייל מופיעה ביותר מתיק עובד אחד'
    : 'לא ניתן להזמין כעובד: יש ליצור תחילה תיק עובד עם אותה כתובת מייל';
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function mergeRoleAccess(roles) {
  const modules = modulesOf();
  const sensitive = { finance: false, hr: false };
  for (const role of roles) {
    for (const moduleId of MODULE_IDS) {
      if ((ACCESS_LEVEL[role.modules?.[moduleId]] || 0) > (ACCESS_LEVEL[modules[moduleId]] || 0)) {
        modules[moduleId] = role.modules[moduleId];
      }
    }
    sensitive.finance ||= role.sensitive?.finance === true;
    sensitive.hr ||= role.sensitive?.hr === true;
  }
  return { modules, sensitive };
}

export function previewAccessForEntry(entry, registry = { roles: defaultRoles() }, employees) {
  if (!entry) return null;
  const employee = employeeMatchForEmail(entry.email, employees);
  const owner = entry.role === 'owner';
  const assignedRoles = owner
    ? []
    : unique(entry.role_ids).map((roleId) => accessRole(registry, roleId)).filter(Boolean);
  const merged = owner
    ? { modules: { ...ALL_EDIT }, sensitive: { finance: true, hr: true } }
    : mergeRoleAccess(assignedRoles);
  const roleNames = owner
    ? ['מנהל ראשי']
    : assignedRoles.map((role) => role.name);
  if (employee.employee_id) roleNames.unshift('עובד');
  return {
    id: entry.id,
    name: entry.name,
    email: entry.email,
    status: entry.status,
    access_enabled: entry.status !== 'blocked',
    role_ids: owner ? ['owner'] : assignedRoles.map((role) => role.id),
    role_names: roleNames,
    modules: merged.modules,
    sensitive: merged.sensitive,
    ...employee,
  };
}

export function resolveAccessContext(user, registry = { configured: false, users: [], roles: defaultRoles() }, employees) {
  const legacyRole = legacyCrmRole(user);
  const employee = employeeMatchForEmail(user?.email, employees || db.get('employees') || []);
  if (legacyRole === 'owner') {
    return {
      role: 'owner', accessRoleId: 'owner', roleIds: ['owner'], roleName: 'מנהל ראשי',
      roleNames: ['מנהל ראשי'], permissions: ['*'], modules: { ...ALL_EDIT },
      sensitive: { finance: true, hr: true }, ...employee,
    };
  }
  if (!registry?.configured) {
    if (legacyRole !== 'staff') return null;
    const assigned = [accessRole({ roles: defaultRoles() }, 'staff')].filter(Boolean);
    const merged = mergeRoleAccess(assigned);
    return {
      role: 'staff', accessRoleId: 'staff', roleIds: ['staff'], roleName: assigned[0]?.name || 'צוות תפעול',
      roleNames: assigned.map((item) => item.name), permissions: legacyPermissionIds(merged.modules), ...merged, ...employee,
    };
  }
  const email = normalizeEmail(user?.email);
  const id = String(user?.id || '');
  const entry = (registry.users || []).find((item) => (
    (item.auth_user_id && String(item.auth_user_id) === id) || item.email === email
  ));
  if (!entry || entry.status === 'blocked') return null;
  // An invitation is an authorization intent, not an authenticated active
  // account. Supabase supplies last_sign_in_at after the invite was accepted.
  if (entry.status !== 'active' && !user?.last_sign_in_at) return null;
  const assignedRoles = unique(entry.role_ids).map((roleId) => accessRole(registry, roleId)).filter(Boolean);
  if (!assignedRoles.length && !employee.employee_id) return null;
  const merged = mergeRoleAccess(assignedRoles);
  const roleNames = assignedRoles.map((item) => item.name);
  if (employee.employee_id) roleNames.unshift('עובד');
  return {
    role: 'staff',
    accessRoleId: assignedRoles[0]?.id || 'employee',
    roleIds: assignedRoles.map((item) => item.id),
    roleName: roleNames.join(' · ') || 'עובד',
    roleNames,
    permissions: legacyPermissionIds(merged.modules),
    ...merged,
    ...employee,
  };
}

export function resolveAccessRole(user, registry = { configured: false, users: [] }, employees) {
  return resolveAccessContext(user, registry, employees)?.role || null;
}

export function accessAtLeast(context, moduleId, level = 'view') {
  if (context?.role === 'owner') return true;
  return (ACCESS_LEVEL[context?.modules?.[moduleId]] || 0) >= (ACCESS_LEVEL[level] || 0);
}

export function hasSensitiveAccess(context, sensitiveId) {
  return context?.role === 'owner' || context?.sensitive?.[sensitiveId] === true;
}

export async function loadAccessRegistry() {
  const result = await supa.readAppSetting(USER_ACCESS_KEY);
  if (!result.ok && !supa.isEnabled() && process.env.NODE_ENV !== 'production') {
    const localValue = (db.get(LOCAL_ACCESS_TABLE) || [])[0]?.value || null;
    if (!localValue) return { configured: false, users: [], roles: defaultRoles() };
    const source = Array.isArray(localValue) ? localValue : localValue?.users;
    const roleSource = Array.isArray(localValue?.roles) ? localValue.roles : [];
    const storedVersion = Number(localValue?.version || 1);
    return {
      configured: true,
      version: 2,
      users: (Array.isArray(source) ? source : []).map(normalizeAccessEntry).filter(Boolean),
      roles: storedVersion >= 2
        ? roleSource.map(normalizeAccessRoleDefinition).filter(Boolean)
        : mergeDefaultRoles(roleSource),
    };
  }
  if (!result.ok) return { configured: supa.isEnabled(), unavailable: true, users: [], roles: defaultRoles() };
  if (!result.configured) return { configured: false, users: [], roles: defaultRoles() };
  const source = Array.isArray(result.value) ? result.value : result.value?.users;
  const roleSource = Array.isArray(result.value?.roles) ? result.value.roles : [];
  const storedVersion = Number(result.value?.version || 1);
  return {
    configured: true,
    version: 2,
    users: (Array.isArray(source) ? source : []).map(normalizeAccessEntry).filter(Boolean),
    // Version 1 stored only the old custom role list, so seed the new presets once
    // during migration. Version 2 is authoritative: a deliberately deleted preset
    // must not silently reappear on the next read.
    roles: storedVersion >= 2
      ? roleSource.map(normalizeAccessRoleDefinition).filter(Boolean)
      : mergeDefaultRoles(roleSource),
  };
}

function configuredEmailUsers(role) {
  const source = role === 'owner' ? process.env.CRM_OWNER_EMAILS : process.env.CRM_STAFF_EMAILS;
  return [...emailSet(source)].map((email) => ({ email, role }));
}

function displayName(authUser, fallback) {
  return String(authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || fallback).trim();
}

function enrichAuthorizedRow(row, registry) {
  const match = employeeMatchForEmail(row.email);
  const roleIds = row.role === 'owner' ? ['owner'] : unique(row.role_ids);
  return {
    ...row,
    role_ids: roleIds,
    role: row.role === 'owner' ? 'owner' : (roleIds[0] || 'employee'),
    role_names: row.role === 'owner'
      ? ['מנהל ראשי']
      : roleIds.map((id) => accessRole(registry, id)?.name || id),
    role_name: row.role === 'owner'
      ? 'מנהל ראשי'
      : roleIds.map((id) => accessRole(registry, id)?.name || id).join(' · '),
    ...match,
  };
}

export async function listAuthorizedUsers(currentOwner) {
  const [registry, authResult] = await Promise.all([loadAccessRegistry(), supa.listAuthUsers()]);
  const authUsers = authResult.ok ? authResult.users : [];
  const byEmail = new Map(authUsers.map((user) => [normalizeEmail(user.email), user]));
  const rows = new Map();
  for (const entry of registry.users) {
    const authUser = entry.auth_user_id
      ? authUsers.find((user) => String(user.id) === entry.auth_user_id)
      : byEmail.get(entry.email);
    rows.set(entry.email, enrichAuthorizedRow({
      ...entry,
      id: entry.id || authUser?.id || `email:${entry.email}`,
      auth_user_id: authUser?.id || entry.auth_user_id || null,
      name: entry.name || displayName(authUser, entry.email),
      status: entry.status === 'blocked' ? 'blocked' : (authUser?.last_sign_in_at ? 'active' : entry.status),
    }, registry));
  }
  for (const user of authUsers) {
    const email = normalizeEmail(user.email);
    const role = legacyCrmRole(user);
    if (!email || role !== 'owner' || rows.has(email)) continue;
    rows.set(email, enrichAuthorizedRow({
      id: String(user.id), auth_user_id: String(user.id), name: displayName(user, email), email,
      role: 'owner', role_ids: ['owner'], status: 'active',
      invited_at: user.invited_at || user.created_at || null, updated_at: null,
    }, registry));
  }
  const configured = [
    ...configuredEmailUsers('owner'),
    ...(!registry.configured ? configuredEmailUsers('staff') : []),
    currentOwner ? { email: normalizeEmail(currentOwner.email), role: 'owner' } : null,
  ].filter(Boolean);
  for (const item of configured) {
    if (!item.email || rows.has(item.email)) continue;
    const authUser = byEmail.get(item.email);
    rows.set(item.email, enrichAuthorizedRow({
      id: String(authUser?.id || `email:${item.email}`), auth_user_id: authUser?.id || null,
      name: displayName(authUser, currentOwner?.email === item.email ? (currentOwner?.name || currentOwner?.email) : item.email),
      email: item.email, role: item.role, role_ids: item.role === 'owner' ? ['owner'] : ['staff'],
      status: item.role === 'owner' || authUser?.last_sign_in_at ? 'active' : 'invited',
      invited_at: authUser?.invited_at || authUser?.created_at || null, updated_at: null,
    }, registry));
  }
  return [...rows.values()].sort((a, b) => a.role !== b.role ? (a.role === 'owner' ? -1 : 1) : a.name.localeCompare(b.name, 'he'));
}

export async function getAuthorizedUserPreview(id, currentOwner) {
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  const rows = await listAuthorizedUsers(currentOwner);
  const target = rows.find((row) => String(row.id) === String(id));
  if (!target) throw Object.assign(new Error('המשתמש לא נמצא'), { statusCode: 404 });
  return previewAccessForEntry(target, registry);
}

export async function sendAuthorizedUserPasswordReset(id, currentOwner) {
  const rows = await listAuthorizedUsers(currentOwner);
  const target = rows.find((row) => String(row.id) === String(id));
  if (!target) throw Object.assign(new Error('המשתמש לא נמצא'), { statusCode: 404 });
  if (target.role === 'owner') {
    throw Object.assign(new Error('איפוס סיסמת המנהל הראשי מתבצע ממסך הכניסה'), { statusCode: 400 });
  }
  const result = await supa.sendPasswordResetEmail(target.email);
  if (!result.ok) throw new Error(result.error || 'שליחת קישור האיפוס נכשלה');
  return { success: true, email: target.email };
}

async function saveRegistry(registry) {
  const value = {
    version: 2,
    users: registry.users,
    roles: registry.roles,
  };
  if (!supa.isEnabled() && process.env.NODE_ENV !== 'production') {
    db.set(LOCAL_ACCESS_TABLE, [{ id: USER_ACCESS_KEY, value, updated_at: new Date().toISOString() }]);
    return;
  }
  const result = await supa.setAppSetting(USER_ACCESS_KEY, value);
  if (!result.ok) throw new Error(result.error || 'שמירת הגדרות ההרשאה נכשלה');
}

async function saveStaffRows(rows, roles = null) {
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  const now = new Date().toISOString();
  const users = rows.filter((row) => row.role !== 'owner').map((row) => normalizeAccessEntry({
    ...row, id: row.id?.startsWith('email:') ? randomUUID() : row.id, updated_at: now,
  })).filter(Boolean);
  await saveRegistry({ users, roles: roles || registry.roles });
  return users;
}

function validateRoleIds(registry, values) {
  const roleIds = unique(values);
  if (roleIds.some((id) => !accessRole(registry, id))) {
    throw Object.assign(new Error('אחד מתפקידי המשתמש אינו נתמך'), { statusCode: 400 });
  }
  return roleIds;
}

export async function inviteAuthorizedUser({ name, email, role, role_ids: rawRoleIds, employee_access_requested: employeeAccessRequested }, currentOwner) {
  const normalizedEmail = normalizeEmail(email);
  const cleanName = String(name || '').trim();
  if (!cleanName) throw Object.assign(new Error('שם המשתמש הוא שדה חובה'), { statusCode: 400 });
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw Object.assign(new Error('כתובת המייל אינה תקינה'), { statusCode: 400 });
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  const requested = Array.isArray(rawRoleIds) ? rawRoleIds : (role ? [role] : []);
  const roleIds = validateRoleIds(registry, requested);
  const employeeMatch = validateRequestedEmployeeAccess(normalizedEmail, employeeAccessRequested === true);
  if (!roleIds.length && !employeeMatch.employee_id) {
    throw Object.assign(new Error('יש לבחור לפחות תפקיד אחד או לקשר את המייל לתיק עובד'), { statusCode: 400 });
  }
  const rows = await listAuthorizedUsers(currentOwner);
  if (rows.some((row) => row.email === normalizedEmail)) {
    throw Object.assign(new Error('כתובת המייל כבר ברשימה; ניתן לעדכן את הגישה בשורה הקיימת'), { statusCode: 409 });
  }
  const found = await supa.findAuthUserByEmail(normalizedEmail);
  if (!found.ok) throw new Error(found.error || 'בדיקת חשבון המשתמש נכשלה');
  let authUser = found.user;
  if (!authUser) {
    const invited = await supa.inviteAuthUser(normalizedEmail, cleanName);
    if (!invited.ok) throw new Error(invited.error || 'שליחת ההזמנה נכשלה');
    authUser = invited.user;
  }
  const now = new Date().toISOString();
  const next = {
    id: String(authUser?.id || randomUUID()), auth_user_id: authUser?.id ? String(authUser.id) : null,
    name: cleanName, email: normalizedEmail, role_ids: roleIds, role: roleIds[0] || 'employee',
    status: authUser?.last_sign_in_at ? 'active' : 'invited',
    invited_at: authUser?.invited_at || authUser?.created_at || now, updated_at: now,
  };
  await saveStaffRows([...rows.filter((row) => row.email !== normalizedEmail), next]);
  return enrichAuthorizedRow(next, registry);
}

export async function updateAuthorizedUser(id, patch, currentOwner) {
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  const status = patch?.status;
  if (status !== undefined && (!USER_STATUSES.has(status) || status === 'invited')) {
    throw Object.assign(new Error('סטטוס המשתמש אינו נתמך'), { statusCode: 400 });
  }
  const hasRoles = patch?.role_ids !== undefined || patch?.role !== undefined;
  const nextRoles = hasRoles
    ? validateRoleIds(registry, patch.role_ids !== undefined ? patch.role_ids : [patch.role])
    : null;
  if (status === undefined && !hasRoles) throw Object.assign(new Error('לא נשלח עדכון תקין'), { statusCode: 400 });
  const rows = await listAuthorizedUsers(currentOwner);
  const target = rows.find((row) => String(row.id) === String(id));
  if (!target) throw Object.assign(new Error('המשתמש לא נמצא'), { statusCode: 404 });
  if (target.role === 'owner') throw Object.assign(new Error('לא ניתן לשנות את המנהל הראשי'), { statusCode: 400 });
  if (nextRoles?.length === 0 && !target.employee_id) {
    throw Object.assign(new Error('משתמש שאינו מקושר לעובד חייב לפחות תפקיד אחד'), { statusCode: 400 });
  }
  const updated = {
    ...target,
    ...(status !== undefined ? { status } : {}),
    ...(nextRoles ? { role_ids: nextRoles, role: nextRoles[0] || 'employee' } : {}),
    updated_at: new Date().toISOString(),
  };
  await saveStaffRows(rows.map((row) => row.id === target.id ? updated : row));
  return enrichAuthorizedRow(updated, registry);
}

export async function removeAuthorizedUser(id, currentOwner) {
  const rows = await listAuthorizedUsers(currentOwner);
  const target = rows.find((row) => String(row.id) === String(id));
  if (!target) throw Object.assign(new Error('המשתמש לא נמצא'), { statusCode: 404 });
  if (target.role === 'owner') throw Object.assign(new Error('לא ניתן להסיר את המנהל הראשי'), { statusCode: 400 });
  await saveStaffRows(rows.filter((row) => row.id !== target.id));
  return { success: true, id: target.id, email: target.email };
}

export async function listAccessRoles() {
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  return {
    version: 2,
    permissions: OPERATIONAL_PERMISSIONS,
    modules: MODULE_CATALOG,
    sensitive: SENSITIVE_CATALOG,
    roles: [
      {
        id: 'owner', name: 'מנהל ראשי', modules: { ...ALL_EDIT }, sensitive: { finance: true, hr: true },
        permissions: ['*'], locked: true, system: true,
      },
      {
        id: 'employee', name: 'עובד', modules: modulesOf(), sensitive: { finance: false, hr: false },
        permissions: [], locked: true, system: true, selfAccess: true,
      },
      ...registry.roles,
    ],
  };
}

function validateRoleDraft(draft) {
  const name = String(draft?.name || '').trim();
  if (!name) throw Object.assign(new Error('שם התפקיד הוא שדה חובה'), { statusCode: 400 });
  const source = draft?.modules && typeof draft.modules === 'object' ? draft.modules : legacyModules(draft?.permissions);
  for (const [id, level] of Object.entries(source)) {
    if (!MODULE_IDS.has(id) || !ACCESS_LEVELS.has(String(level))) {
      throw Object.assign(new Error('נשלחה הרשאה שאינה נתמכת'), { statusCode: 400 });
    }
  }
  const modules = modulesOf(source);
  return {
    name,
    modules,
    sensitive: { finance: draft?.sensitive?.finance === true, hr: draft?.sensitive?.hr === true },
    permissions: legacyPermissionIds(modules),
  };
}

export async function createAccessRole(draft) {
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  const clean = validateRoleDraft(draft);
  if (registry.roles.some((role) => role.name.toLowerCase() === clean.name.toLowerCase())) {
    throw Object.assign(new Error('כבר קיים תפקיד בשם הזה'), { statusCode: 409 });
  }
  const role = { id: `role-${randomUUID()}`, ...clean };
  await saveRegistry({ users: registry.users, roles: [...registry.roles, role] });
  return role;
}

export async function updateAccessRole(id, patch) {
  if (id === 'owner' || id === 'employee') throw Object.assign(new Error('לא ניתן לערוך תפקיד מערכת'), { statusCode: 400 });
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  const current = registry.roles.find((role) => role.id === id);
  if (!current) throw Object.assign(new Error('התפקיד לא נמצא'), { statusCode: 404 });
  const clean = validateRoleDraft({ ...current, ...patch });
  if (registry.roles.some((role) => role.id !== id && role.name.toLowerCase() === clean.name.toLowerCase())) {
    throw Object.assign(new Error('כבר קיים תפקיד בשם הזה'), { statusCode: 409 });
  }
  const updated = { ...current, ...clean };
  await saveRegistry({ users: registry.users, roles: registry.roles.map((role) => role.id === id ? updated : role) });
  return updated;
}

export async function deleteAccessRole(id, replacementRoleId = null) {
  if (id === 'owner' || id === 'employee') throw Object.assign(new Error('לא ניתן למחוק תפקיד מערכת'), { statusCode: 400 });
  const registry = ensureRegistryAvailable(await loadAccessRegistry());
  if (!registry.roles.some((role) => role.id === id)) throw Object.assign(new Error('התפקיד לא נמצא'), { statusCode: 404 });
  const assigned = registry.users.filter((user) => user.role_ids.includes(id));
  let replacement = null;
  if (assigned.length) {
    replacement = accessRole(registry, replacementRoleId);
    if (!replacement || replacement.id === id) {
      throw Object.assign(new Error('יש לבחור תפקיד חלופי למשתמשים המשויכים'), { statusCode: 409, assignedCount: assigned.length });
    }
  }
  const users = registry.users.map((user) => {
    if (!user.role_ids.includes(id)) return user;
    return normalizeAccessEntry({
      ...user,
      role_ids: unique([...user.role_ids.filter((roleId) => roleId !== id), replacement.id]),
    });
  });
  await saveRegistry({ users, roles: registry.roles.filter((role) => role.id !== id) });
  return { success: true, id, reassigned: assigned.length, replacement_role_id: replacement?.id || null };
}
