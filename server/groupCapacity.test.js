import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countEnrolled,
  spotsLeft,
  isGroupFull,
  enrichGroupsWithCapacity,
  wantsWaitlist,
  pickGroupForWaitlist,
  extractPreferredDayIndex,
  extractTimeHint,
} from './groupCapacity.js';

const group = { id: 'g1', maxSlots: 2, day: 0, time: '15:30', name: "ג'-ד'" };
const students = [
  { id: 's1', groupId: 'g1', status: 'registered' },
  { id: 's2', groupId: 'g1', status: 'waitlist' },
  { id: 's3', groupId: 'g1', status: 'archived' },
  { id: 's4', groupId: 'g1', status: 'active' },
];

test('waitlist and archived do not take a seat', () => {
  assert.equal(countEnrolled('g1', students), 2);
  assert.equal(spotsLeft(group, students), 0);
  assert.equal(isGroupFull(group, students), true);
});

test('a signed declaration records the choice but does not reserve capacity', () => {
  const pending = [
    { id: 'p1', groupId: 'g1', status: 'health_signed' },
  ];
  assert.equal(countEnrolled('g1', pending), 0);
  assert.equal(spotsLeft(group, pending), 2);
});

test('multi-group student counts in each group', () => {
  const multi = [
    { id: 'm1', groupIds: ['g1', 'gx'], groupId: 'g1', status: 'registered' },
  ];
  assert.equal(countEnrolled('g1', multi), 1);
  assert.equal(countEnrolled('gx', multi), 1);
});

test('enrichGroupsWithCapacity adds freeSlots', () => {
  const [row] = enrichGroupsWithCapacity([group], students);
  assert.equal(row.enrolled, 2);
  assert.equal(row.freeSlots, 0);
  assert.equal(row.isFull, true);
});

test('wantsWaitlist detects Hebrew phrases', () => {
  assert.equal(wantsWaitlist('אפשר רשימת המתנה?'), true);
  assert.equal(wantsWaitlist('תכניסו אותי להמתנה'), true);
  assert.equal(wantsWaitlist('מה השעות?'), false);
});

test('extract day and time hints', () => {
  assert.equal(extractPreferredDayIndex('יום א׳ בבקשה'), 0);
  assert.equal(extractTimeHint('בשעה 15:30'), '15:30');
});

test('pickGroupForWaitlist prefers matching day', () => {
  const groups = [
    { id: 'a', maxSlots: 1, day: 0, time: '15:30' },
    { id: 'b', maxSlots: 1, day: 2, time: '16:00' },
  ];
  const picked = pickGroupForWaitlist(groups, [], { dayIndex: 2, preferFull: false });
  assert.equal(picked.id, 'b');
});

test('pickGroupForWaitlist matches either day of a twice-weekly group', () => {
  const groups = [
    { id: 'squad', name: 'נבחרת צעירה — ב׳+ה׳ 17:00', maxSlots: 10, day: 4, time: '17:00' },
    { id: 'other', name: 'חטיבה — יום ה׳ 18:40', maxSlots: 10, day: 4, time: '18:40' },
  ];
  const picked = pickGroupForWaitlist(groups, [], { dayIndex: 1, preferFull: false });
  assert.equal(picked.id, 'squad');
});
