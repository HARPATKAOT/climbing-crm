import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeCanOperateWall,
  openWallShifts,
  pendingWallSafetyChecks,
  requireQualifiedWallCloser,
  requireWallSafetyComplete,
  wallOpeningSafetyChecks,
  wallStationEmployee,
} from './wallOperations.js';

test('regular employee attendance is never mistaken for an open wall shift', () => {
  const rows = [
    { id: 'regular', status: 'open', activity_type: 'training' },
    { id: 'wall', status: 'open', activity_type: 'counter_shift' },
    { id: 'closed-wall', status: 'closed', activity_type: 'counter_shift' },
  ];
  assert.deepEqual(openWallShifts(rows).map((shift) => shift.id), ['wall']);
});

test('wall station employee contract carries every operational certification', () => {
  const view = wallStationEmployee({
    id: 'e-1', name: 'דנה', can_open_wall: true,
    can_sign_daily_safety: true, can_operate_cash: true,
  });
  assert.equal(view.can_open_wall, true);
  assert.equal(view.can_sign_daily_safety, true);
  assert.equal(view.can_operate_cash, true);
  assert.deepEqual(Object.keys(view).sort(), [
    'can_open_wall', 'can_operate_cash', 'can_sign_daily_safety', 'certifications',
    'id', 'is_active', 'is_wall_staff', 'name', 'role',
  ]);
});

test('only the ropes and autobelays check can block wall opening', () => {
  const rows = [
    { id: 'another-due-check', name: 'בדיקה אחרת', is_due: true, signed_today: false },
    { id: 'sct-ropes-autobelay', name: 'בדיקת חבלים וטרובלואים', is_due: true, signed_today: false },
  ];
  assert.deepEqual(wallOpeningSafetyChecks(rows).map((row) => row.id), ['sct-ropes-autobelay']);
  assert.deepEqual(pendingWallSafetyChecks(rows).map((row) => row.id), ['sct-ropes-autobelay']);
  assert.throws(() => requireWallSafetyComplete(rows), (error) => (
    error.code === 'SAFETY_PENDING' && error.status === 409 && error.pending.length === 1
  ));
  assert.deepEqual(requireWallSafetyComplete([
    { id: 'another-due-check', is_due: true, signed_today: false },
    { name: 'בדיקת חבלים וטרובלואים', is_due: true, signed_today: true },
  ]), []);
});

test('only an active certified employee may be recorded as the wall closer', () => {
  const employees = [
    { id: 'allowed', name: 'נועם', is_active: true, can_open_wall: true },
    { id: 'blocked', name: 'רון', is_active: true, can_open_wall: false },
    { id: 'external', name: 'חוץ', is_active: true, is_wall_staff: false, can_open_wall: true },
    { id: 'archived-legacy', name: 'ארכיון', is_active: true, active: false, can_open_wall: true },
  ];
  assert.equal(requireQualifiedWallCloser(employees, 'allowed').name, 'נועם');
  assert.throws(() => requireQualifiedWallCloser(employees, 'blocked'), /אינו מורשה/);
  assert.equal(employeeCanOperateWall(employees[2]), false);
  assert.throws(() => requireQualifiedWallCloser(employees, 'external'), /אינו מורשה/);
  assert.throws(() => requireQualifiedWallCloser(employees, 'archived-legacy'), /אינו מורשה/);
  assert.throws(() => requireQualifiedWallCloser(employees, ''), /יש לבחור/);
});
