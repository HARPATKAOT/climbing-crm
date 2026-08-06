import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, REFRESH_AFTER_MS } from './tableCache.js';

/**
 * This decision is what stands between "every screen waits three seconds" and
 * "a record someone just saved is missing from the list". Both directions are
 * worth pinning down.
 */

test('a populated cache answers from memory instead of waiting', () => {
  assert.equal(
    readPlan({ durableEnabled: true, cachedCount: 1200, ageMs: 0 }),
    'memory'
  );
});

test('an empty table waits for the durable store rather than serving nothing', () => {
  assert.equal(
    readPlan({ durableEnabled: true, cachedCount: 0, ageMs: 10 ** 9 }),
    'await-durable',
    'an empty cache after a deploy must not be served as if it were the answer'
  );
});

test('a stale but populated table is served now and refreshed behind the answer', () => {
  assert.equal(
    readPlan({ durableEnabled: true, cachedCount: 5, ageMs: REFRESH_AFTER_MS + 1 }),
    'refresh-behind'
  );
});

test('a table refreshed a moment ago is not re-downloaded', () => {
  assert.equal(
    readPlan({ durableEnabled: true, cachedCount: 5, ageMs: REFRESH_AFTER_MS - 1 }),
    'memory'
  );
});

test('with no durable store configured nothing is ever awaited', () => {
  for (const cachedCount of [0, 500]) {
    assert.equal(
      readPlan({ durableEnabled: false, cachedCount, ageMs: 10 ** 9 }),
      'memory'
    );
  }
});
