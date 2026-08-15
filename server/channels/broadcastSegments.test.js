import test from 'node:test';
import assert from 'node:assert/strict';
import { previewAudience } from './segments.js';

// יחידת הנמען היא מספר טלפון: הורה עם שני ילדים הוא נמען אחד; שני כרטיסי
// הורה עם אותו מספר (050… מול 972…) הם נמען אחד.

const GROUPS = [];

function makeParent(id, phone, overrides = {}) {
  return { id, name: `הורה ${id}`, phone, city: 'תל מונד', ...overrides };
}

function makeStudent(id, parentId, overrides = {}) {
  return {
    id,
    parentId,
    name: `ילד ${id}`,
    status: 'registered',
    birthDate: '2015-01-01',
    ...overrides,
  };
}

test('a parent with two matching children is one recipient, two child records', () => {
  const preview = previewAudience({}, {
    parents: [makeParent('p1', '0501234567')],
    students: [makeStudent('s1', 'p1'), makeStudent('s2', 'p1')],
    groups: GROUPS,
  });
  assert.equal(preview.count, 1);
  assert.equal(preview.childCount, 2);
  assert.equal(preview.recipients[0].students.length, 2);
  assert.equal(preview.recipients[0].phone, '972501234567');
});

test('duplicate parent cards with the same phone fold into one recipient', () => {
  const preview = previewAudience({}, {
    parents: [
      makeParent('p1', '0501234567'),
      makeParent('p2', '972501234567', { name: 'לקוח וואטסאפ' }),
    ],
    students: [makeStudent('s1', 'p1'), makeStudent('s2', 'p2')],
    groups: GROUPS,
  });
  assert.equal(preview.count, 1);
  assert.equal(preview.childCount, 2);
  assert.equal(preview.cardCount, 2);
  // The real card, not the placeholder, fronts the recipient.
  assert.equal(preview.recipients[0].name, 'הורה p1');
});

test('the archive case: a parent enters the audience through the archived child', () => {
  const preview = previewAudience({ statuses: ['archived'] }, {
    parents: [makeParent('p1', '0501234567')],
    students: [
      makeStudent('s1', 'p1', { status: 'registered', name: 'הילד הפעיל' }),
      makeStudent('s2', 'p1', { status: 'archived', name: 'הילד בארכיון' }),
    ],
    groups: GROUPS,
  });
  assert.equal(preview.count, 1);
  assert.equal(preview.childCount, 1);
  assert.equal(preview.recipients[0].students[0].name, 'הילד בארכיון');
});

test('an opted-out sibling card removes the phone into `removed`, visibly', () => {
  const preview = previewAudience({ marketingOptIn: true }, {
    parents: [
      makeParent('p1', '0501234567'),
      makeParent('p2', '972501234567', { marketing_opt_in: false }),
    ],
    students: [makeStudent('s1', 'p1')],
    groups: GROUPS,
  });
  assert.equal(preview.count, 0);
  assert.equal(preview.removed.length, 1);
  assert.equal(preview.removed[0].marketingOptOut, true);
});

test('a parent with a broken phone surfaces as invalid instead of vanishing', () => {
  const preview = previewAudience({}, {
    parents: [makeParent('p1', 'אין')],
    students: [makeStudent('s1', 'p1')],
    groups: GROUPS,
  });
  assert.equal(preview.count, 1);
  assert.equal(preview.recipients[0].invalidPhone, true);
});
