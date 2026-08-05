import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accessAtLeast,
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
