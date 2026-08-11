import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPublicApiPath,
  isStaffRequestAllowed,
  resolveCrmRole,
} from './auth.js';

test('public API contains forms and signed webhook entrypoints only', () => {
  assert.equal(isPublicApiPath('/api/public/leads'), true);
  assert.equal(isPublicApiPath('/api/public/health-declarations'), true);
  assert.equal(isPublicApiPath('/api/public/activities/abc123'), true);
  assert.equal(isPublicApiPath('/api/public/host-payments/private-token'), true);
  assert.equal(isPublicApiPath('/api/public/equipment/demo-token'), true);
  assert.equal(isPublicApiPath('/api/whatsapp/webhook'), true);
  assert.equal(isPublicApiPath('/api/attendance/ensure-today'), true);
  assert.equal(isPublicApiPath('/api/automations/run-scheduled'), true);
  assert.equal(isPublicApiPath('/api/google-calendar/webhook'), true);
  assert.equal(isPublicApiPath('/api/google-calendar/oauth/callback'), true);
  assert.equal(isPublicApiPath('/api/google-contacts/oauth/callback'), true);
  assert.equal(isPublicApiPath('/api/parents'), false);
  assert.equal(isPublicApiPath('/api/payments'), false);
});

test('legacy operational staff can use attendance, safety and wall-entry APIs only', () => {
  assert.equal(isStaffRequestAllowed('GET', '/api/operations/roster'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/attendance/bulk'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/trainers'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/payments'), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/safety/due-today'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/inspections'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/safety/check-types'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/check-types'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/incidents'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/students'), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/employees'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/groups'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/wall-shift/open'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/cash-register/session'), false);
});

test('custom staff permissions are enforced per operational capability', () => {
  assert.equal(isStaffRequestAllowed('POST', '/api/attendance/bulk', ['attendance']), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/inspections', ['attendance']), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/check-ins', ['wall_entry']), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/operations/roster', ['wall_entry']), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/operations/roster', ['safety']), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/auth/me', []), true);
});

test('module levels and sensitive grants are both enforced', () => {
  const context = {
    role: 'staff',
    modules: { activities: 'view', activity_registrations: 'edit', cash_management: 'edit' },
    sensitive: { finance: false, hr: false },
  };
  assert.equal(isStaffRequestAllowed('GET', '/api/activities', context), true);
  assert.equal(isStaffRequestAllowed('PUT', '/api/activities/a1', context), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/activities/a1/registrations', context), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/cash-register/session', context), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/cash-register/open', context), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/cash-register/close', context), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/cash-register/reset', context), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/cash-register/ledger', context), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/payments', context), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/activities/a1/host-payment/invoice', context), false);
});

test('self employee routes require an employee link', () => {
  const base = { role: 'staff', modules: {}, sensitive: {} };
  assert.equal(isStaffRequestAllowed('GET', '/api/me/employee', base), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/me/employee', { ...base, employee_id: 'emp-1' }), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/settings/users/user-1/employee-file', { ...base, employee_id: 'emp-1' }), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/employees/emp-2/payroll-documents', { ...base, employee_id: 'emp-1' }), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/employees/emp-2/payroll-documents', {
    ...base,
    modules: { hr: 'view' },
    sensitive: { hr: true },
  }), true);
});

test('roles resolve from metadata and configured email lists', () => {
  const oldOwnerEmails = process.env.CRM_OWNER_EMAILS;
  const oldStaffEmails = process.env.CRM_STAFF_EMAILS;
  process.env.CRM_OWNER_EMAILS = 'owner@example.com';
  process.env.CRM_STAFF_EMAILS = 'team@example.com';
  try {
    assert.equal(resolveCrmRole({ email: 'OWNER@example.com' }), 'owner');
    assert.equal(resolveCrmRole({ email: 'team@example.com' }), 'staff');
    assert.equal(resolveCrmRole({ app_metadata: { crm_role: 'admin' } }), 'owner');
    assert.equal(resolveCrmRole({ user_metadata: { crm_role: 'staff' } }), 'staff');
    assert.equal(resolveCrmRole({ email: 'unknown@example.com' }), null);
  } finally {
    if (oldOwnerEmails === undefined) delete process.env.CRM_OWNER_EMAILS;
    else process.env.CRM_OWNER_EMAILS = oldOwnerEmails;
    if (oldStaffEmails === undefined) delete process.env.CRM_STAFF_EMAILS;
    else process.env.CRM_STAFF_EMAILS = oldStaffEmails;
  }
});

test('a wall station can print a receipt and kick the drawer without finance access', () => {
  // ההדפסה היא פעולת דלפק ולא דוח כספי; בלעדיה עמדת הקיר לא מדפיסה כלל.
  const station = {
    role: 'staff',
    modules: { cash_management: 'edit', checkin: 'edit' },
    sensitive: { finance: false, hr: false },
  };
  assert.equal(isStaffRequestAllowed('POST', '/api/cash-register/receipt-bytes', station), true);
  // ודוחות הקופה עצמם נשארים חסומים.
  assert.equal(isStaffRequestAllowed('GET', '/api/cash-register/ledger', station), false);
});
