import test from 'node:test';
import assert from 'node:assert/strict';
import { planDurableHydration } from './db.js';

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

test('a failed durable read never erases the local cache', () => {
  const local = [{ id: 'employee-1' }];
  const result = planDurableHydration('employees', null, local);
  assert.equal(result.mode, 'error');
  assert.deepEqual(result.rows, local);
});
