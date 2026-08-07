import test from 'node:test';
import assert from 'node:assert/strict';
import { documentRowKind } from './declarationKinds.js';

test('every line in the approvals folder gets its own name, icon and colour', () => {
  const rows = [
    documentRowKind({ category: 'participation', scope: 'wall' }),
    documentRowKind({ category: 'participation', scope: 'trip' }),
    documentRowKind({ category: 'health' }),
    documentRowKind({ category: 'health', clearance: true }),
  ];

  assert.deepEqual(rows.map((k) => k.title), [
    'אישור השתתפות — קיר טיפוס',
    'אישור השתתפות — טיול',
    'הצהרת בריאות',
    'אישור רופא',
  ]);
  for (const key of ['badge', 'color', 'Icon']) {
    assert.equal(new Set(rows.map((k) => k[key])).size, 4, `${key} repeats between kinds`);
  }
});

test('legacy participation slugs still read as the wall approval', () => {
  assert.equal(documentRowKind({ category: 'participation', scope: 'birthday' }).key, 'wall');
  assert.equal(documentRowKind({ category: 'participation', scope: '' }).key, 'wall');
});

test('a doctor note is never mistaken for the declaration it hangs off', () => {
  const clearance = documentRowKind({ category: 'health', clearance: true });
  assert.notEqual(clearance.key, documentRowKind({ category: 'health' }).key);
});
