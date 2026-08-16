import test from 'node:test';
import assert from 'node:assert/strict';
import {
  awaitingSince,
  hasConversation,
  isAwaitingHandling,
  isHandedToStaff,
  latestInboundInThread,
  nextCommunicationRow,
  pickCommunicationTarget,
  sortCommunicationRows,
  sortConversationRows,
  sortHandoffRows,
  threadIsAwaitingReply,
} from './communicationQueue.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

test('the waiting queue holds only customers the bot handed to the team', () => {
  const now = Date.now();
  // כתב לנו והבוט ענה לבד — זו שיחה, לא עבודה.
  assert.equal(isHandedToStaff({ last_inbound_whatsapp: iso(now - HOUR) }), false);
  assert.equal(isHandedToStaff({ bot_handoff_at: iso(now - HOUR) }), true);
});

test('a handoff closes when it is marked handled, and expires after two weeks', () => {
  const now = Date.now();
  assert.equal(
    isHandedToStaff({ bot_handoff_at: iso(now - HOUR), communication_handled_at: iso(now) }),
    false
  );
  // סימון ישן מההעברה לא סוגר אותה — הלקוח כתב שוב אחריו.
  assert.equal(
    isHandedToStaff({ bot_handoff_at: iso(now - HOUR), communication_handled_at: iso(now - 2 * HOUR) }),
    true
  );
  assert.equal(isHandedToStaff({ bot_handoff_at: iso(now - 20 * DAY) }), false);
});

test('the waiting queue puts the longest wait on top', () => {
  const now = Date.now();
  const fresh = { key: 'fresh', parents: [{ bot_handoff_at: iso(now - HOUR) }], students: [] };
  const old = { key: 'old', parents: [{ bot_handoff_at: iso(now - 3 * DAY) }], students: [] };
  assert.deepEqual(sortHandoffRows([fresh, old]).map((row) => row.key), ['old', 'fresh']);
});

test('the conversations tab holds anyone who ever wrote, newest first', () => {
  const now = Date.now();
  assert.equal(hasConversation({ last_inbound_instagram: iso(now - 200 * DAY) }), true);
  assert.equal(hasConversation({ bot_handoff_at: iso(now) }), false);

  const older = { key: 'older', parents: [{ last_inbound_whatsapp: iso(now - 2 * DAY) }], students: [] };
  const newer = { key: 'newer', parents: [{ last_inbound_whatsapp: iso(now - HOUR) }], students: [] };
  assert.deepEqual(sortConversationRows([older, newer]).map((row) => row.key), ['newer', 'older']);
});

test('conversation order ignores a registration the family just filled in', () => {
  const now = Date.now();
  const justRegistered = {
    key: 'registered',
    parents: [{ last_inbound_whatsapp: iso(now - 2 * DAY) }],
    students: [{ status: 'health_signed', healthSignedAt: iso(now) }],
  };
  const justWrote = { key: 'wrote', parents: [{ last_inbound_whatsapp: iso(now - HOUR) }], students: [] };
  assert.deepEqual(
    sortConversationRows([justRegistered, justWrote]).map((row) => row.key),
    ['wrote', 'registered']
  );
});

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

test('the card opens on the person who wrote, not on the head of the household', () => {
  const conversation = {
    parent: { phone: '0501111111' },
    threads: [
      { id: 'parent', role: 'parent', phone: '0501111111' },
      { id: 'student:s1', role: 'student', studentId: 's1', phone: '0522222222' },
    ],
    messages: [
      { direction: 'inbound', phone: '0501111111', created_at: '2026-08-05T08:00:00.000Z' },
      { direction: 'inbound', phone: '0522222222', student_id: 's1', created_at: '2026-08-05T09:00:00.000Z' },
    ],
  };

  const parentAt = latestInboundInThread(conversation, 'parent');
  const studentAt = latestInboundInThread(conversation, 'student:s1');
  assert.equal(parentAt, Date.parse('2026-08-05T08:00:00.000Z'));
  assert.ok(studentAt > parentAt, 'the child wrote last, so the child thread opens');
});

test('a household member who never wrote scores nothing', () => {
  const conversation = {
    parent: { phone: '0501111111' },
    threads: [{ id: 'parent', role: 'parent', phone: '0501111111' }],
    messages: [
      { direction: 'outbound', phone: '0501111111', created_at: '2026-08-05T08:00:00.000Z' },
    ],
  };

  assert.equal(latestInboundInThread(conversation, 'parent'), 0);
  assert.equal(latestInboundInThread(conversation, 'student:s9'), 0);
  assert.equal(latestInboundInThread(null, 'parent'), 0);
});

// A household exactly like the one that started this: the row is filed under
// the father, the mother is the one who wrote, and the son has his own phone.
const dad = { id: 'p1', name: 'גלעד', phone: '0501111111' };
const mum = { id: 'p2', name: 'עדה', phone: '0503333333', last_inbound_whatsapp: '2026-08-11T07:53:00.000Z' };
const familyTabs = [
  { key: 'student:s1', kind: 'student', student: { id: 's1', phone: '0522222222' }, parent: dad },
  { key: 'parent:p1', kind: 'parent', parent: dad },
  { key: 'parent:p2', kind: 'parent', parent: mum },
];
const targetForTab = (tab) => (tab.kind === 'student'
  ? { parentId: tab.parent.id, threadId: `student:${tab.student.id}` }
  : { parentId: tab.parent.id, threadId: 'parent' });

test('before the threads load, the parent card that was written to wins', () => {
  const best = pickCommunicationTarget(familyTabs, {
    targetForTab,
    conversationFor: () => null,
  });

  assert.equal(best.tab.key, 'parent:p2');
  assert.equal(best.exact, false, 'a card knows the number wrote, not who');
});

test('nobody wrote — no target, and the card keeps its own default', () => {
  const quiet = [{ key: 'parent:p1', kind: 'parent', parent: dad }];
  assert.equal(pickCommunicationTarget(quiet, { targetForTab, conversationFor: () => null }), null);
});

test('a child writing from their own phone opens the child, not the parent', () => {
  // Both cards carry the same stamp: an inbound from the child touches the
  // parent card too. Only the loaded thread says which of them it was.
  const dadWithChildStamp = { ...dad, last_inbound_whatsapp: '2026-08-11T09:00:00.000Z' };
  const tabs = familyTabs.map((tab) => (
    tab.parent?.id === 'p1' ? { ...tab, parent: dadWithChildStamp } : tab
  ));
  const conversation = {
    parent: { phone: '0501111111' },
    threads: [
      { id: 'parent', role: 'parent', phone: '0501111111' },
      { id: 'student:s1', role: 'student', studentId: 's1', phone: '0522222222' },
    ],
    messages: [
      { direction: 'inbound', phone: '0522222222', student_id: 's1', created_at: '2026-08-11T09:00:00.000Z' },
    ],
  };

  const best = pickCommunicationTarget(tabs, {
    targetForTab,
    conversationFor: (parentId) => (parentId === 'p1' ? conversation : null),
  });

  assert.equal(best.tab.key, 'student:s1');
  assert.equal(best.target.threadId, 'student:s1');
  assert.equal(best.exact, true);
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
