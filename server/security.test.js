import test from 'node:test';
import assert from 'node:assert/strict';
import './publicRedirectMigration.test.js';
import {
  allowedCorsOrigins,
  issueEmployeeOnboardInvite,
  issueOAuthState,
  issuePublicRedirectToken,
  requireCronSecret,
  resolvePublicRedirectRecordId,
  safeIcountDocumentUrl,
  safeHttpsRedirectUrl,
  securityLogRef,
  verifyEmployeeOnboardInvite,
  verifyOAuthState,
  verifyPublicRedirectToken,
} from './security.js';

test('security log references are stable and do not reveal their input', () => {
  const reference = securityLogRef('+972501234567');
  assert.equal(reference, securityLogRef('+972501234567'));
  assert.equal(reference.includes('1234567'), false);
  assert.equal(reference.length, 12);
});

test('employee onboarding invites are signed, expiring and purpose-bound', () => {
  const secret = 'employee-test-secret';
  const now = 1_800_000_000_000;
  const invite = issueEmployeeOnboardInvite({ secret, now, nonce: 'e'.repeat(24) });
  const verified = verifyEmployeeOnboardInvite(invite.token, { secret, now });
  assert.equal(typeof verified?.inviteId, 'string');
  assert.equal(verified?.inviteId.length, 64);
  assert.equal(verified?.expiresAt, invite.expiresAt);
  assert.equal(verifyEmployeeOnboardInvite(`${invite.token}x`, { secret, now }), null);
  assert.equal(verifyEmployeeOnboardInvite(invite.token, { secret, now: invite.expiresAt + 1 }), null);
});

test('OAuth state is provider-bound, expiring and tamper evident', () => {
  const secret = 'test-secret';
  const now = 1_800_000_000_000;
  const state = issueOAuthState('google-calendar', { secret, now, nonce: 'n'.repeat(24) });
  assert.equal(verifyOAuthState(state, 'google-calendar', { secret, now }), true);
  assert.equal(verifyOAuthState(state, 'google-contacts', { secret, now }), false);
  assert.equal(verifyOAuthState(`${state}x`, 'google-calendar', { secret, now }), false);
  assert.equal(verifyOAuthState(state, 'google-calendar', { secret, now: now + 10 * 60 * 1000 + 1 }), false);
});

test('public redirect tokens are purpose-bound and tamper evident', () => {
  const secret = 'redirect-test-secret';
  const token = issuePublicRedirectToken('payment', 'pa1786685901000', { secret });
  assert.notEqual(token, 'pa1786685901000');
  assert.equal(verifyPublicRedirectToken(token, 'payment', { secret }), 'pa1786685901000');
  assert.equal(verifyPublicRedirectToken(token, 'sale-document', { secret }), null);
  assert.equal(verifyPublicRedirectToken(`${token}x`, 'payment', { secret }), null);
  assert.equal(verifyPublicRedirectToken('pa1786685901000', 'payment', { secret }), null);
  assert.equal(resolvePublicRedirectRecordId(token, 'payment', { secret }), 'pa1786685901000');
  assert.equal(resolvePublicRedirectRecordId('pa1786685901000', 'payment', {
    legacyCutoffMs: 1786685901000,
  }), 'pa1786685901000');
  assert.equal(resolvePublicRedirectRecordId('pa1786685901001', 'payment', {
    legacyCutoffMs: 1786685901000,
  }), null);
  assert.equal(resolvePublicRedirectRecordId('po1786685901000', 'payment', {
    legacyCutoffMs: 1786685901000,
  }), null);
});

test('iCount document downloads cannot target internal or untrusted hosts', () => {
  assert.equal(safeIcountDocumentUrl('https://app.icount.co.il/doc/1')?.startsWith('https://app.icount.co.il/'), true);
  assert.equal(safeIcountDocumentUrl('http://app.icount.co.il/doc/1'), null);
  assert.equal(safeIcountDocumentUrl('https://127.0.0.1/admin'), null);
  assert.equal(safeIcountDocumentUrl('https://icount.co.il.attacker.example/doc'), null);
  assert.equal(safeIcountDocumentUrl('https://trusted-cdn.example/doc', 'trusted-cdn.example')?.startsWith('https://trusted-cdn.example/'), true);
});

test('stored public redirects allow only credential-free HTTPS targets', () => {
  assert.equal(safeHttpsRedirectUrl('https://signup.example.test/form')?.startsWith('https://'), true);
  assert.equal(safeHttpsRedirectUrl('http://signup.example.test/form'), null);
  assert.equal(safeHttpsRedirectUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsRedirectUrl('https://user:pass@signup.example.test/form'), null);
});

test('production CORS never trusts localhost or insecure configured origins', () => {
  const production = allowedCorsOrigins([
    'http://localhost:7777',
    'http://insecure.example.com',
    'https://admin.example.com/path',
  ], 'production');
  assert.equal(production.has('http://localhost:7777'), false);
  assert.equal(production.has('http://insecure.example.com'), false);
  assert.equal(production.has('https://admin.example.com'), true);
  assert.equal(allowedCorsOrigins([], 'development').has('http://localhost:5173'), true);
});

test('cron middleware fails closed and only accepts the secret header', () => {
  const previous = process.env.CRON_SECRET;
  const responses = [];
  const res = {
    status(code) { this.code = code; return this; },
    json(body) { responses.push({ code: this.code, body }); return this; },
  };
  try {
    delete process.env.CRON_SECRET;
    requireCronSecret({ get: () => '' }, res, () => assert.fail('must fail closed'));
    assert.equal(responses.at(-1).code, 503);

    process.env.CRON_SECRET = 'expected-secret';
    requireCronSecret({ get: () => 'wrong' }, res, () => assert.fail('must reject'));
    assert.equal(responses.at(-1).code, 401);

    let called = false;
    requireCronSecret({ get: (name) => name === 'x-cron-secret' ? 'expected-secret' : '' }, res, () => { called = true; });
    assert.equal(called, true);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
