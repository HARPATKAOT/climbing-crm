import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipReply,
  textMatchesKeywords,
  normalizeMenuChoice,
  audienceAllows,
  isBotPaused,
  isOptedOut,
  describeBotState,
  decideBotGate,
  parseAiReply,
  classifyAudience,
  mergeBotSettings,
  applyBusinessBrand,
  isStaffPhone,
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
  assert.equal(normalizeMenuChoice('5'), '5');
  assert.equal(normalizeMenuChoice('הצהרת בריאות'), '1');
  assert.equal(normalizeMenuChoice('לדבר עם צוות'), '4');
  assert.equal(normalizeMenuChoice('אירועים וטיולים'), '5');
  // "יש טיול בקרוב?" is an events question, not a classes one
  assert.equal(normalizeMenuChoice('יש טיול בקרוב?'), '5');
});

test('money and injury words reach a human', () => {
  const settings = mergeBotSettings({ aiResponderEnabled: true });
  for (const text of ['אני רוצה לבטל את החוג', 'מגיע לי החזר כספי', 'הילד נפצע באימון']) {
    const gate = decideBotGate(settings, { status: 'active' }, [], text);
    assert.equal(gate.action, 'handoff', text);
  }
});

test('only a listed staff number gets the CRM agent', () => {
  const settings = { aiStaffPhones: '0501234567, 972529876543' };
  assert.equal(isStaffPhone(settings, '972501234567'), true);
  assert.equal(isStaffPhone(settings, '0529876543'), true);
  assert.equal(isStaffPhone(settings, '972544444444'), false);
  assert.equal(isStaffPhone({ aiStaffPhones: '' }, '972501234567'), false);
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

test('describeBotState reports an active bot', () => {
  const state = describeBotState({}, { aiResponderEnabled: true });
  assert.equal(state.status, 'active');
  assert.equal(state.globallyOff, false);
});

test('describeBotState flags the master switch without hiding the per-customer state', () => {
  const off = describeBotState({}, { aiResponderEnabled: false });
  assert.equal(off.status, 'active');
  assert.equal(off.globallyOff, true);
});

test('describeBotState counts down a live pause and ignores a lapsed one', () => {
  const now = new Date('2026-07-29T12:00:00.000Z');
  const live = describeBotState(
    { bot_paused_until: '2026-07-29T13:47:00.000Z', bot_pause_reason: 'human_reply' },
    { aiResponderEnabled: true },
    now
  );
  assert.equal(live.status, 'paused');
  assert.equal(live.minutesLeft, 107);
  assert.equal(live.reason, 'human_reply');

  const lapsed = describeBotState(
    { bot_paused_until: '2026-07-29T11:00:00.000Z' },
    { aiResponderEnabled: true },
    now
  );
  assert.equal(lapsed.status, 'active');
});

test('describeBotState separates a customer opt-out from a CRM mute', () => {
  const byCustomer = describeBotState({ bot_opted_out: true }, { aiResponderEnabled: true });
  assert.equal(byCustomer.status, 'opted_out');
  assert.equal(byCustomer.source, 'customer');

  const byStaff = describeBotState(
    { bot_opted_out: true, bot_opt_out_source: 'crm' },
    { aiResponderEnabled: true }
  );
  assert.equal(byStaff.source, 'crm');
});

test('an opt-out outranks a still-running pause', () => {
  const state = describeBotState(
    {
      bot_opted_out: true,
      bot_paused_until: new Date(Date.now() + 60_000).toISOString(),
    },
    { aiResponderEnabled: true }
  );
  assert.equal(state.status, 'opted_out');
});

test('decideBotGate: disabled / opted out / handoff / outside hours', () => {
  const base = mergeBotSettings({
    aiResponderEnabled: true,
    aiActiveHoursEnabled: false,
  });
  assert.equal(decideBotGate({ ...base, aiResponderEnabled: false }, {}, [], 'שלום').action, 'silence');
  assert.equal(decideBotGate({ ...base, aiResponderEnabled: false }, {}, [], 'עצור').action, 'silence');
  assert.equal(decideBotGate({ ...base, aiResponderEnabled: false }, {}, [], 'רוצה נציג').action, 'silence');
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
