import test from 'node:test';
import assert from 'node:assert/strict';
import { staffForRole } from './staffRoles.js';

test('archived employees are never returned as assignment options', () => {
  const employees = [
    { id: 'active', certifications: ['מדריך חוג'], is_active: true },
    { id: 'archived', certifications: ['מדריך חוג'], is_active: false },
    { id: 'legacy-archived', certifications: ['מדריך חוג'], is_active: true, active: false },
  ];

  assert.deepEqual(
    staffForRole(employees, 'מדריך חוג', ['archived', 'legacy-archived']).map((employee) => employee.id),
    ['active'],
  );
});
