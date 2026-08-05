import test from 'node:test';
import assert from 'node:assert/strict';
import {
  healthExpiryDate,
  isHealthDeclarationValid,
  participationWaiverExpiryDate,
  isParticipationWaiverValid,
  scopedDeclarationSignedAt,
} from './healthValidity.js';

const day = (iso) => new Date(`${iso}T12:00:00+03:00`);

test('a health signature in August is valid through next 31 August', () => {
  const expiry = healthExpiryDate('2026-08-03');
  assert.equal(expiry.getFullYear(), 2027);
  assert.equal(expiry.getMonth(), 7);
  assert.equal(expiry.getDate(), 31);
  assert.equal(isHealthDeclarationValid('2026-08-03', day('2026-08-04')), true);
  assert.equal(isHealthDeclarationValid('2026-08-02', day('2026-08-04')), true);
});

test('a health signature in January through July ends on 31 August that year', () => {
  const expiry = healthExpiryDate('2026-06-01');
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(expiry.getMonth(), 7);
  assert.equal(expiry.getDate(), 31);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2026-08-04')), true);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2026-07-31')), true);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2026-09-01')), false);
});

test('a July signature does not spill into the following season', () => {
  const expiry = healthExpiryDate('2026-07-15');
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(isHealthDeclarationValid('2026-07-15', day('2026-08-04')), true);
});

test('participation waivers expire on 31 August two years after signing', () => {
  const expiry = participationWaiverExpiryDate('2026-08-03');
  assert.equal(expiry.getFullYear(), 2028);
  assert.equal(expiry.getMonth(), 7);
  assert.equal(expiry.getDate(), 31);
  assert.equal(isParticipationWaiverValid('2026-08-03', day('2028-08-31')), true);
  assert.equal(isParticipationWaiverValid('2026-08-03', day('2028-09-01')), false);
});

test('a wall date is not presented as an expired trip declaration', () => {
  assert.equal(scopedDeclarationSignedAt({
    declaration: null,
    studentHealthSignedAt: '2026-08-03',
    templateSlug: 'trip',
  }), null);
});

test('the legacy student date still belongs to the wall form', () => {
  assert.equal(scopedDeclarationSignedAt({
    declaration: null,
    studentHealthSignedAt: '2026-08-03',
    templateSlug: 'wall',
  }), '2026-08-03');
});

test('a matching trip declaration keeps its own signed date', () => {
  assert.equal(scopedDeclarationSignedAt({
    declaration: { templateSlug: 'trip', signedDate: '2026-08-04' },
    studentHealthSignedAt: '2026-08-03',
    templateSlug: 'trip',
  }), '2026-08-04');
});
