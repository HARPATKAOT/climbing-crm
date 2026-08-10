import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awaitingSince,
  isAwaitingHandling,
  nextCommunicationRow,
  sortCommunicationRows,
  threadIsAwaitingReply,
} from './communicationQueue.js';

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

test('handling queue can be sorted by conversation time in both directions', () => {
  const older = {
    key: 'older',
    parent: { name: 'ברק', last_inbound_whatsapp: '2026-08-08T08:00:00Z' },
    parents: [],
    students: [],
  };
  const newer = {
    key: 'newer',
    parent: { name: 'אורית', last_inbound_whatsapp: '2026-08-09T08:00:00Z' },
    parents: [],
    students: [],
  };

  assert.deepEqual(
    sortCommunicationRows([older, newer], 'conversation_desc').map((row) => row.key),
    ['newer', 'older']
  );
  assert.deepEqual(
    sortCommunicationRows([older, newer], 'conversation_asc').map((row) => row.key),
    ['older', 'newer']
  );
});

test('handling queue supports parent-name and intake-date sorting', () => {
  const rows = [
    { key: 'b', parent: { name: 'ברק' }, students: [], created: '2026-08-01' },
    { key: 'a', parent: { name: 'אורית' }, students: [], created: '2026-08-03' },
  ];

  assert.deepEqual(
    sortCommunicationRows(rows, 'name_asc').map((row) => row.key),
    ['a', 'b']
  );
  assert.deepEqual(
    sortCommunicationRows(rows, 'created_desc').map((row) => row.key),
    ['a', 'b']
  );
  assert.deepEqual(rows.map((row) => row.key), ['b', 'a']);
});

test('finishing treatment advances to the next household in queue order', () => {
  const rows = [
    { key: 'first', parents: [{ id: 'p1' }] },
    { key: 'second', parents: [{ id: 'p2' }, { id: 'p3' }] },
    { key: 'third', parent: { id: 'p4' } },
  ];

  assert.equal(nextCommunicationRow(rows, ['p2', 'p3'])?.key, 'third');
  assert.equal(nextCommunicationRow(rows, 'p4'), null);
  assert.equal(nextCommunicationRow(rows, 'missing'), null);
});

test('reply indicator belongs only to the exact family member whose last message is inbound', () => {
  const conversation = {
    parent: { phone: '0501111111' },
    threads: [
      { id: 'parent', role: 'parent', phone: '0501111111' },
      { id: 'student:s1', role: 'student', studentId: 's1', phone: '0522222222' },
    ],
    messages: [
      { direction: 'inbound', phone: '0501111111', created_at: '2026-08-05T08:00:00.000Z' },
      { direction: 'outbound', phone: '0501111111', created_at: '2026-08-05T08:01:00.000Z' },
      { direction: 'inbound', phone: '0522222222', student_id: 's1', created_at: '2026-08-05T08:02:00.000Z' },
    ],
  };

  assert.equal(threadIsAwaitingReply(conversation, 'parent'), false);
  assert.equal(threadIsAwaitingReply(conversation, 'student:s1'), true);
});

test('an outbound reply clears only its own thread indicator', () => {
  const conversation = {
    parent: { phone: '0501111111' },
    threads: [{ id: 'parent', role: 'parent', phone: '0501111111' }],
    messages: [
      { direction: 'inbound', channel: 'whatsapp', phone: '0501111111', created_at: '2026-08-05T08:00:00.000Z' },
      { direction: 'outbound', channel: 'whatsapp', phone: '0501111111', created_at: '2026-08-05T08:03:00.000Z' },
    ],
  };

  assert.equal(threadIsAwaitingReply(conversation, 'parent'), false);
});
