import test from 'node:test';
import assert from 'node:assert/strict';
import { WALL_STATION_ROLE } from './userAccess.js';
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

test('customer access does not inherit nested student permission domains', () => {
  const customersOnly = {
    role: 'staff',
    modules: { customers: 'edit' },
    sensitive: { finance: false, hr: false },
  };
  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1', customersOnly), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1/equipment', customersOnly), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/students/s1/equipment/payment-link', customersOnly), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1/wall-documents', customersOnly), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1/documents', customersOnly), false);
  assert.equal(isStaffRequestAllowed('DELETE', '/api/students/s1/health-declaration', customersOnly), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1/activity-registrations', customersOnly), false);
  assert.equal(isStaffRequestAllowed('PUT', '/api/students/s1/program-eligibility', customersOnly), false);

  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1/equipment', {
    ...customersOnly,
    modules: { equipment: 'view' },
  }), true);
  assert.equal(isStaffRequestAllowed('DELETE', '/api/students/s1/participation-waiver', {
    ...customersOnly,
    modules: { health: 'edit' },
  }), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/students/s1/activity-registrations', {
    ...customersOnly,
    modules: { activity_registrations: 'view' },
  }), true);
  assert.equal(isStaffRequestAllowed('PUT', '/api/students/s1', {
    ...customersOnly,
    modules: { classes: 'edit' },
  }), true);
  assert.equal(isStaffRequestAllowed('DELETE', '/api/students/s1', {
    ...customersOnly,
    modules: { classes: 'edit' },
  }), false);
  assert.equal(isStaffRequestAllowed('PUT', '/api/students/s1/program-eligibility', {
    ...customersOnly,
    modules: { classes: 'edit' },
  }), true);
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

test('a wall station can drive every button its own terminal shows', () => {
  // הכלל להסרה מרשימת הממתינים נשמט פעם אחת, והכפתורים במסך ענו „אין הרשאה”.
  // זו התקלה שקשה לאבחן: היא נראית כמו באג בקוד ולא כמו הרשאה חסרה, ולכן
  // כל פעולה שהמסוף מציג נבדקת כאן מול ההרשאות של עמדת הקיר עצמה.
  const station = {
    role: 'staff',
    modules: WALL_STATION_ROLE.modules,
    sensitive: { finance: false, hr: false },
  };
  const allowed = [
    ['GET', '/api/wall-shift/state'],
    ['POST', '/api/wall-shift/open'],
    ['POST', '/api/wall-shift/staff/clock-in'],
    ['POST', '/api/wall-shift/staff/clock-out'],
    ['POST', '/api/wall-shift/close'],
    ['GET', '/api/checkin/climber/s1'],
    ['GET', '/api/checkin/pending'],
    ['POST', '/api/checkin/pending/dismiss'],
    ['POST', '/api/checkin/pending/payment/ps1/handled'],
    ['POST', '/api/check-ins'],
    ['POST', '/api/pos/passes/cp1/punch'],
    ['POST', '/api/pos/sale'],
    ['POST', '/api/pos/payment-link'],
    ['POST', '/api/level-tests'],
    ['POST', '/api/safety/inspections'],
    ['POST', '/api/leads/s1/send-health-form'],
    ['POST', '/api/cash-register/open'],
    ['POST', '/api/cash-register/close'],
    ['POST', '/api/cash-register/receipt-bytes'],
  ];
  for (const [method, path] of allowed) {
    assert.equal(isStaffRequestAllowed(method, path, station), true, `${method} ${path} נחסם`);
  }

  // ומה שעדיין חסום לה בכוונה.
  assert.equal(isStaffRequestAllowed('GET', '/api/cash-register/ledger', station), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/finance/dashboard', station), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/dashboard', station), false);
});
