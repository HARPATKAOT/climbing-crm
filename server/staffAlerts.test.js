import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertRecipients,
  employeeAlertKeys,
  isStaffAlertKey,
  STAFF_ALERT_KINDS,
} from './staffAlerts.js';

/** Only `get` is used by the resolver. */
function fakeStore(employees = []) {
  return { get: (name) => (name === 'employees' ? employees : []) };
}

test('every alert kind is a key with a label a person can read', () => {
  for (const alert of STAFF_ALERT_KINDS) {
    assert.match(alert.key, /^[a-z_]+$/);
    assert.ok(alert.label.length > 2);
  }
  assert.equal(isStaffAlertKey('handoff'), true);
  assert.equal(isStaffAlertKey('whatever'), false);
});

test('an employee gets only the alerts they subscribed to', () => {
  assert.deepEqual(employeeAlertKeys({ alerts: ['handoff', 'placement'] }), ['handoff', 'placement']);
  // Unknown or duplicated keys are dropped rather than sent to nobody.
  assert.deepEqual(employeeAlertKeys({ alerts: ['handoff', 'handoff', 'nonsense'] }), ['handoff']);
  assert.deepEqual(employeeAlertKeys({}), []);
});

test('subscribers are found by kind, and each phone once', () => {
  const store = fakeStore([
    { name: 'מעוז', phone: '0501111111', alerts: ['handoff', 'placement'] },
    { name: 'חגי', phone: '0502222222', alerts: ['placement'] },
    { name: 'עידן', phone: '0501111111', alerts: ['handoff'] },
  ]);
  assert.deepEqual(alertRecipients(store, 'handoff', {}).phones, ['0501111111']);
  assert.deepEqual(alertRecipients(store, 'placement', {}).phones, ['0501111111', '0502222222']);
});

test('an archived employee, or one with no phone, is skipped', () => {
  const store = fakeStore([
    { name: 'בארכיון', phone: '0503333333', is_active: false, alerts: ['handoff'] },
    { name: 'בלי טלפון', phone: '', alerts: ['handoff'] },
  ]);
  assert.deepEqual(alertRecipients(store, 'handoff', {}).phones, []);
});

test('with nobody subscribed the old settings field still delivers', () => {
  const store = fakeStore([{ name: 'מעוז', phone: '0501111111', alerts: [] }]);
  const result = alertRecipients(store, 'handoff', { aiStaffPhones: '0509999999, 0508888888' });
  assert.deepEqual(result.phones, ['0509999999', '0508888888']);
  assert.equal(result.source, 'settings');
});

test('a subscriber wins over the settings field', () => {
  const store = fakeStore([{ name: 'מעוז', phone: '0501111111', alerts: ['handoff'] }]);
  const result = alertRecipients(store, 'handoff', { aiStaffPhones: '0509999999' });
  assert.deepEqual(result.phones, ['0501111111']);
  assert.equal(result.source, 'employees');
});

test('an unknown alert kind reaches nobody', () => {
  const store = fakeStore([{ name: 'מעוז', phone: '0501111111', alerts: ['handoff'] }]);
  assert.deepEqual(alertRecipients(store, 'made_up', { aiStaffPhones: '0509999999' }).phones, []);
});
