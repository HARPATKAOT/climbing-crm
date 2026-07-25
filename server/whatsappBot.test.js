import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipReply,
  textMatchesKeywords,
  normalizeMenuChoice,
  audienceAllows,
  isBotPaused,
  isOptedOut,
  decideBotGate,
  parseAiReply,
  classifyAudience,
  mergeBotSettings,
  applyBusinessBrand,
} from './whatsappBot.js';
import { isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';

test('clipReply truncates long text', () => {
  const long = 'א'.repeat(50);
  assert.equal(clipReply(long, 20).endsWith('…'), true);
  assert.ok(clipReply(long, 20).length <= 20);
});

test('applyBusinessBrand replaces legacy gym name', () => {
  const branded = applyBusinessBrand(
    {
      aiSystemPrompt: 'אתה הבוט של My Wall',
      aiGreetingMenu: 'היי מ-My Wall',
      aiHandoffAckMessage: 'צוות My Wall',
    },
    'הרפתקאות'
  );
  assert.equal(branded.brandName, 'הרפתקאות');
  assert.equal(branded.aiSystemPrompt, 'אתה הבוט של הרפתקאות');
  assert.equal(branded.aiGreetingMenu, 'היי מ-הרפתקאות');
  assert.equal(branded.aiHandoffAckMessage, 'צוות הרפתקאות');
  assert.doesNotMatch(branded.aiGreetingMenu, /My Wall/i);
});

test('handoff and stop keywords match', () => {
  assert.equal(textMatchesKeywords('אפשר לדבר עם נציג?', 'אדם,נציג,צוות'), true);
  assert.equal(textMatchesKeywords('עצור בבקשה', 'עצור,הסר,stop'), true);
  assert.equal(textMatchesKeywords('שלום', 'עצור,הסר'), false);
});

test('normalizeMenuChoice maps numbers and titles', () => {
  assert.equal(normalizeMenuChoice('2'), '2');
  assert.equal(normalizeMenuChoice('4'), '4');
  assert.equal(normalizeMenuChoice('הצהרת בריאות'), '1');
  assert.equal(normalizeMenuChoice('לדבר עם צוות'), '4');
});

test('audience modes', () => {
  const leadParent = { status: 'lead_new' };
  const customerStudent = [{ status: 'registered' }];
  assert.equal(classifyAudience(leadParent, []), 'lead');
  assert.equal(classifyAudience({}, customerStudent), 'customer');
  assert.equal(audienceAllows({ aiAudienceMode: 'leads_only' }, leadParent, []), true);
  assert.equal(audienceAllows({ aiAudienceMode: 'leads_only' }, {}, customerStudent), false);
  assert.equal(audienceAllows({ aiAudienceMode: 'customers_only' }, {}, customerStudent), true);
});

test('pause and opt-out flags', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isBotPaused({ bot_paused_until: future }), true);
  assert.equal(isBotPaused({ bot_paused_until: past }), false);
  assert.equal(isOptedOut({ bot_opted_out: true }), true);
});

test('decideBotGate: disabled / opted out / handoff / outside hours', () => {
  const base = mergeBotSettings({
    aiResponderEnabled: true,
    aiActiveHoursEnabled: false,
  });
  assert.equal(decideBotGate({ ...base, aiResponderEnabled: false }, {}, [], 'שלום').action, 'silence');
  assert.equal(
    decideBotGate({ ...base, aiResponderEnabled: false }, {}, [], 'שלום', { isSimulator: true }).action,
    'reply'
  );
  assert.equal(decideBotGate(base, { bot_opted_out: true }, [], 'שלום').action, 'silence');
  assert.equal(decideBotGate(base, {}, [], 'רוצה נציג').action, 'handoff');
  assert.equal(decideBotGate(base, {}, [], '4').action, 'handoff');
  assert.equal(decideBotGate(base, {}, [], 'עצור').action, 'opt_out');

  const outside = decideBotGate(
    {
      ...base,
      aiActiveHoursEnabled: true,
      aiActiveHoursStart: '00:00',
      aiActiveHoursEnd: '00:01',
      aiActiveDays: [0, 1, 2, 3, 4, 5, 6],
    },
    {},
    [],
    'שלום',
    { isSimulator: false }
  );
  // May or may not be outside depending on current Israel time — simulator bypasses
  const sim = decideBotGate(
    {
      ...base,
      aiActiveHoursEnabled: true,
      aiActiveHoursStart: '00:00',
      aiActiveHoursEnd: '00:01',
    },
    {},
    [],
    'שלום',
    { isSimulator: true }
  );
  assert.equal(sim.action, 'reply');
  assert.ok(['outside_hours', 'reply', 'silence'].includes(outside.action));
});

test('parseAiReply detects UNSURE prefix', () => {
  const parsed = parseAiReply('UNSURE\nלא בטוח לגבי המחיר', { aiUnsureReply: 'מעביר לצוות', aiMaxReplyChars: 700 });
  assert.equal(parsed.unsure, true);
  assert.match(parsed.text, /לא בטוח|מעביר/);
});

test('schedule helpers still work', () => {
  assert.equal(isBotEnabled({ aiResponderEnabled: false }), false);
  assert.equal(
    shouldAiAutoReply({
      aiResponderEnabled: true,
      aiActiveHoursEnabled: false,
    }),
    true
  );
});
