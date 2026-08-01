import test from 'node:test';
import assert from 'node:assert/strict';
import {
  noteMessagesChanged,
  currentVersion,
  waitForMessages,
  releaseAllWaiters,
} from './liveUpdates.js';

test('a version already ahead returns without waiting', async () => {
  noteMessagesChanged();
  const result = await waitForMessages({ since: currentVersion() - 1, timeoutMs: 5000 });
  assert.equal(result.changed, true);
  assert.equal(result.version, currentVersion());
});

test('a waiting request wakes the moment a message is stored', async () => {
  const start = currentVersion();
  const pending = waitForMessages({ since: start, timeoutMs: 5000 });
  // Nothing has happened yet, so the promise must still be open.
  const raced = await Promise.race([pending, Promise.resolve('still waiting')]);
  assert.equal(raced, 'still waiting');

  noteMessagesChanged();
  const result = await pending;
  assert.equal(result.changed, true);
  assert.equal(result.version, start + 1);
});

test('a quiet wait times out and reports no change', async () => {
  const result = await waitForMessages({ since: currentVersion(), timeoutMs: 1000 });
  assert.equal(result.changed, false);
});

test('two screens waiting are both woken by one message', async () => {
  const start = currentVersion();
  const a = waitForMessages({ since: start, timeoutMs: 5000 });
  const b = waitForMessages({ since: start, timeoutMs: 5000 });
  noteMessagesChanged();
  const [first, second] = await Promise.all([a, b]);
  assert.equal(first.changed, true);
  assert.equal(second.changed, true);
});

test('releasing waiters never leaves a request hanging', async () => {
  const pending = waitForMessages({ since: currentVersion(), timeoutMs: 5000 });
  releaseAllWaiters();
  const result = await pending;
  assert.equal(typeof result.version, 'number');
});
