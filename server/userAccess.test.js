import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessAtLeast,
  applyPermissionOverrides,
  employeeMatchForAccessEntry,
  employeeMatchForEmail,
  hasSensitiveAccess,
  normalizeAccessEntry,
  previewAccessForEntry,
  resolveAccessContext,
  resolveAccessRole,
  validateRequestedEmployeeAccess,
} from './userAccess.js';

const activeUser = (email, roleIds = ['staff']) => normalizeAccessEntry({
  email,
  role_ids: roleIds,
  status: 'active',
});

test('managed access rejects invited, blocked and removed users', () => {
  const registry = { configured: true, users: [
    activeUser('active@example.com'),
    normalizeAccessEntry({ email: 'invite@example.com', status: 'invited' }),
    normalizeAccessEntry({ email: 'blocked@example.com', status: 'blocked' }),
  ] };
  assert.equal(resolveAccessRole({ email: 'active@example.com' }, registry), 'staff');
  assert.equal(resolveAccessRole({ email: 'invite@example.com' }, registry), null);
  assert.equal(resolveAccessRole({ email: 'invite@example.com', last_sign_in_at: '2026-08-04' }, registry), 'staff');
  assert.equal(resolveAccessRole({ email: 'blocked@example.com', last_sign_in_at: '2026-08-04' }, registry), null);
  assert.equal(resolveAccessRole({ email: 'unknown@example.com', app_metadata: { crm_role: 'staff' } }, registry), null);
});

test('owner remains primary administrator and legacy roles work before setup', () => {
  assert.equal(resolveAccessRole({ app_metadata: { crm_role: 'owner' } }, { configured: true, users: [] }), 'owner');
  assert.equal(resolveAccessRole({ user_metadata: { crm_role: 'team' } }), 'staff');
});

test('multiple roles merge the highest module level and sensitive grants', () => {
  const registry = {
    configured: true,
    roles: [
      { id: 'coach', name: 'Coach', modules: { classes: 'view', attendance: 'edit' } },
      { id: 'finance-viewer', name: 'Finance', modules: { classes: 'edit' }, sensitive: { finance: true } },
    ],
    users: [activeUser('combined@example.com', ['coach', 'finance-viewer'])],
  };
  const context = resolveAccessContext({ email: 'combined@example.com' }, registry, []);
  assert.deepEqual(context.roleIds, ['coach', 'finance-viewer']);
  assert.equal(context.modules.classes, 'edit');
  assert.equal(context.modules.attendance, 'edit');
  assert.equal(accessAtLeast(context, 'classes', 'edit'), true);
  assert.equal(hasSensitiveAccess(context, 'finance'), true);
  assert.equal(hasSensitiveAccess(context, 'hr'), false);
});

test('personal overrides can raise or lower role access and sensitive grants', () => {
  const base = {
    modules: { classes: 'view', attendance: 'edit', customers: 'none' },
    sensitive: { finance: true, hr: false },
  };
  const effective = applyPermissionOverrides(base, {
    modules: { classes: 'edit', attendance: 'none', customers: 'view' },
    sensitive: { finance: false, hr: true },
  });
  assert.equal(effective.modules.classes, 'edit');
  assert.equal(effective.modules.attendance, 'none');
  assert.equal(effective.modules.customers, 'view');
  assert.equal(effective.sensitive.finance, false);
  assert.equal(effective.sensitive.hr, true);
});

test('managed access applies stored personal overrides after merging roles', () => {
  const entry = normalizeAccessEntry({
    email: 'custom@example.com',
    status: 'active',
    role_ids: ['coach'],
    permission_overrides: {
      modules: { attendance: 'none', customers: 'edit' },
      sensitive: { finance: false, hr: true },
    },
  });
  const registry = {
    configured: true,
    roles: [{
      id: 'coach', name: 'Coach',
      modules: { attendance: 'edit', customers: 'view' },
      sensitive: { finance: true, hr: false },
    }],
    users: [entry],
  };
  const context = resolveAccessContext({ email: 'custom@example.com' }, registry, []);
  assert.equal(context.modules.attendance, 'none');
  assert.equal(context.modules.customers, 'edit');
  assert.equal(context.sensitive.finance, false);
  assert.equal(context.sensitive.hr, true);
  assert.deepEqual(context.permissionOverrides, entry.permission_overrides);
});

test('employee self access requires one email match and explicit active authorization', () => {
  const employees = [
    { id: 'emp-1', email: ' Worker@Example.com ' },
    { id: 'emp-2', email: 'duplicate@example.com' },
    { id: 'emp-3', email: ' DUPLICATE@example.com ' },
  ];
  assert.deepEqual(employeeMatchForEmail('worker@example.com', employees), {
    employee_id: 'emp-1', employee_match: 'matched',
  });
  assert.equal(employeeMatchForEmail('duplicate@example.com', employees).employee_match, 'duplicate');

  const registry = { configured: true, roles: [], users: [activeUser('worker@example.com', [])] };
  const employee = resolveAccessContext({ email: 'worker@example.com' }, registry, employees);
  assert.equal(employee.employee_id, 'emp-1');
  assert.deepEqual(employee.roleIds, []);
  assert.equal(resolveAccessContext({ email: 'not-in-registry@example.com' }, registry, employees), null);
});

