import test from 'node:test';
import assert from 'node:assert/strict';
import { healthExpiryDate, isHealthDeclarationValid } from './healthValidity.js';

const day = (iso) => new Date(`${iso}T12:00:00+03:00`);

test('a signature after 31 July of an even year starts the next cycle', () => {
  const expiry = healthExpiryDate('2026-08-03');
  assert.equal(expiry.getFullYear(), 2028);
  assert.equal(expiry.getMonth(), 6);
  assert.equal(expiry.getDate(), 31);
  assert.equal(isHealthDeclarationValid('2026-08-03', day('2026-08-04')), true);
  assert.equal(isHealthDeclarationValid('2026-08-02', day('2026-08-04')), true);
});

test('a signature before the July cutoff of an even year ends that July', () => {
  const expiry = healthExpiryDate('2026-06-01');
  assert.equal(expiry.getFullYear(), 2026);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2026-08-04')), false);
  assert.equal(isHealthDeclarationValid('2026-06-01', day('2026-07-31')), true);
});

test('signing in July of a renewal year already counts for the next cycle', () => {
  const expiry = healthExpiryDate('2026-07-15');
  assert.equal(expiry.getFullYear(), 2028);
  assert.equal(isHealthDeclarationValid('2026-07-15', day('2026-08-04')), true);
});
