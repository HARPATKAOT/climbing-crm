import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessLevelTest, levelTestModule } from './levelTestAccess.js';

test('safety officer can read and edit security tests only', () => {
  const safetyOfficer = {
    role: 'staff',
    modules: { safety_tests: 'edit', level_tests: 'none', lead_tests: 'none' },
  };
  assert.equal(canAccessLevelTest(safetyOfficer, { test_type: 'security' }, 'view'), true);
  assert.equal(canAccessLevelTest(safetyOfficer, { test_type: 'security' }, 'edit'), true);
  assert.equal(canAccessLevelTest(safetyOfficer, { test_type: 'level' }, 'view'), false);
  assert.equal(canAccessLevelTest(safetyOfficer, { test_type: 'lead' }, 'edit'), false);
});

test('combining instructor and safety access expands test kinds', () => {
  const combined = {
    role: 'staff',
    modules: { safety_tests: 'edit', level_tests: 'edit', lead_tests: 'none' },
  };
  assert.equal(levelTestModule({ test_type: 'security' }), 'safety_tests');
  assert.equal(canAccessLevelTest(combined, { test_type: 'security' }, 'edit'), true);
  assert.equal(canAccessLevelTest(combined, { test_type: 'level' }, 'edit'), true);
  assert.equal(canAccessLevelTest(combined, { test_type: 'lead' }, 'view'), false);
});
