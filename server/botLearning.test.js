import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textOverlapScore,
  matchLearnedReplies,
  formatLearnedRepliesForPrompt,
  recordFeedback,
  approveFeedback,
  FEEDBACK_PENDING,
  LEARNED_COLLECTION,
  FEEDBACK_COLLECTION,
} from './botLearning.js';

function memoryDb(seed = {}) {
  const tables = { ...seed };
  return {
    get: (name) => tables[name] || [],
    insert: (name, row) => {
      const full = { id: row.id || `${name}-${Date.now()}-${Math.random()}`, ...row };
      tables[name] = [...(tables[name] || []), full];
      return full;
    },
    update: (name, id, patch) => {
      const list = tables[name] || [];
      const idx = list.findIndex((r) => String(r.id) === String(id));
      if (idx < 0) return null;
      const next = { ...list[idx], ...patch };
      tables[name] = list.map((r, i) => (i === idx ? next : r));
      return next;
    },
  };
}

test('text overlap scores similar hebrew questions', () => {
  assert.ok(textOverlapScore('יש מקום בחוג לכיתה ג', 'מקום בחוג כיתה ג') > 0.3);
  assert.equal(textOverlapScore('שלום', 'מתי אתם פתוחים'), 0);
});

test('feedback down with alternative enters pending queue', async () => {
  const db = memoryDb();
  const result = await recordFeedback({
    db,
    persist: async () => {},
    messageId: 'm1',
    rating: 'down',
    alternative: 'רק לכיתה א׳–ב׳ יש מקום ביום ג׳ 17:10',
    inboundExcerpt: 'יש מקום בחוג?',
    replyExcerpt: 'יש מקום בכל הימים',
    createdBy: 'tester',
  });
  assert.equal(result.ok, true);
  assert.equal(result.row.status, FEEDBACK_PENDING);
});

test('approve feedback creates an active learned reply', async () => {
  const db = memoryDb();
  const created = await recordFeedback({
    db,
    persist: async () => {},
    messageId: 'm2',
    rating: 'down',
    alternative: 'לכיתה א׳–ב׳ יש מקום ביום ג׳ 17:10 במחיר 290 ₪',
    inboundExcerpt: 'לילד בן 7 כמה עולה?',
    replyExcerpt: 'כל המחירים...',
    createdBy: 'tester',
  });
  const approved = await approveFeedback({
    db,
    persist: async () => {},
    id: created.row.id,
    actor: 'owner',
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.learned.active, true);
  const matched = matchLearnedReplies(db, 'בן 7 כמה עולה החוג');
  assert.ok(matched.length >= 1);
  const block = formatLearnedRepliesForPrompt(matched);
  assert.match(block, /דוגמאות מאושרות/);
  assert.equal((db.get(LEARNED_COLLECTION) || []).length, 1);
  assert.equal((db.get(FEEDBACK_COLLECTION) || [])[0].status, 'approved');
});
