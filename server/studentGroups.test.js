import test from 'node:test';
import assert from 'node:assert/strict';
import {
  studentGroupIds,
  studentInGroup,
  enrichStudentWithGroupIds,
} from './studentGroups.js';
import {
  countEnrolled,
  spotsLeft,
  isGroupFull,
} from './groupCapacity.js';

test('studentGroupIds falls back to groupId', () => {
  assert.deepEqual(studentGroupIds({ groupId: 'g1' }), ['g1']);
  assert.deepEqual(studentGroupIds({ groupIds: ['g1', 'g2'], groupId: 'g1' }), ['g1', 'g2']);
});

test('studentInGroup supports multi membership', () => {
  const s = { groupIds: ['a', 'b'], groupId: 'a' };
  assert.equal(studentInGroup(s, 'b'), true);
  assert.equal(studentInGroup(s, 'c'), false);
});

test('enrichStudentWithGroupIds prefers enrollments', () => {
  const student = { id: 's1', groupId: 'old' };
  const enriched = enrichStudentWithGroupIds(student, [
    { student_id: 's1', group_id: 'g1', status: 'active' },
    { student_id: 's1', group_id: 'g2', status: 'active' },
  ]);
  assert.deepEqual(enriched.groupIds, ['g1', 'g2']);
});

test('capacity counts multi-group students once per group', () => {
  const group = { id: 'g1', maxSlots: 2 };
  const students = [
    { id: 's1', groupIds: ['g1', 'g2'], groupId: 'g1', status: 'registered' },
    { id: 's2', groupIds: ['g2'], groupId: 'g2', status: 'registered' },
  ];
  assert.equal(countEnrolled('g1', students), 1);
  assert.equal(spotsLeft(group, students), 1);
  assert.equal(isGroupFull(group, students), false);
});
