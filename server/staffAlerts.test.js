import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alertRecipients,
  alertSettings,
  alertSubscribers,
  employeeAccessLevel,
  employeeAlertKeys,
  isStaffAlertKey,
  reminderLeadHours,
  visibleAlertKeys,
  STAFF_ALERT_CATEGORIES,
  STAFF_ALERT_KINDS,
} from './staffAlerts.js';
import {
  STAFF_ALERT_KINDS as CLIENT_ALERT_KINDS,
  STAFF_ALERT_CATEGORIES as CLIENT_CATEGORIES,
} from '../client/src/utils/staffAlerts.js';

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

test('an alert about one person\'s own shift never falls back to the team number', () => {
  const store = fakeStore([{ name: 'מעוז', phone: '0501111111', alerts: [] }]);
  assert.deepEqual(alertRecipients(store, 'shift_reminder', { aiStaffPhones: '0509999999' }).phones, []);
});

test('an own-scoped alert is narrowed to the people it is about', () => {
  const store = fakeStore([
    { id: 'e1', name: 'מדריך הקבוצה', phone: '050', alerts: ['group_student_left'] },
    { id: 'e2', name: 'מדריך אחר', phone: '051', alerts: ['group_student_left'] },
  ]);
  assert.deepEqual(
    alertSubscribers(store, 'group_student_left', { employeeIds: ['e1'] }).map((e) => e.id),
    ['e1']
  );
});

test('the level decides what the card offers, not what gets delivered', () => {
  const instructor = { alerts: [], access_level: 'staff' };
  const visible = visibleAlertKeys(instructor);
  assert.ok(visible.includes('shift_reminder'));
  // A מדריך has no use for these two, so their sections are not shown.
  assert.ok(!visible.includes('handoff'));
  assert.ok(!visible.includes('placement'));

  const office = visibleAlertKeys({ alerts: [], access_level: 'office' });
  assert.ok(office.includes('handoff'));
  assert.ok(!office.includes('placement'));

  assert.equal(visibleAlertKeys({ alerts: [], access_level: 'manager' }).length, STAFF_ALERT_KINDS.length);
});

test('a subscription made before the level existed stays visible and stays live', () => {
  // Nobody was a manager until this screen existed; muting them by default
  // would have silently ended the alerts the team runs on today.
  const legacy = { name: 'מעוז', phone: '0501111111', alerts: ['handoff'] };
  assert.ok(visibleAlertKeys(legacy).includes('handoff'));
  assert.deepEqual(alertRecipients(fakeStore([legacy]), 'handoff', {}).phones, ['0501111111']);
});

test('an employee with no level yet is read from the alerts they already get', () => {
  assert.equal(employeeAccessLevel({ alerts: ['placement'] }), 'manager');
  assert.equal(employeeAccessLevel({ alerts: ['handoff'] }), 'office');
  assert.equal(employeeAccessLevel({ alerts: ['shift_reminder'] }), 'staff');
  assert.equal(employeeAccessLevel({}), 'staff');
  // A level that was set wins over the guess, in both directions.
  assert.equal(employeeAccessLevel({ access_level: 'staff', alerts: ['placement'] }), 'staff');
  assert.equal(employeeAccessLevel({ access_level: 'manager', alerts: [] }), 'manager');
});

test('per-alert settings fall back to their default', () => {
  assert.equal(reminderLeadHours({}), 24);
  assert.equal(reminderLeadHours({ alert_settings: { shift_reminder: { lead_hours: 2 } } }), 2);
  // A cleared field is not a lead time of zero.
  assert.equal(reminderLeadHours({ alert_settings: { shift_reminder: { lead_hours: '' } } }), 24);
  assert.deepEqual(
    alertSettings({ alert_settings: { shift_reminder: { template_id: 'tpl-1' } } }, 'shift_reminder'),
    { lead_hours: 24, template_id: 'tpl-1' }
  );
});

test('every alert sits in a section that exists', () => {
  const known = new Set(STAFF_ALERT_CATEGORIES.map((c) => c.key));
  for (const alert of STAFF_ALERT_KINDS) {
    assert.ok(known.has(alert.category), `${alert.key} has no section`);
    assert.ok(['own', 'all'].includes(alert.scope));
  }
});

test('the screen offers exactly the alerts the server can send', () => {
  // Two files, one catalog: a key added on one side and forgotten on the other
  // is a checkbox that does nothing, or an alert nobody can switch on.
  assert.deepEqual(
    CLIENT_ALERT_KINDS.map((a) => [a.key, a.category, a.label]),
    STAFF_ALERT_KINDS.map((a) => [a.key, a.category, a.label])
  );
  assert.deepEqual(
    CLIENT_CATEGORIES.map((c) => [c.key, c.audience]),
    STAFF_ALERT_CATEGORIES.map((c) => [c.key, c.audience])
  );
});
