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

// מסנן «נמענים»: מספר שרשום גם על רשומת מתאמן שייך למתאמן, לא להורה.
test('a minor trainee\'s own phone is excluded by default and shown in removed', () => {
  const preview = previewAudience({}, {
    parents: [
      makeParent('p1', '0501234567'),
      // הליד שהמתאמן הצעיר פתח לעצמו כשכתב לבוט מהטלפון שלו.
      makeParent('p2', '0529999999', { name: 'יונתן ברזילי' }),
    ],
    students: [
      makeStudent('s1', 'p1'),
      makeStudent('s2', 'p2', { name: 'יונתן ברזילי', phone: '0529999999', birthDate: '2011-05-01' }),
    ],
    groups: GROUPS,
  });
  assert.equal(preview.count, 1);
  assert.equal(preview.recipients[0].phone, '972501234567');
  const removedTrainee = preview.removed.find((r) => r.phone === '972529999999');
  assert.equal(removedTrainee.excludedByAudienceType, true);
  assert.equal(removedTrainee.recipientKind, 'trainee_phone');
});

test('an adult trainee with their own phone stays in by default, out under parents-only', () => {
  const data = {
    parents: [makeParent('p1', '0508888888', { name: 'עידן בוגר' })],
    students: [makeStudent('s1', 'p1', { name: 'עידן בוגר', phone: '0508888888', birthDate: '1998-04-01' })],
    groups: GROUPS,
  };
  const byDefault = previewAudience({}, data);
  assert.equal(byDefault.count, 1);
  assert.equal(byDefault.recipients[0].recipientKind, 'adult_trainee');

  const parentsOnly = previewAudience({ audienceType: 'parents' }, data);
  assert.equal(parentsOnly.count, 0);
  assert.equal(parentsOnly.removed[0].excludedByAudienceType, true);
});

test('audienceType all includes minor trainee phones on purpose', () => {
  const preview = previewAudience({ audienceType: 'all' }, {
    parents: [makeParent('p2', '0529999999')],
    students: [makeStudent('s2', 'p2', { phone: '0529999999', birthDate: '2011-05-01' })],
    groups: GROUPS,
  });
  assert.equal(preview.count, 1);
  assert.equal(preview.recipients[0].recipientKind, 'trainee_phone');
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
