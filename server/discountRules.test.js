import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingDiscountRules, normalizeDiscountRule, offerForDiscountRule } from './discountRules.js';

function fakeDb(tables) {
  return {
    get: (table) => tables[table] || [],
    getOne: (table, id) => (tables[table] || []).find((row) => String(row.id) === String(id)) || null,
  };
}

test('employee role rule follows the linked trainee and certification', () => {
  const db = fakeDb({
    students: [{ id: 's1' }, { id: 's2' }],
    employees: [{ id: 'e1', customer_student_id: 's1', certifications: ['מדריך נוער'], is_active: true }],
    discount_rules: [{ id: 'r1', active: true, audience: 'employee_role', role: 'מדריך נוער' }],
  });
  assert.deepEqual(matchingDiscountRules(db, 's1').map((r) => r.id), ['r1']);
  assert.deepEqual(matchingDiscountRules(db, 's2'), []);
});

test('class rule can cover every active enrollment or one group', () => {
  const db = fakeDb({
    students: [{ id: 's1', status: 'registered' }],
    enrollments: [{ id: 'en1', student_id: 's1', group_id: 'g1', status: 'active' }],
    discount_rules: [
      { id: 'all', active: true, audience: 'active_class', group_id: '' },
      { id: 'g1', active: true, audience: 'active_class', group_id: 'g1' },
      { id: 'g2', active: true, audience: 'active_class', group_id: 'g2' },
    ],
  });
  assert.deepEqual(matchingDiscountRules(db, 's1').map((r) => r.id), ['all', 'g1']);
});

test('a class rule skips a student who is only placed, not registered', () => {
  const rules = [{ id: 'all', active: true, audience: 'active_class', group_id: '' }];
  const enrollments = [{ id: 'en1', student_id: 's1', group_id: 'g1', status: 'active' }];
  for (const status of ['pending_signup', 'awaiting_parent_confirmation', 'awaiting_centre_confirmation', 'lead_new']) {
    const db = fakeDb({ students: [{ id: 's1', status }], enrollments, discount_rules: rules });
    assert.deepEqual(matchingDiscountRules(db, 's1'), [], `status ${status} must not earn the class discount`);
  }
  const registered = fakeDb({ students: [{ id: 's1', status: 'registered' }], enrollments, discount_rules: rules });
  assert.deepEqual(matchingDiscountRules(registered, 's1').map((r) => r.id), ['all']);
});

test('a rule becomes a multi-part reusable offer', () => {
  const rule = normalizeDiscountRule({
    name: 'מדריכי נוער', audience: 'employee_role', role: 'מדריך נוער',
    benefits: [
      { type: 'percent', value: 50, target: 'categories', categoryNames: ['כניסה'] },
      { type: 'percent', value: 30, target: 'products', pricelistIds: ['shoes'] },
    ],
  });
  const offer = offerForDiscountRule(rule);
  assert.equal(offer.type, 'ruleset');
  assert.equal(offer.parts.length, 2);
  assert.equal(offer.parts[1].appliesTo, 'items');
});
