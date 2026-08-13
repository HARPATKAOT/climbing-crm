import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchEventHostParent,
  normalizeEventHostProfile,
  resolveEventHostRecipient,
} from './eventHostProfile.js';

const complete = {
  firstName: 'דנה',
  lastName: 'כהן',
  idNumber: '123456782',
  phone: '054-682-9982',
  email: 'Dana@Example.com',
  city: 'תל מונד',
  gender: 'female',
  birthDate: '1990-05-12',
};

test('event host profile uses the WhatsApp destination as the locked phone', () => {
  const profile = normalizeEventHostProfile(
    { ...complete, phone: '0500000000' },
    '0546829982'
  );
  assert.equal(profile.phone, '972546829982');
  assert.equal(profile.name, 'דנה כהן');
  assert.equal(profile.email, 'dana@example.com');
  assert.equal(profile.relation, 'mother');
});

test('event host profile requires all parent-card fields', () => {
  assert.throws(
    () => normalizeEventHostProfile({ ...complete, city: '' }),
    /מקום מגורים/
  );
});

test('event host parent matches by identity or normalized phone', () => {
  const profile = normalizeEventHostProfile(complete);
  const parent = { id: 'p1', phone: '+972 54 682 9982', idNumber: '' };
  assert.equal(matchEventHostParent([parent], profile), parent);
});

test('event host identity conflict is blocked before a write', () => {
  const profile = normalizeEventHostProfile(complete);
  assert.throws(
    () => matchEventHostParent([
      { id: 'p1', phone: '0546829982', idNumber: '' },
      { id: 'p2', phone: '0500000000', idNumber: '123456782' },
    ], profile),
    /שני כרטיסי לקוח/
  );
});

test('manual event host recipient uses an unknown typed phone instead of the saved host', () => {
  const saved = { id: 'p1', phone: '0500000000' };
  const recipient = resolveEventHostRecipient({
    parents: [saved],
    activity: { host_parent_id: saved.id, host_phone: saved.phone },
    requestedPhone: '054-682-9982',
    manualRecipient: true,
  });
  assert.equal(recipient.parentId, null);
  assert.equal(recipient.parent, null);
  assert.equal(recipient.phone, '054-682-9982');
});
