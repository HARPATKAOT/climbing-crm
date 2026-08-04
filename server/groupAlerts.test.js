import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStaffIds, introHeadsUpCandidates } from './groupAlerts.js';

function fakeStore(tables = {}) {
  return { get: (name) => tables[name] || [] };
}

const MONDAY = '2026-08-10';

test('the group staff is the trainer and the assistants beside them', () => {
  assert.deepEqual(groupStaffIds({ trainer: 'e1', assistants: ['e2', 'e2', ''] }), ['e1', 'e2']);
  assert.deepEqual(groupStaffIds({}), []);
});

test('a trainee coming to an intro reaches that group\'s trainer only', () => {
  const store = fakeStore({
    employees: [
      { id: 'e1', name: 'מעוז', phone: '050', alerts: ['group_intro_upcoming'] },
      { id: 'e9', name: 'מדריך אחר', phone: '051', alerts: ['group_intro_upcoming'] },
    ],
    groups: [
      { id: 'g1', name: 'מתחילים', day: 1, time: '16:00', trainer: 'e1' },
      { id: 'g2', name: 'קבוצה אחרת', day: 1, time: '17:00', trainer: 'e9' },
    ],
    students: [
      { id: 's1', name: 'נועם', status: 'intro_scheduled', groupIds: ['g1'] },
      { id: 's2', name: 'רשום כבר', status: 'registered', groupIds: ['g1'] },
    ],
  });

  const due = introHeadsUpCandidates({ date: MONDAY, store });
  assert.deepEqual(due.map((d) => [d.employee.id, d.student.name]), [['e1', 'נועם']]);
});

test('a group that does not meet that day, or a trainer who did not subscribe', () => {
  const base = {
    employees: [{ id: 'e1', name: 'מעוז', phone: '050', alerts: ['group_intro_upcoming'] }],
    students: [{ id: 's1', name: 'נועם', status: 'intro_paid', groupIds: ['g1'] }],
  };
  // Meets on Tuesday, the heads-up is for Monday.
  assert.equal(
    introHeadsUpCandidates({
      date: MONDAY,
      store: fakeStore({ ...base, groups: [{ id: 'g1', day: 2, trainer: 'e1' }] }),
    }).length,
    0
  );
  assert.equal(
    introHeadsUpCandidates({
      date: MONDAY,
      store: fakeStore({
        ...base,
        employees: [{ id: 'e1', name: 'מעוז', phone: '050', alerts: [] }],
        groups: [{ id: 'g1', day: 1, trainer: 'e1' }],
      }),
    }).length,
    0
  );
});
