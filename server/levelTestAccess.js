import { accessAtLeast } from './userAccess.js';

export function normalizeLevelTestType(test = {}) {
  const type = String(test.test_type || 'level');
  if (type === 'security') return 'security';
  if (type === 'lead') return 'lead';
  return 'level';
}

export function levelTestModule(test = {}) {
  const type = normalizeLevelTestType(test);
  if (type === 'security') return 'safety_tests';
  if (type === 'lead') return 'lead_tests';
  return 'level_tests';
}

export function canAccessLevelTest(context, test, level = 'view') {
  if (context?.role === 'owner') return true;
  return accessAtLeast(context, levelTestModule(test), level);
}
