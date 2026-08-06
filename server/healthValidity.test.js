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

test('a signature earlier in the year runs to 31 August of the next one', () => {
  const expiry = healthExpiryDate('2026-06-01');
  assert.equal(expiry.getFullYear(), 2027);
  assert.equal(expiry.getMonth(), 7);
  assert.equal(expiry.getDate(), 31);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2026-09-01')), true);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2027-08-31')), true);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2027-09-01')), false);
});

// The month must not matter any more: a July signature used to be asked for
// again weeks later, at the end of that same August.
test('the month signed in does not change the expiry year', () => {
  ['2026-01-01', '2026-07-15', '2026-07-31', '2026-08-01', '2026-12-31'].forEach((signedAt) => {
    assert.equal(healthExpiryDate(signedAt).getFullYear(), 2027, signedAt);
  });
  assert.equal(isHealthDeclarationValid('2026-07-15', day('2026-09-01')), true);
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
