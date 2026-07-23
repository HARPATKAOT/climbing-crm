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
  assert.equal(isPublicApiPath('/api/whatsapp/webhook'), true);
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
  assert.equal(isStaffRequestAllowed('GET', '/api/employees'), false);
  assert.equal(isStaffRequestAllowed('POST', '/api/pos/sale'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/pos/passes'), true);
  assert.equal(isStaffRequestAllowed('POST', '/api/pos/passes/abc/punch'), true);
  assert.equal(isStaffRequestAllowed('GET', '/api/pricelist'), true);
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
