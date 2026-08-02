import test from 'node:test';
import assert from 'node:assert/strict';
import { findLatestValidDeclaration } from './crmWaiverService.js';

/** Signed today, so it is in force whenever the suite runs. */
const TODAY = new Date().toISOString().slice(0, 10);

const dbWith = (declarations) => ({
  get: (table) => (table === 'health_declarations' ? declarations : []),
});

const decl = (templateSlug, extra = {}) => ({
  id: `hd_${templateSlug}`,
  studentId: 's1',
  parentId: 'p1',
  climberName: 'עומר',
  signedDate: TODAY,
  date: TODAY,
  templateSlug,
  ...extra,
});

test('asked about a form, only that form counts', () => {
  const db = dbWith([decl('wall')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'event' }), null);
});

test('asked without a form, anything on file counts', () => {
  // The bot and the staff screens want to know whether anything was ever
  // signed; narrowing that would report a family as having nothing.
  const db = dbWith([decl('trip')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1' }));
});

test('a signature given under the old name still covers the form it became', () => {
  // The wall-activity declaration was called `birthday` until it turned out to
  // cover company days and school groups too. Same document, same risks.
  const db = dbWith([decl('birthday')]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'event' }));
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'birthday' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});

test('a declaration with no slug is read as the wall form', () => {
  // Everything signed before there was more than one form.
  const db = dbWith([decl(undefined)]);
  assert.ok(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' }));
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});

test('holding one form does not hide the other being missing', () => {
  const db = dbWith([decl('wall'), decl('trip', { id: 'hd_trip2' })]);
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'wall' })?.id, 'hd_wall');
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' })?.id, 'hd_trip2');
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'event' }), null);
});

test('an expired declaration of the right kind is still no cover', () => {
  const db = dbWith([decl('trip', { signedDate: '2019-01-01', date: '2019-01-01' })]);
  assert.equal(findLatestValidDeclaration(db, { studentId: 's1', templateSlug: 'trip' }), null);
});
