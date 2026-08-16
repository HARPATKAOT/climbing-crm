import test from 'node:test';
import assert from 'node:assert/strict';
import { liveBlockReason, computeReplyStats } from './broadcast.js';

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

// דוח התגובות: הודעה נכנסת אחרי השליחה נספרת; לחיצת כפתור «מעוניינים»
// נספרת כתגובה חיובית; הודעה מלפני השליחה או אחרי 72 שעות — לא.
test('reply stats count post-send replies and template button presses', () => {
  const sentAt = '2026-08-16T08:00:00.000Z';
  const recipients = [
    { phone: '972501111111', status: 'sent', sent_at: sentAt },
    { phone: '972502222222', status: 'sent', sent_at: sentAt },
    { phone: '972503333333', status: 'sent', sent_at: sentAt },
  ];
  const inbound = [
    // תגובה חופשית שעה אחרי.
    { phone: '0501111111', direction: 'inbound', message: 'כמה זה עולה?', created_at: '2026-08-16T09:00:00.000Z' },
    // לחיצה על כפתור התבנית.
    { phone: '0502222222', direction: 'inbound', message: 'מעוניינים , תנו לנו פרטים', created_at: '2026-08-16T10:00:00.000Z' },
    // הודעה ישנה מלפני הדיוור — לא תגובה.
    { phone: '0503333333', direction: 'inbound', message: 'בוקר טוב', created_at: '2026-08-16T07:00:00.000Z' },
  ];
  const out = computeReplyStats(recipients, inbound, ['מעוניינים , תנו לנו פרטים']);
  assert.equal(out.replied, 2);
  assert.equal(out.buttonReplies, 1);
  assert.equal(out.recipients[0].replied, true);
  assert.equal(out.recipients[0].button_reply, false);
  assert.equal(out.recipients[1].button_reply, true);
  assert.equal(out.recipients[2].replied, undefined);
});
