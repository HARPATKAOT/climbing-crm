import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedGroupFrequency,
  approvedPlacementMessage,
  continueApprovedPlacement,
} from './placementApprovalContinuation.js';

function fakeDb(seed) {
  const store = structuredClone(seed);
  return {
    store,
    getOne(table, id) {
      return (store[table] || []).find((row) => String(row.id) === String(id));
    },
    update(table, id, patch) {
      const row = this.getOne(table, id);
      if (!row) return null;
      Object.assign(row, patch);
      return structuredClone(row);
    },
  };
}

const group = {
  id: 'adult-squad',
  name: 'נבחרת בוגרת — ב׳+ה׳ 19:10',
  skillLevel: 'נבחרת',
  priceWeek: 0,
  priceTwice: 560,
  signupLinkTwice: 'https://centre.example/squad-twice',
};

test('an adult squad approval always continues with its twice-weekly registration', async () => {
  assert.equal(approvedGroupFrequency(group), 'פעמיים בשבוע');
  const db = fakeDb({
    parents: [{ id: 'parent', phone: '0500000000' }],
    students: [{ id: 'ido', name: 'עידו גרינברג' }],
    groups: [group],
    placement_requests: [{
      id: 'request',
      status: 'approved',
      parent_id: 'parent',
      student_id: 'ido',
      student_name: 'עידו גרינברג',
      group_id: group.id,
      group_name: group.name,
    }],
  });
  const calls = [];
  const sent = [];
  const request = db.getOne('placement_requests', 'request');
  const result = await continueApprovedPlacement({
    db,
    persist: async () => {},
    request,
    group,
    buildTools: () => ({
      startSignup: async (args) => {
        calls.push(args);
        return {
          שובץ: 'עידו גרינברג',
          קבוצה: group.name,
          חבילת_הרשמה: {
            שלב_2_הרשמה_לקבוצה: { קישור: 'https://app.example/api/s/adult-squad/2' },
            שלב_3_תשלום_ציוד: { קישור: 'https://app.example/equipment/ido' },
          },
        };
      },
    }),
    sendReply: async (phone, message, options) => {
      sent.push({ phone, message, options });
      return { success: true, messageId: 'wa-1' };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    childName: 'עידו גרינברג',
    studentId: 'ido',
    groupId: 'adult-squad',
    frequency: 'פעמיים בשבוע',
  }]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].options.replyKey, 'placement-approval:request');
  assert.match(sent[0].message, /api\/s\/adult-squad\/2/);
  assert.match(sent[0].message, /גם אם יש ציוד משנה קודמת/);
  assert.equal(result.request.continuation_status, 'sent');
  assert.equal(result.request.continuation_message_id, 'wa-1');

  const retry = await continueApprovedPlacement({
    db,
    persist: async () => {},
    request: result.request,
    group,
    buildTools: () => { throw new Error('must not rebuild'); },
    sendReply: async () => { throw new Error('must not resend'); },
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.duplicate, true);
  assert.equal(sent.length, 1);
});

test('a send failure remains recoverable in the staff queue', async () => {
  const db = fakeDb({
    parents: [{ id: 'parent', phone: '0500000000' }],
    students: [{ id: 'ido', name: 'עידו' }],
    groups: [group],
    placement_requests: [{
      id: 'request-failed', status: 'approved', parent_id: 'parent', student_id: 'ido', group_id: group.id,
    }],
  });
  const result = await continueApprovedPlacement({
    db,
    persist: async () => {},
    request: db.getOne('placement_requests', 'request-failed'),
    group,
    buildTools: () => ({
      startSignup: async () => ({
        שובץ: 'עידו',
        חבילת_הרשמה: { שלב_2_הרשמה_לקבוצה: { קישור: 'https://app.example/register' } },
      }),
    }),
    sendReply: async () => ({ success: false, error: 'outside_24h' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.request.continuation_status, 'failed');
  assert.equal(result.request.continuation_error, 'outside_24h');
});

test('approval message asks for frequency only when the approved group still has a real choice', () => {
  const message = approvedPlacementMessage({
    request: { student_name: 'נועה', group_name: 'מתקדמים' },
    signup: {
      חבילת_הרשמה: {
        שלב_2_הרשמה_לקבוצה: {
          מצב: 'צריך לבחור תדירות',
          תדירויות_אפשריות: ['פעם בשבוע', 'פעמיים בשבוע'],
        },
      },
    },
  });
  assert.match(message, /פעם בשבוע או פעמיים בשבוע/);
  assert.doesNotMatch(message, /אין כרגע קישור/);
});
