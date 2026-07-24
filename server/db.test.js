import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planDurableHydration,
  normalizeParentPhone,
  parentPhonesMatch,
} from './db.js';

test('normalizeParentPhone maps 050… to 972…', () => {
  assert.equal(normalizeParentPhone('0508862878'), '972508862878');
  assert.equal(normalizeParentPhone('972508862878'), '972508862878');
  assert.equal(normalizeParentPhone('+972-50-886-2878'), '972508862878');
});

test('parentPhonesMatch treats 050 and 972 as the same person', () => {
  assert.equal(parentPhonesMatch('0508862878', '972508862878'), true);
  assert.equal(parentPhonesMatch('0508862878', '0501234567'), false);
});

test('local operational records migrate when the durable store is empty', () => {
  const local = [{ id: 'log-1', message: 'hello' }];
  const result = planDurableHydration('whatsapp_logs', [], local);
  assert.equal(result.mode, 'migrate');
  assert.deepEqual(result.rows, local);
});

test('remote operational record wins when the same id exists locally', () => {
  const remote = [{ id: 'pay-1', amount: 100 }];
  const local = [{ id: 'pay-1', amount: 50 }];
  const result = planDurableHydration('payments', remote, local);
  assert.equal(result.mode, 'remote');
  assert.deepEqual(result.rows, remote);
});

test('offline operational records are merged and scheduled for migration', () => {
  const remote = [{ id: 'pay-1', amount: 100 }];
  const offline = { id: 'pay-2', amount: 50 };
  const result = planDurableHydration('payments', remote, [offline]);
  assert.equal(result.mode, 'migrate');
  assert.deepEqual(result.rows, [...remote, offline]);
  assert.deepEqual(result.toMigrate, [offline]);
});

test('core collections always use the remote snapshot, including an empty one', () => {
  const result = planDurableHydration('students', [], [{ id: 'stale-student' }]);
  assert.equal(result.mode, 'remote');
  assert.deepEqual(result.rows, []);
});

test('message templates migrate when the durable store is empty', () => {
  const local = [{ id: 'tpl_1', status: 'APPROVED' }];
  const result = planDurableHydration('message_templates', [], local);
  assert.equal(result.mode, 'migrate');
  assert.deepEqual(result.rows, local);
  assert.deepEqual(result.toMigrate, local);
});

test('message templates prefer the remote snapshot when it has rows', () => {
  const remote = [{ id: 'tpl_remote', status: 'APPROVED' }];
  const local = [{ id: 'tpl_local', status: 'DRAFT' }];
  const result = planDurableHydration('message_templates', remote, local);
  assert.equal(result.mode, 'remote');
  assert.deepEqual(result.rows, remote);
});

test('a failed durable read never erases the local cache', () => {
  const local = [{ id: 'employee-1' }];
  const result = planDurableHydration('employees', null, local);
  assert.equal(result.mode, 'error');
  assert.deepEqual(result.rows, local);
});
