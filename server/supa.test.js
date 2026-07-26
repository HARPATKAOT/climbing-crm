import test from 'node:test';
import assert from 'node:assert/strict';
import { isServiceRoleKey, parentFromRow, parentToRow } from './supa.js';

function unsignedJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

test('service key validation rejects a public key hidden in the service variable', () => {
  assert.equal(isServiceRoleKey(unsignedJwt({ role: 'anon' })), false);
  assert.equal(isServiceRoleKey(unsignedJwt({ role: 'service_role' })), true);
  assert.equal(isServiceRoleKey('sb_secret_example'), true);
  assert.equal(isServiceRoleKey('not-a-key'), false);
});

test('parent mapper exposes next_followup as nextFollowup', () => {
  const parent = parentFromRow({
    id: 'p1',
    name: 'Test',
    next_followup: '2026-08-03',
  });

  assert.equal(parent.nextFollowup, '2026-08-03');
});

test('parent mapper persists nextFollowup and allows clearing it', () => {
  assert.equal(
    parentToRow({ id: 'p1', nextFollowup: '2026-08-03' }).next_followup,
    '2026-08-03'
  );
  assert.equal(parentToRow({ id: 'p1', nextFollowup: '' }).next_followup, null);
});

test('parent mapper preserves last name and identity number', () => {
  const parent = parentFromRow({
    id: 'p1',
    name: 'דלק אייל',
    last_name: 'אייל',
    id_number: '032702656',
  });
  assert.equal(parent.lastName, 'אייל');
  assert.equal(parent.idNumber, '032702656');

  const row = parentToRow(parent);
  assert.equal(row.last_name, 'אייל');
  assert.equal(row.id_number, '032702656');
});
