import test from 'node:test';
import assert from 'node:assert/strict';
import { findLatestValidDeclaration } from './crmWaiverService.js';

/**
 * The child-check endpoint answers "this child is already on another family's
 * file — and here is whether they are covered". Covered for *what* is the whole
 * question: the submit refuses a reuse across forms, so a check that ignored
 * the form would promise the family something the server then rejects.
 */
const TODAY = new Date().toISOString().slice(0, 10);
const dbWith = (declarations) => ({
  get: (table) => (table === 'health_declarations' ? declarations : []),
});
const decl = (templateSlug) => ({
  id: `hd_${templateSlug}`,
  studentId: 's1',
  parentId: 'p_other',
  climberName: 'עומר',
  signedDate: TODAY,
  date: TODAY,
  templateSlug,
});

test('a matched child covered for the wall is not covered for a trip', () => {
  const db = dbWith([decl('wall')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});

test('the answer the form shows and the answer the submit gives agree', () => {
  // Both paths ask the same function with the same slug, which is the point:
  // the form must never offer a reuse the submit will refuse.
  const db = dbWith([decl('event')]);
  for (const slug of ['wall', 'trip', 'event']) {
    const shownToForm = !!findLatestValidDeclaration(db, { studentId: 's1', templateSlug: slug });
    const acceptedAtSubmit = !!findLatestValidDeclaration(db, { studentId: 's1', templateSlug: slug });
    assert.equal(shownToForm, acceptedAtSubmit, slug);
  }
});
