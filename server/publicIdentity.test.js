import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicIdentity } from './publicIdentity.js';

const parents = [
  { id: 'p1', phone: '050-886-2878', idNumber: '032702656' },
  { id: 'p2', phone: '0521112222', idNumber: '123456782' },
];

test('public identity needs both ID and phone', () => {
  assert.equal(resolvePublicIdentity(parents, { phone: '0508862878' }).status, 'incomplete');
  assert.equal(resolvePublicIdentity(parents, { idNumber: '032702656' }).status, 'incomplete');
});

test('matching normalized ID and phone identifies one parent', () => {
  const result = resolvePublicIdentity(parents, { phone: '+972 50-886-2878', idNumber: '032-702-656' });
  assert.equal(result.status, 'found');
  assert.equal(result.parent.id, 'p1');
});

test('an identifier conflict requires review and never becomes a new family', () => {
  const result = resolvePublicIdentity(parents, { phone: '0508862878', idNumber: '123456782' });
  assert.equal(result.status, 'review_required');
});

test('an unknown pair is a genuinely new identity', () => {
  assert.equal(resolvePublicIdentity(parents, { phone: '0545556677', idNumber: '222222224' }).status, 'new');
});

test('a phone match may safely complete a missing legacy ID', () => {
  const result = resolvePublicIdentity([{ id: 'legacy', phone: '0508862878', idNumber: '' }], {
    phone: '0508862878', idNumber: '032702656',
  });
  assert.equal(result.status, 'found');
  assert.equal(result.parent.id, 'legacy');
});

test('an ID on a different phone is not enough to expose the file', () => {
  assert.equal(resolvePublicIdentity(parents, {
    phone: '0545556677', idNumber: '032702656',
  }).status, 'review_required');
});
