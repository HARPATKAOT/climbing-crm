import test from 'node:test';
import assert from 'node:assert/strict';
import { liveBlockReason } from './broadcast.js';

// הבטחת הליבה של מנוע החסימות: הסרה שהגיעה אחרי יצירת המשימה (למשל בלילה,
// לפני שדיוור מתוזמן יוצא) נאכפת שוב ברגע השליחה, נמען-נמען.

const recipient = { phone: '972501111111' };

test('an opt-out recorded after job creation cancels a marketing send', () => {
  const job = { is_marketing: true, filters: {} };
  const parents = [{ id: 'p1', phone: '0501111111', marketing_opt_in: false }];
  assert.match(liveBlockReason(job, recipient, { parents, listRows: [] }), /להסיר מדיוור/);
});

test('the opt-out is honoured even when it sits on a duplicate card of the same phone', () => {
  const job = { is_marketing: true, filters: {} };
  const parents = [
    { id: 'p1', phone: '972501111111', marketing_opt_in: true },
    { id: 'p2', phone: '0501111111', marketing_opt_in: false },
  ];
  assert.notEqual(liveBlockReason(job, recipient, { parents, listRows: [] }), '');
});

test('a utility send is not blocked by marketing opt-out', () => {
  const job = { is_marketing: false, filters: {} };
  const parents = [{ id: 'p1', phone: '0501111111', marketing_opt_in: false }];
  assert.equal(liveBlockReason(job, recipient, { parents, listRows: [] }), '');
});

test('a list unsubscription recorded after job creation cancels the send', () => {
  const job = { is_marketing: false, filters: { listKey: 'marketing' } };
  const parents = [{ id: 'p1', phone: '0501111111', marketing_opt_in: true }];
  const listRows = [{ parentId: 'p1', listName: 'marketing', subscribed: false }];
  assert.match(liveBlockReason(job, recipient, { parents, listRows }), /רשימת התפוצה/);
});

test('a subscribed recipient passes', () => {
  const job = { is_marketing: true, filters: { listKey: 'marketing' } };
  const parents = [{ id: 'p1', phone: '0501111111', marketing_opt_in: true }];
  const listRows = [{ parentId: 'p1', listName: 'marketing', subscribed: true }];
  assert.equal(liveBlockReason(job, recipient, { parents, listRows }), '');
});
