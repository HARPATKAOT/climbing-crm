import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canConductSafetyTest,
  canOpenWall,
  canOperateCash,
  canSignSafetyChecks,
  employeesFor,
  isActiveWallEmployee,
} from './operationalEmployees.js';

const qualified = {
  id: 'qualified',
  is_active: true,
  is_wall_staff: true,
  can_open_wall: true,
  can_sign_daily_safety: true,
  can_operate_cash: true,
  can_test_safety: true,
};

test('operational permissions require an active wall employee and an explicit flag', () => {
  assert.equal(isActiveWallEmployee(qualified), true);
  assert.equal(canOpenWall(qualified), true);
  assert.equal(canSignSafetyChecks(qualified), true);
  assert.equal(canOperateCash(qualified), true);
  assert.equal(canConductSafetyTest(qualified), true);

  assert.equal(canOpenWall({ ...qualified, is_active: false }), false);
  assert.equal(canOperateCash({ ...qualified, active: false }), false);
  assert.equal(canSignSafetyChecks({ ...qualified, is_wall_staff: false }), false);
  assert.equal(canConductSafetyTest({ ...qualified, can_test_safety: undefined }), false);
});

test('employeesFor returns only employees qualified for the requested action', () => {
  const plain = { ...qualified, id: 'plain', can_operate_cash: false };
  const external = { ...qualified, id: 'external', is_wall_staff: false };
  assert.deepEqual(
    employeesFor([plain, qualified, external], canOperateCash).map((employee) => employee.id),
    ['qualified']
  );
});
