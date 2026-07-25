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
  assert.equal(isPublicApiPath('/api/whatsapp/webhook'), true);
  assert.equal(isPublicApiPath('/api/attendance/ensure-today'), true);
  assert.equal(isPublicApiPath('/api/automations/run-scheduled'), true);
  assert.equal(isPublicApiPath('/api/google-calendar/webhook'), true);
  assert.equal(isPublicApiPath('/api/google-calendar/oauth/callback'), true);
  assert.equal(isPublicApiPath('/api/parents'), false);
  assert.equal(isPublicApiPath('/api/payments'), false);
});

test('staff can operate leads and attendance but cannot access billing or settings', () => {
  assert.equal(isStaffRequestAllowed('GET', '/api/students'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/attendance/bulk'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/whatsapp/reply'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/trainers'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/payments'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/icount/invoice'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/whatsapp/settings'), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/employees'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/pos/sale'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/pos/passes'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/pos/passes/abc/punch'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/pricelist'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/cash-register'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/cash-register'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/pos/sales'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/pos/reports'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/pos/sync-inventory'), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/activities'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/activities'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/activities/unpaid-open'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/activity-templates'), true);
  assert.equal(isStaffRequestAllowed('PATCH', '/api/activities/abc/payment-status'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/google-calendar/status'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/google-calendar/sync'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/google-calendar/auth-url'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/google-calendar/disconnect'), false);
  assert.equal(isStaffRequestAllowed('GET', '/api/safety/due-today'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/inspections'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/safety/check-types'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/check-types'), true);
  assert.equal(isStaffRequestAllowed('PUT', '/api/safety/check-types/abc'), true);
  assert.equal(isStaffRequestAllowed('DELETE', '/api/safety/check-types/abc'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/safety/incidents'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/level-tests'), true);
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
