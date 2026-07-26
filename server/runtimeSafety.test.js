import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresDurableStore, publicStoreUnavailableError } from './runtimeSafety.js';

test('durable store is mandatory in production and on Render', () => {
  assert.equal(requiresDurableStore({ NODE_ENV: 'production' }), true);
  assert.equal(requiresDurableStore({ RENDER: 'true' }), true);
  assert.equal(requiresDurableStore({ RENDER_SERVICE_ID: 'srv-1' }), true);
  assert.equal(requiresDurableStore({ RENDER_EXTERNAL_URL: 'https://example.onrender.com' }), true);
});

test('local development may run with fixture data', () => {
  assert.equal(requiresDurableStore({ NODE_ENV: 'development' }), false);
  assert.equal(requiresDurableStore({}), false);
});

test('public durable-store failure is retryable and not reported as missing data', () => {
  const result = publicStoreUnavailableError();
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'DURABLE_STORE_UNAVAILABLE');
  assert.match(result.body.error, /זמינה זמנית/);
});
