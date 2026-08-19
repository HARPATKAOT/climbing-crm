import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFamilyMemberTabs, buildFamilyRows, householdStudentsForParent } from './leadHouseholds.js';

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

test('an adult payer and trainee appears as one combined family tab', () => {
  const tabs = buildFamilyMemberTabs(students, [dad, mum]);
  assert.equal(tabs.length, 4);
  assert.deepEqual(
    tabs.map((tab) => [tab.student?.id || null, tab.parent?.id || null, tab.kind]),
    [
      ['s3', 'p1', 'combined'],
      ['s4', 'p2', 'combined'],
      ['s1', null, 'student'],
      ['s2', null, 'student'],
    ]
  );
});

test('a parent who is not a trainee keeps a separate parent tab', () => {
  const child = { id: 's10', name: 'נועה כהן', parentId: 'p10', guardianIds: ['p10'] };
  const parent = { id: 'p10', name: 'רוני כהן', phone: '0501112233' };
  const tabs = buildFamilyMemberTabs([child], [parent]);
  assert.deepEqual(tabs.map((tab) => tab.kind), ['student', 'parent']);
});

test('an adult with a different identity is not collapsed into their parent', () => {
  const adult = { id: 's11', name: 'נועה כהן', parentId: 'p11', guardianIds: ['p11'], isAdult: true };
  const parent = { id: 'p11', name: 'רוני כהן', phone: '0501112233' };
  const tabs = buildFamilyMemberTabs([adult], [parent]);
  assert.deepEqual(tabs.map((tab) => tab.kind), ['student', 'parent']);
});

test('a merged-away archived duplicate is hidden from the family tabs', () => {
  // המבנה שאיחוד כפילות משאיר: כרטיס חי וכרטיס ארכיון עם אותו שם ואותו
  // תאריך לידה על אותו תיק. המסמכים החתומים מצביעים על הארכיון, אז הוא
  // לא נמחק — אבל בסרגל בני הבית הוא היה מציג את אותה ילדה פעמיים.
  const parent = { id: 'p20', name: 'תמר לוי', phone: '972541112233' };
  const live = { id: 's20', name: 'נעמי לוי', parentId: 'p20', guardianIds: ['p20'], birthDate: '2008-08-04', isAdult: true, status: 'registered' };
  const merged = { id: 's21', name: 'נעמי לוי', parentId: 'p20', guardianIds: ['p20'], birthDate: '2008-08-04', isAdult: true, status: 'archived' };
  const tabs = buildFamilyMemberTabs([live, merged], [parent]);
  assert.deepEqual(
    tabs.map((tab) => [tab.student?.id || null, tab.kind]),
    [['s20', 'student'], [null, 'parent']]
  );

  // מתאמן שבאמת עזב — שם בלי כרטיס חי מקביל — נשאר מוצג בתיק.
  const past = { id: 's22', name: 'יונתן לוי', parentId: 'p20', guardianIds: ['p20'], status: 'archived' };
  const withPast = buildFamilyMemberTabs([live, past], [parent]);
  assert.equal(withPast.filter((tab) => tab.kind === 'student').length, 2);
});

test('the main parent in the leads row is the trainee primary, not the richer secondary card', () => {
  const primary = { id: 'p10', name: 'הורה ראשי' };
  const richerSecondary = {
    id: 'p11',
    name: 'הורה נוסף',
    phone: '972501112233',
    email: 'full@example.com',
    city: 'חיפה',
  };
  const child = {
    id: 's10',
    name: 'ילד',
    parentId: 'p10',
    guardianIds: ['p10', 'p11'],
    status: 'active',
  };

  const [row] = buildFamilyRows([child], [primary, richerSecondary]);
  assert.equal(row.parent.id, 'p10');
  assert.equal(row.parents[0].id, 'p10');
});