test('requesting employee access requires one matching employee record', () => {
  const employees = [
    { id: 'emp-1', email: 'worker@example.com' },
    { id: 'emp-2', email: 'duplicate@example.com' },
    { id: 'emp-3', email: ' DUPLICATE@example.com ' },
  ];
  assert.equal(validateRequestedEmployeeAccess('worker@example.com', true, employees).employee_id, 'emp-1');
  assert.throws(
    () => validateRequestedEmployeeAccess('missing@example.com', true, employees),
    (error) => error.statusCode === 400 && error.message.includes('יש ליצור תחילה תיק עובד'),
  );
  assert.throws(
    () => validateRequestedEmployeeAccess('duplicate@example.com', true, employees),
    (error) => error.statusCode === 400 && error.message.includes('ביותר מתיק עובד אחד'),
  );
});

test('a shared wall station receives operational access without becoming an employee', () => {
  const station = normalizeAccessEntry({
    id: 'station-1',
    name: 'Wall computer',
    email: 'wall@example.com',
    account_type: 'shared_station',
    role_ids: ['wall-station'],
    status: 'active',
  });
  const employees = [{ id: 'emp-accidental', email: 'wall@example.com' }];

  assert.deepEqual(employeeMatchForAccessEntry(station, employees), {
    employee_id: null,
    employee_match: 'not_applicable',
  });

  const context = resolveAccessContext(
    { id: 'station-1', email: 'wall@example.com', last_sign_in_at: '2026-08-09' },
    { configured: true, roles: [], users: [station] },
    employees,
  );
  assert.equal(context.account_type, 'shared_station');
  assert.equal(context.employee_id, null);
  assert.deepEqual(context.roleIds, ['wall-station']);
  // מסך העבודה הוא של המנהל והמזכירה — לידים, משימות ופניות. עמדת הקיר
  // מקבלת את מסוף הכניסה, שבו נמצא כל מה שהיא צריכה, ולא את שניהם.
  assert.equal(context.modules.dashboard, 'none');
  assert.equal(context.modules.checkin, 'edit');
  assert.equal(context.modules.pos, 'edit');
  assert.equal(context.modules.cash_management, 'edit');
  assert.equal(context.modules.safety_checks, 'edit');
  assert.equal(context.modules.safety_tests, 'edit');
  assert.equal(context.modules.attendance, 'view');
  assert.equal(context.modules.employees, 'view');
  assert.equal(context.modules.shifts, 'edit');
  assert.equal(context.sensitive.finance, false);
  assert.equal(context.sensitive.hr, false);
});

test('owner preview merges roles and reports self-service without creating a session', () => {
  const registry = { roles: [
    { id: 'coach', name: 'מדריך', modules: { classes: 'view', attendance: 'edit' } },
    { id: 'safety', name: 'בטיחות', modules: { safety_checks: 'edit' }, sensitive: { finance: false } },
  ] };
  const preview = previewAccessForEntry(
    { id: 'u1', name: 'Worker', email: 'worker@example.com', status: 'active', role_ids: ['coach', 'safety'] },
    registry,
    [{ id: 'emp-1', email: 'worker@example.com' }],
  );
  assert.deepEqual(preview.role_names, ['עובד', 'מדריך', 'בטיחות']);
  assert.equal(preview.modules.attendance, 'edit');
  assert.equal(preview.modules.safety_checks, 'edit');
  assert.equal(preview.sensitive.finance, false);
  assert.equal(preview.employee_id, 'emp-1');
  assert.equal(preview.access_enabled, true);
});

test('user preview separates role access, personal overrides and effective access', () => {
  const registry = { roles: [
    { id: 'coach', name: 'מדריך', modules: { classes: 'view', attendance: 'edit' }, sensitive: { finance: false } },
  ] };
  const preview = previewAccessForEntry({
    id: 'u2', name: 'Custom', email: 'custom@example.com', status: 'active', role_ids: ['coach'],
    permission_overrides: { modules: { classes: 'edit', attendance: 'none' }, sensitive: { finance: true } },
  }, registry, []);
  assert.equal(preview.role_modules.classes, 'view');
  assert.equal(preview.role_modules.attendance, 'edit');
  assert.equal(preview.modules.classes, 'edit');
  assert.equal(preview.modules.attendance, 'none');
  assert.equal(preview.role_sensitive.finance, false);
  assert.equal(preview.sensitive.finance, true);
  assert.deepEqual(preview.permission_overrides, {
    modules: { classes: 'edit', attendance: 'none' },
    sensitive: { finance: true },
  });
});
