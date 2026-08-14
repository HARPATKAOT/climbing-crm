import test from 'node:test';
import assert from 'node:assert/strict';
import {
  botOfferedIntroChoice,
  customerAllowsIntro,
  recoverStalledIntroOffers,
  stalledIntroOfferThreads,
} from './introOfferPolicy.js';

const user = (text) => ({ role: 'user', parts: [{ text }] });

test('intro is unavailable during an ordinary direct registration', () => {
  assert.equal(customerAllowsIntro([user('אני רוצה לרשום את נועה ליום שלישי')]), false);
  assert.equal(botOfferedIntroChoice('תרצו הרשמה ישירה או אימון היכרות?'), true);
});

test('an explicit intro request or reluctance to register enables intro', () => {
  assert.equal(customerAllowsIntro([], 'אפשר להגיע לאימון היכרות?'), true);
  assert.equal(customerAllowsIntro([], 'עוד לא רוצים להירשם, מעדיפים לנסות קודם'), true);
  assert.equal(customerAllowsIntro([], 'לא רוצים אימון היכרות, רוצים להירשם'), false);
});

test('an internal recovery update cannot accidentally enable the intro tool', () => {
  assert.equal(customerAllowsIntro([], '[מערכת] המשך בהרשמה הישירה ואל תציע אימון היכרות.'), false);
});

test('the audit finds only a last unanswered unsolicited offer', () => {
  const messages = [
    { phone: '0501111111', direction: 'inbound', message: 'יום שלישי מתאים', created_at: '2026-08-14T09:00:00Z' },
    { phone: '0501111111', direction: 'outbound', is_ai: true, message: 'תרצו הרשמה ישירה או אימון היכרות?', created_at: '2026-08-14T09:01:00Z' },
    { phone: '0502222222', direction: 'inbound', message: 'אפשר אימון היכרות?', created_at: '2026-08-14T10:00:00Z' },
    { phone: '0502222222', direction: 'outbound', is_ai: true, message: 'תרצו הרשמה ישירה או אימון היכרות?', created_at: '2026-08-14T10:01:00Z' },
    { phone: '0503333333', direction: 'outbound', is_ai: true, message: 'תרצו הרשמה ישירה או אימון היכרות?', created_at: '2026-08-14T11:00:00Z' },
    { phone: '0503333333', direction: 'inbound', message: 'ישירה', created_at: '2026-08-14T11:01:00Z' },
  ];
  const rows = stalledIntroOfferThreads({
    messages,
    parents: [{ id: 'p1', name: 'מיכל', phone: '0501111111' }],
  });
  assert.deepEqual(rows.map((row) => row.parentId), ['p1']);
});

test('recovery continues direct signup once with a durable policy key', async () => {
  const messages = [
    { id: 'in-1', phone: '0501111111', direction: 'inbound', message: 'יום שלישי מתאים', created_at: '2026-08-14T09:00:00Z' },
    { id: 'offer-1', phone: '0501111111', direction: 'outbound', is_ai: true, message: 'תרצו הרשמה ישירה או אימון היכרות?', created_at: '2026-08-14T09:01:00Z' },
  ];
  const parents = [{ id: 'p1', name: 'מיכל', phone: '0501111111' }];
  const calls = [];
  const result = await recoverStalledIntroOffers({
    messages,
    parents,
    now: Date.parse('2026-08-14T10:00:00Z'),
    getStudents: () => [{ id: 's1' }],
    continueConversation: async (...args) => {
      calls.push(args);
      return { success: true, reason: 'continued' };
    },
  });
  assert.equal(result.candidates, 1);
  assert.deepEqual(result.results, [{ parentId: 'p1', success: true, reason: 'continued' }]);
  assert.match(calls[0][1], /startSignup/);
  assert.equal(calls[0][2].replyKey, 'intro-policy-recovery:offer-1');
  assert.equal(calls[0][2].respectGate, true);
});

test('recovery never contacts a customer after the free-text window closed', async () => {
  const messages = [
    { id: 'in-old', phone: '0501111111', direction: 'inbound', message: 'יום שלישי מתאים', created_at: '2026-08-12T09:00:00Z' },
    { id: 'offer-old', phone: '0501111111', direction: 'outbound', is_ai: true, message: 'הרשמה ישירה או אימון היכרות?', created_at: '2026-08-12T09:01:00Z' },
  ];
  let called = false;
  const result = await recoverStalledIntroOffers({
    messages,
    parents: [{ id: 'p1', phone: '0501111111' }],
    now: Date.parse('2026-08-14T10:00:00Z'),
    continueConversation: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.deepEqual(result.results, [{ parentId: 'p1', success: false, reason: 'window_closed' }]);
});
