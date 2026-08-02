import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFamilyRows, householdStudentsForParent } from './leadHouseholds.js';

const dad = { id: 'p1', name: 'דלק איל', phone: '972508862878', email: 'a@b.c' };
const mum = { id: 'p2', name: 'סמדר איל', phone: '972544710597' };

// Both parents are guardians of both children, and each is also an adult
// trainee on their own card — the shape a family merge leaves behind.
const students = [
  { id: 's1', name: 'ראם איל', parentId: 'p1', guardianIds: ['p1', 'p2'], status: 'active' },
  { id: 's2', name: 'שקד איל', parentId: 'p1', guardianIds: ['p1', 'p2'], status: 'active' },
  { id: 's3', name: 'דלק איל', parentId: 'p1', isAdult: true, guardianIds: ['p1'], status: 'active' },
  { id: 's4', name: 'סמדר איל', parentId: 'p2', isAdult: true, guardianIds: ['p2', 'p1'], status: 'active' },
];

test('two parents of one family make a single row', () => {
  const rows = buildFamilyRows(students, [dad, mum]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parent.id, 'p1');
  assert.deepEqual(rows[0].parents.map((p) => p.id).sort(), ['p1', 'p2']);
  assert.deepEqual(rows[0].students.map((s) => s.id).sort(), ['s1', 's2', 's3', 's4']);
});

test('a filtered-out child does not split the household', () => {
  const shown = students.filter((s) => s.id === 's1');
  const rows = buildFamilyRows(shown, [dad, mum], students);
  assert.equal(rows.length, 1);
  // The filter decides which households appear; the row still lists every
  // trainee on that household — the desk opens a customer file, not a slice.
  assert.deepEqual(rows[0].students.map((s) => s.id).sort(), ['s1', 's2', 's3', 's4']);
  // The other parent is still reachable from the row even with no student of
  // their own matching the filter.
  assert.deepEqual(rows[0].parents.map((p) => p.id).sort(), ['p1', 'p2']);
});

test('unrelated families stay apart', () => {
  const other = { id: 'p3', name: 'רון כהן', phone: '972501112222' };
  const rows = buildFamilyRows(
    [...students, { id: 's5', name: 'יובל כהן', parentId: 'p3', guardianIds: ['p3'], status: 'lead_new' }],
    [dad, mum, other]
  );
  assert.equal(rows.length, 2);
});

test('duplicate parent cards on one phone still merge', () => {
  const twin = { id: 'p9', name: 'לקוח וואטסאפ', phone: '0508862878' };
  const rows = buildFamilyRows(
    [...students, { id: 's6', name: '', parentId: 'p9', status: 'lead_new' }],
    [dad, mum, twin]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parent.id, 'p1');
});

test('opening either parent lists every trainee on the household', () => {
  assert.deepEqual(
    householdStudentsForParent('p1', students, [dad, mum]).map((s) => s.id).sort(),
    ['s1', 's2', 's3', 's4']
  );
  assert.deepEqual(
    householdStudentsForParent('p2', students, [dad, mum]).map((s) => s.id).sort(),
    ['s1', 's2', 's3', 's4']
  );
});
