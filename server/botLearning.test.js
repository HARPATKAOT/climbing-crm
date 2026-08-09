import test from 'node:test';
import assert from 'node:assert/strict';
import {
  textOverlapScore,
  matchLearnedReplies,
  formatLearnedRepliesForPrompt,
  recordFeedback,
  approveFeedback,
  proposeFromHandoffStaffReply,
  withBotReplies,
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

test('approved feedback stays quality-control data and never becomes a bot instruction', async () => {
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
  assert.equal(approved.learned, null);
  const matched = matchLearnedReplies(db, 'בן 7 כמה עולה החוג');
  assert.deepEqual(matched, []);
  const block = formatLearnedRepliesForPrompt(matched);
  assert.equal(block, '');
  assert.equal((db.get(LEARNED_COLLECTION) || []).length, 0);
  assert.equal((db.get(FEEDBACK_COLLECTION) || [])[0].status, 'approved');
});

test('thumbs-up records feedback without creating a learned reply', async () => {
  const db = memoryDb();
  const result = await recordFeedback({
    db,
    persist: async () => {},
    messageId: 'm-up',
    rating: 'up',
    inboundExcerpt: 'מתי פתוח?',
    replyExcerpt: 'היום פתוח עד 22:00',
    createdBy: 'tester',
  });
  assert.equal(result.ok, true);
  assert.equal((db.get(FEEDBACK_COLLECTION) || []).length, 1);
  assert.equal((db.get(LEARNED_COLLECTION) || []).length, 0);
});

// ─── הצעה אוטומטית מתשובת צוות אחרי העברה ────────────────────────────────────

const HANDOFF_AT = '2026-08-06T09:00:00.000Z';
const CARD = { id: 'p-1', phone: '0599111000', bot_handoff_at: HANDOFF_AT };

function threadDb(messages) {
  return memoryDb({ parents: [CARD], messages });
}

test('a staff reply after handoff is not proposed as bot learning', async () => {
  const db = threadDb([
    {
      id: 'in-1',
      phone: '0599111000',
      direction: 'inbound',
      message: 'כמה עולה יום הולדת?',
      created_at: '2026-08-06T08:58:00.000Z',
    },
    {
      id: 'out-1',
      phone: '0599111000',
      direction: 'outbound',
      is_ai: true,
      source: 'ai',
      message: 'אין לי את המחיר הזה',
      created_at: '2026-08-06T08:59:00.000Z',
    },
    {
      id: 'out-2',
      phone: '0599111000',
      direction: 'outbound',
      is_ai: true,
      // The handoff acknowledgement is the bot saying it has no answer.
      source: 'bot_control',
      message: 'מעבירים אתכם לצוות',
      created_at: HANDOFF_AT,
    },
  ]);

  const result = await proposeFromHandoffStaffReply({
    db,
    persist: async () => {},
    phone: '0599111000',
    parent: CARD,
    staffText: 'יום הולדת מתחיל ב-1,800 ₪ עד 20 ילדים',
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'quality_control_only');
  assert.equal((db.get(FEEDBACK_COLLECTION) || []).length, 0);
});

test('a reaction is not a question, and never becomes a learned example', async () => {
  const db = threadDb([
    {
      id: 'in-1',
      phone: '0599111000',
      direction: 'inbound',
      message_type: 'reaction',
      message: 'ריאקציה: 🙏',
      created_at: '2026-08-06T08:59:00.000Z',
    },
  ]);

  const result = await proposeFromHandoffStaffReply({
    db,
    persist: async () => {},
    phone: '0599111000',
    parent: CARD,
    staffText: 'אוי, שירגיש טוב ❤️',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quality_control_only');
  assert.equal((db.get(FEEDBACK_COLLECTION) || []).length, 0);
});

test('an older proposal gets its bot reply filled in from the conversation', () => {
  const db = threadDb([
    {
      id: 'in-1',
      phone: '0599111000',
      direction: 'inbound',
      message: 'כמה עולה יום הולדת?',
      created_at: '2026-08-06T08:58:00.000Z',
    },
    {
      id: 'out-1',
      phone: '0599111000',
      direction: 'outbound',
      is_ai: true,
      source: 'ai',
      message: 'אין לי את המחיר הזה',
      created_at: '2026-08-06T08:59:00.000Z',
    },
    {
      id: 'out-2',
      phone: '0599111000',
      direction: 'outbound',
      is_ai: true,
      source: 'bot_control',
      message: 'מעבירים אתכם לצוות',
      created_at: HANDOFF_AT,
    },
  ]);
  // Written before the reply was stored: the screen showed an empty line, and
  // there was nothing to judge the staff alternative against.
  const [filled] = withBotReplies(db, [{
    id: 'f-1',
    phone: '0599111000',
    reply_excerpt: '',
    inbound_excerpt: 'כמה עולה יום הולדת?',
    created_at: HANDOFF_AT,
  }]);
  assert.equal(filled.reply_excerpt, 'אין לי את המחיר הזה');

  // A row that already carries one is left exactly as it is.
  const [kept] = withBotReplies(db, [{ id: 'f-2', phone: '0599111000', reply_excerpt: 'כבר שמור', created_at: HANDOFF_AT }]);
  assert.equal(kept.reply_excerpt, 'כבר שמור');
});

test('the reply shown is the answer to that question, not the one before it', () => {
  // «שהם» was shown against «נעים מאוד אלון, ומה שם המשפחה?» — the question
  // that had prompted it. The card read backwards, and the staff alternative
  // was being judged against a reply to a different message.
  const db = threadDb([
    { id: 'in-1', phone: '0599111000', direction: 'inbound', message: 'אלון', created_at: '2026-08-06T08:50:00.000Z' },
    {
      id: 'out-1',
      phone: '0599111000',
      direction: 'outbound',
      is_ai: true,
      source: 'ai',
      message: 'נעים מאוד אלון 🙂 ומה שם המשפחה?',
      created_at: '2026-08-06T08:50:30.000Z',
    },
    { id: 'in-2', phone: '0599111000', direction: 'inbound', message: 'שהם', created_at: '2026-08-06T08:51:00.000Z' },
    {
      id: 'out-2',
      phone: '0599111000',
      direction: 'outbound',
      is_ai: true,
      source: 'ai',
      message: 'תודה אלון שהם! במה אפשר לעזור?',
      created_at: '2026-08-06T08:51:20.000Z',
    },
  ]);

  const [filled] = withBotReplies(db, [{
    id: 'f-3',
    phone: '0599111000',
    reply_excerpt: '',
    inbound_excerpt: 'שהם',
    created_at: '2026-08-06T08:52:00.000Z',
  }]);
  assert.equal(filled.reply_excerpt, 'תודה אלון שהם! במה אפשר לעזור?');

  // And when the only thing after the question was the handoff line, there is
  // no answer to show — an empty field is the truth, not an older message.
  const noAnswer = threadDb([
    { id: 'in-1', phone: '0599111000', direction: 'inbound', message: 'אלון', created_at: '2026-08-06T08:50:00.000Z' },
    {
      id: 'out-1', phone: '0599111000', direction: 'outbound', is_ai: true, source: 'ai',
      message: 'נעים מאוד אלון 🙂', created_at: '2026-08-06T08:50:30.000Z',
    },
    { id: 'in-2', phone: '0599111000', direction: 'inbound', message: 'שהם', created_at: '2026-08-06T08:51:00.000Z' },
    {
      id: 'out-2', phone: '0599111000', direction: 'outbound', is_ai: true, source: 'bot_control',
      message: 'מעבירים אתכם לצוות', created_at: '2026-08-06T08:51:20.000Z',
    },
  ]);
  const [empty] = withBotReplies(noAnswer, [{
    id: 'f-4', phone: '0599111000', reply_excerpt: '', inbound_excerpt: 'שהם', created_at: '2026-08-06T08:52:00.000Z',
  }]);
  assert.equal(empty.reply_excerpt, '');
});

test('a photo with no caption is not a question either', async () => {
  const db = threadDb([
    {
      id: 'in-1',
      phone: '0599111000',
      direction: 'inbound',
      message_type: 'image',
      message: '[תמונה]',
      created_at: '2026-08-06T08:59:00.000Z',
    },
  ]);

  const result = await proposeFromHandoffStaffReply({
    db,
    persist: async () => {},
    phone: '0599111000',
    parent: CARD,
    staffText: 'קיבלנו, נבדוק ונחזור',
  });

  assert.equal(result.ok, false);
  assert.equal((db.get(FEEDBACK_COLLECTION) || []).length, 0);
});
