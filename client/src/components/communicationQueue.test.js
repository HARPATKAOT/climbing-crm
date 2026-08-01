import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitingSince, isAwaitingHandling } from './communicationQueue.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

test('an inbound message newer than the handled mark is waiting', () => {
  const now = Date.now();
  const parent = {
    last_inbound_whatsapp: iso(now - HOUR),
    communication_handled_at: iso(now - 2 * HOUR),
  };
  assert.equal(isAwaitingHandling(parent), true);
  assert.equal(
    isAwaitingHandling({ ...parent, communication_handled_at: iso(now) }),
    false
  );
});

test('a family who just registered is waiting, with no message at all', () => {
  const now = Date.now();
  const student = { status: 'health_signed', healthSignedAt: iso(now - HOUR) };
  assert.equal(isAwaitingHandling({}, [student]), true);
  assert.equal(
    isAwaitingHandling({ communication_handled_at: iso(now) }, [student]),
    false,
    'marking it handled clears a registration exactly as it clears a message'
  );
});

test('a registration someone already moved along is not waiting', () => {
  const now = Date.now();
  assert.equal(
    isAwaitingHandling({}, [{ status: 'intro_scheduled', healthSignedAt: iso(now - HOUR) }]),
    false
  );
});

test('old registrations do not flood the queue', () => {
  const now = Date.now();
  assert.equal(
    isAwaitingHandling({}, [{ status: 'health_signed', healthSignedAt: iso(now - 60 * DAY) }]),
    false
  );
  assert.equal(
    isAwaitingHandling({}, [{ status: 'health_signed', healthSignedAt: iso(now - 2 * DAY) }]),
    true
  );
});

test('a family with neither a message nor a registration is not in the queue', () => {
  assert.equal(isAwaitingHandling({ name: 'ותיק' }, []), false);
  assert.equal(awaitingSince({ name: 'ותיק' }, []), 0);
});

test('the queue sorts by whichever happened last', () => {
  const now = Date.now();
  const messaged = { last_inbound_whatsapp: iso(now - 3 * HOUR) };
  const justSigned = [{ status: 'health_signed', healthSignedAt: iso(now - HOUR) }];
  assert.ok(awaitingSince({}, justSigned) > awaitingSince(messaged, []));
});
