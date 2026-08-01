import assert from 'node:assert/strict';
import test from 'node:test';

import { declarationMatchesStudent, studentDeclarationStatus } from './declarationStatus.js';

const NOW = new Date('2026-08-01T00:00:00Z');

test('a declaration carrying the student id belongs to them', () => {
  assert.equal(
    declarationMatchesStudent({ studentId: 'st1', climberName: 'שם אחר' }, { id: 'st1', name: 'ראם איל' }),
    true,
  );
});

test('the household phone alone does not hand a sibling the declaration', () => {
  const decl = { phone: '050-1234567', climberName: 'שקד איל' };
  assert.equal(declarationMatchesStudent(decl, { id: 'st2', name: 'ראם איל' }, '0501234567'), false);
  assert.equal(declarationMatchesStudent(decl, { id: 'st3', name: 'שקד איל' }, '0501234567'), true);
});

test('a parent who signed for themselves is marked, not just the children', () => {
  const decls = [{ studentId: 'st-adult', templateSlug: 'wall', signed: true, signedDate: '2026-07-20' }];
  const status = studentDeclarationStatus(decls, { id: 'st-adult', name: 'סמדר איל' }, '0501234567', NOW);
  assert.equal(status.wall.signed, true);
  assert.equal(status.wall.expired, false);
  assert.equal(status.trip, undefined);
});

test('wall and trip are tracked apart', () => {
  const decls = [
    { studentId: 'st1', templateSlug: 'wall', signed: true, signedDate: '2026-07-20' },
    { studentId: 'st1', templateSlug: 'trip', signed: true, signedDate: '2026-07-25' },
  ];
  const status = studentDeclarationStatus(decls, { id: 'st1', name: 'ראם איל' }, null, NOW);
  assert.equal(status.wall.signed, true);
  assert.equal(status.trip.signed, true);
});

test('an unsigned declaration does not count', () => {
  const decls = [{ studentId: 'st1', templateSlug: 'trip', signed: false, status: 'pending' }];
  const status = studentDeclarationStatus(decls, { id: 'st1', name: 'ראם איל' }, null, NOW);
  assert.equal(status.trip, undefined);
});

test('an old signature is signed but expired', () => {
  const decls = [{ studentId: 'st1', templateSlug: 'wall', signed: true, signedDate: '2023-01-10' }];
  const status = studentDeclarationStatus(decls, { id: 'st1', name: 'ראם איל' }, null, NOW);
  assert.equal(status.wall.signed, true);
  assert.equal(status.wall.expired, true);
});

test('a newer signature is not masked by the expired one it replaced', () => {
  const decls = [
    { studentId: 'st1', templateSlug: 'wall', signed: true, signedDate: '2023-01-10' },
    { studentId: 'st1', templateSlug: 'wall', signed: true, signedDate: '2026-07-20' },
  ];
  const status = studentDeclarationStatus(decls, { id: 'st1', name: 'ראם איל' }, null, NOW);
  assert.equal(status.wall.expired, false);
});

test('a student marked signed with no declaration in the feed still shows the wall', () => {
  const status = studentDeclarationStatus([], { id: 'st1', name: 'דלק איל', healthSignedAt: '2026-07-20' }, null, NOW);
  assert.equal(status.wall.signed, true);
});

test('an unrecognised slug reads as the wall form', () => {
  const decls = [{ studentId: 'st1', templateSlug: '', signed: true, signedDate: '2026-07-20' }];
  const status = studentDeclarationStatus(decls, { id: 'st1', name: 'ראם איל' }, null, NOW);
  assert.equal(status.wall.signed, true);
});
