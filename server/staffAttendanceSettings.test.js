import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeCanOpenWall,
  employeeCanSignDailySafety,
  employeeIsWallStaff,
} from './staffAttendanceSettings.js';

test('legacy active employees remain wall staff unless explicitly external', () => {
  const employee = { is_active: true, can_open_wall: true, can_sign_daily_safety: true };
  assert.equal(employeeIsWallStaff(employee), true);
  assert.equal(employeeCanOpenWall(employee), true);
  assert.equal(employeeCanSignDailySafety(employee), true);
});

test('external employees cannot perform wall operations even with stale permissions', () => {
  const employee = {
    is_active: true,
    is_wall_staff: false,
    can_open_wall: true,
    can_sign_daily_safety: true,
  };
  assert.equal(employeeIsWallStaff(employee), false);
  assert.equal(employeeCanOpenWall(employee), false);
  assert.equal(employeeCanSignDailySafety(employee), false);
});

test('legacy rappel-only instructors are treated as external until explicitly classified', () => {
  const employee = {
    is_active: true,
    certifications: ['הדרכת סנפלינג'],
    can_open_wall: true,
  };
  assert.equal(employeeIsWallStaff(employee), false);
  assert.equal(employeeCanOpenWall(employee), false);
  assert.equal(employeeIsWallStaff({ ...employee, is_wall_staff: true }), true);
});
