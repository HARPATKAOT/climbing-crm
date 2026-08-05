import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipReply,
  textMatchesKeywords,
  textMatchesStandaloneKeywords,
  normalizeMenuChoice,
  audienceAllows,
  isBotPaused,
  isOptedOut,
  describeBotState,
  decideBotGate,
  parseAiReply,
  resolveUnsureReply,
  recentlyAskedClarify,
  isClarifyReplyText,
  classifyAudience,
  mergeBotSettings,
  applyBusinessBrand,
  isStaffPhone,
  isHumanOutboundLog,
  shouldDeferToHumanStaff,
  withBotMark,
  wantsExplicitHumanStaff,
  normalizeHistoryLimit,
  customerNameParts,
  hasCustomerFullName,
  customerNameWords,
  parseCustomerFullName,
} from './whatsappBot.js';
import { isBotEnabled, shouldAiAutoReply } from './whatsappSchedule.js';
import { db } from './db.js';

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
  assert.equal(textMatchesKeywords('אפשר לדבר עם נציג?', 'אדם,נציג,תלונה'), true);
  assert.equal(textMatchesKeywords('עצור בבקשה', 'עצור,הסר,stop'), true);
  assert.equal(textMatchesKeywords('שלום', 'עצור,הסר'), false);
  assert.equal(textMatchesStandaloneKeywords('בבקשה הסר אותי', 'עצור,הסר,stop'), true);
  assert.equal(textMatchesStandaloneKeywords('מה זה טופס הסרת אחריות?', 'עצור,הסר,stop'), false);
});

test('customer identity requires first and family name, and accepts only name words', () => {
  assert.equal(hasCustomerFullName({ name: 'לקוח וואטסאפ' }), false);
  assert.equal(hasCustomerFullName({ name: 'דנה' }), false);
  assert.equal(hasCustomerFullName({ name: 'דנה לוי' }), true);
  assert.equal(hasCustomerFullName({ name: 'דנה', lastName: 'לוי' }), true);
  assert.deepEqual(
    customerNameParts({ name: 'דנה לוי כהן' }),
    { firstName: 'דנה', lastName: 'לוי כהן', complete: true }
  );
  assert.deepEqual(parseCustomerFullName('קוראים לי דנה לוי'), {
    firstName: 'דנה',
    lastName: 'לוי',
  });
  assert.deepEqual(customerNameWords('דנה'), ['דנה']);
  assert.equal(parseCustomerFullName('כמה עולה החוג'), null);
  assert.equal(parseCustomerFullName('דנה'), null);
});

test('participation-form wording never opts the customer out', () => {
  const settings = mergeBotSettings({ aiResponderEnabled: true });
  const result = decideBotGate(settings, {}, [], 'מה זה טופס הסרת אחריות?', { isSimulator: true });
  assert.equal(result.action, 'reply');
});

test('history limit zero is a real off switch', () => {
  assert.equal(normalizeHistoryLimit(0, 8), 0);
  assert.equal(normalizeHistoryLimit('0', 8), 0);
  assert.equal(normalizeHistoryLimit(50, 8), 30);
  assert.equal(normalizeHistoryLimit('', 8), 8);
});

test('normalizeMenuChoice maps numbers and titles', () => {
  assert.equal(normalizeMenuChoice('1'), '1');
  assert.equal(normalizeMenuChoice('3'), '3');
  assert.equal(normalizeMenuChoice('4'), '4');
  assert.equal(normalizeMenuChoice('הצהרת בריאות'), 'health');
  assert.equal(normalizeMenuChoice('לדבר עם צוות'), '3');
  assert.equal(normalizeMenuChoice('כמה מדריכים יש לכם בצוות ?'), null);
  assert.equal(normalizeMenuChoice('אירועים וטיולים'), '4');
  assert.equal(normalizeMenuChoice('חוגים ומחירים'), '1');
  // "יש טיול בקרוב?" is an events question, not a classes one
  assert.equal(normalizeMenuChoice('יש טיול בקרוב?'), '4');
});

test('known parent greeting uses first name only', async () => {
  const {
    isIdentifiedParent,
    parentFirstName,
    knownParentGreeting,
    isLowIntentGreeting,
    resolveIdentifiedParentFallback,
    extractGeminiResponseText,
    buildGeminiChatContents,
  } = await import('./whatsappBot.js');
  assert.equal(isIdentifiedParent({ name: 'דלק איל' }), true);
  assert.equal(isIdentifiedParent({ name: 'לקוח וואטסאפ' }), false);
  assert.equal(parentFirstName({ name: 'דלק איל' }), 'דלק');
  assert.match(knownParentGreeting({ name: 'דלק איל' }), /בסדר גמור/);
  assert.match(knownParentGreeting({ name: 'דלק איל' }), /מה נשמע דלק/);
  assert.doesNotMatch(knownParentGreeting({ name: 'דלק איל' }), /איל/);
  assert.equal(isLowIntentGreeting('מה קורה ?'), true);
  assert.equal(isLowIntentGreeting('היי, מה קורה ?'), true);
  assert.equal(isLowIntentGreeting('היי מה נשמע'), true);
  assert.equal(isLowIntentGreeting('שלום!'), true);
  assert.equal(isLowIntentGreeting('יש מקום בחוג?'), false);

  const greetFallback = resolveIdentifiedParentFallback(
    { name: 'דלק איל' },
    'היי מה נשמע',
  );
  assert.match(greetFallback.text, /מה נשמע דלק/);

  const chatFallback = resolveIdentifiedParentFallback(
    { name: 'דלק איל' },
    'אתה עונה ממש כמו בוט אמיתי',
  );
  assert.doesNotMatch(chatFallback.text, /מה נשמע דלק/);
  assert.match(chatFallback.text, /לא הבנתי|לנסח|צוות/);

  assert.equal(
    extractGeminiResponseText({
      candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }, { text: ' תשובה ' }] } }],
    }),
    'תשובה',
  );

  const contents = buildGeminiChatContents(
    [
      { role: 'user', content: 'היי' },
      { role: 'assistant', content: 'בסדר גמור מה נשמע דלק?' },
      { role: 'user', content: 'אתה עונה כמו בוט' },
    ],
    'אתה עונה כמו בוט',
  );
  assert.equal(contents.length, 3);
  assert.equal(contents[0].role, 'user');
  assert.equal(contents[2].parts[0].text, 'אתה עונה כמו בוט');
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

test('every bot reply is marked, and the mark never stacks', () => {
  // The climber is the wall's own mark, and it opens the reply exactly once.
  assert.equal(withBotMark('היי דלק!'), '🧗 היי דלק!');
  assert.equal(withBotMark('שעות:\nשני 16:30'), '🧗 שעות:\nשני 16:30');
  // sendBotReply and the caller can both pass through the same text.
  assert.equal(withBotMark('🧗 היי דלק!'), '🧗 היי דלק!');
  assert.equal(withBotMark('  היי  '), '🧗 היי');
  // Nothing to mark stays nothing, so an empty reply is still not sent.
  assert.equal(withBotMark(''), '');
  assert.equal(withBotMark(null), '');
});

test('a staff message stops holding the thread once the pause would have ended', () => {
  // The log-based check exists because a timed pause is lost on restart — it
  // rebuilds that pause from the message log. It was rebuilding it without the
  // clock, so one "היי" from a staff member silenced the bot for that customer
  // for good: thirty-six hours later a parent asked about a class for their
  // four-year-old and got nothing back.
  const phone = '972500000001';
  const rows = [];
  const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

  const original = db.get;
  db.get = (table) => (table === 'whatsapp_logs' ? rows : original.call(db, table));
  try {
    rows.length = 0;
    rows.push({ phone, channel: 'whatsapp', direction: 'outbound', source: 'crm', created_at: at(30) });
    assert.equal(shouldDeferToHumanStaff(phone, { withinMinutes: 120 }), true, 'recent staff reply holds');

    rows.length = 0;
    rows.push({ phone, channel: 'whatsapp', direction: 'outbound', source: 'crm', created_at: at(2160) });
    assert.equal(shouldDeferToHumanStaff(phone, { withinMinutes: 120 }), false, '36 hours old must not hold');

    // No window given keeps the old behaviour, for any caller that omits it.
    assert.equal(shouldDeferToHumanStaff(phone, {}), true);

    // The bot's own reply never holds the thread, however recent.
    rows.length = 0;
    rows.push({ phone, channel: 'whatsapp', direction: 'outbound', source: 'ai', is_ai: true, created_at: at(1) });
    assert.equal(shouldDeferToHumanStaff(phone, { withinMinutes: 120 }), false);
  } finally {
    db.get = original;
  }
});

test('human outbound logs are detected for staff-thread deferral', () => {
  assert.equal(isHumanOutboundLog({ direction: 'outbound', is_ai: false, source: 'crm' }), true);
  assert.equal(isHumanOutboundLog({ direction: 'outbound', is_ai: false, source: 'phone' }), true);
  assert.equal(isHumanOutboundLog({ direction: 'outbound', is_ai: true, source: 'ai' }), false);
  assert.equal(isHumanOutboundLog({ direction: 'outbound', is_ai: false, source: 'bot_control' }), false);
  assert.equal(isHumanOutboundLog({ direction: 'outbound', is_ai: false, source: 'otp' }), false);
  assert.equal(isHumanOutboundLog({
    direction: 'outbound',
    is_ai: false,
    source: 'crm',
    template_name: 'phone_verification_code',
  }), false);
  assert.equal(isHumanOutboundLog({
    direction: 'outbound',
    is_ai: false,
    source: 'crm',
    message: '‏*041663*‏ הוא קוד האימות שלך. מטעמי אבטחה, אין לשתף את הקוד הזה.',
  }), false);
  assert.equal(isHumanOutboundLog({ direction: 'inbound', is_ai: false, source: 'customer' }), false);
  // An automation's confirmation went out under the CRM's name and silenced the
  // bot on the customer's next message. Both the tag and the template name have
  // to keep that from happening.
  assert.equal(isHumanOutboundLog({
    direction: 'outbound',
    is_ai: false,
    source: 'automation',
    template_name: 'anything_v1',
  }), false);
  assert.equal(isHumanOutboundLog({
    direction: 'outbound',
    is_ai: false,
    source: 'crm',
    template_name: 'onboarding_completed_v1',
  }), false);
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
  assert.equal(decideBotGate(base, {}, [], '3').action, 'handoff');
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

test('parseAiReply detects UNSURE and HANDOFF prefixes', () => {
  const parsed = parseAiReply('UNSURE\nלא בטוח לגבי המחיר', { aiUnsureReply: 'מעביר לצוות', aiMaxReplyChars: 700 });
  assert.equal(parsed.unsure, true);
  assert.match(parsed.text, /לא בטוח|מעביר|לא הבנתי/);

  const handoff = parseAiReply('HANDOFF\nוואי, אין לי את הפרט — מעביר לצוות 🙂', { aiMaxReplyChars: 700 });
  assert.equal(handoff.handoff, true);
  assert.equal(handoff.unsure, false);
  assert.match(handoff.text, /אין לי את הפרט/);
});

test('staff-in-team questions do not hard-handoff via keywords', () => {
  const settings = mergeBotSettings({ aiResponderEnabled: true });
  assert.equal(decideBotGate(settings, { status: 'active' }, [], 'כמה מדריכים יש לכם בצוות ?').action, 'reply');
  assert.equal(decideBotGate(settings, { status: 'active' }, [], 'רוצה נציג').action, 'handoff');
});

test('first unsure asks for clarification; second gibberish hands off', () => {
  const phone = '972500000099';
  const clarify = 'לא הבנתי 🙏\nיכולים להסביר?';
  const handoff = 'מעביר לצוות עכשיו';
  const settings = {
    aiEscalateWhenUnsure: true,
    aiClarifyReply: clarify,
    aiUnsureReply: handoff,
  };

  const previous = (db.get('whatsapp_logs') || []).filter((l) => l.phone !== phone);
  db.set('whatsapp_logs', [
    ...previous,
    {
      id: 't-in-1',
      phone,
      channel: 'whatsapp',
      direction: 'inbound',
      message: 'vhh',
      created_at: '2026-08-01T10:00:00.000Z',
    },
  ]);

  const first = resolveUnsureReply(phone, settings, { incomingText: 'vhh' });
  assert.equal(first.handoff, false);
  assert.equal(first.clarify, true);
  assert.match(first.text, /לא הבנתי/);

  db.set('whatsapp_logs', [
    ...previous,
    {
      id: 't-bot-1',
      phone,
      channel: 'whatsapp',
      direction: 'outbound',
      message: clarify,
      is_ai: true,
      source: 'ai',
      created_at: '2026-08-01T10:00:01.000Z',
    },
    {
      id: 't-in-2',
      phone,
      channel: 'whatsapp',
      direction: 'inbound',
      message: 'asdf',
      created_at: '2026-08-01T10:00:30.000Z',
    },
  ]);

  assert.equal(recentlyAskedClarify(phone, settings), true);
  const second = resolveUnsureReply(phone, settings, { incomingText: 'asdf' });
  assert.equal(second.handoff, true);
  assert.equal(second.text, handoff);

  // A real question after clarify must NOT escalate just because the model was unsure.
  const realQ = resolveUnsureReply(phone, settings, { incomingText: 'זה קיר טיפוס ?' });
  assert.equal(realQ.handoff, false);
  assert.equal(realQ.clarify, true);

  db.set('whatsapp_logs', previous);
});

test('isClarifyReplyText recognizes the default ask', () => {
  assert.equal(isClarifyReplyText('לא הבנתי 🙏\nיכולים להסביר?'), true);
  assert.equal(isClarifyReplyText('כן, יש מקום ביום ג׳'), false);
});

test('business identity and low-signal helpers', async () => {
  const {
    asksAboutBusinessIdentity,
    formatBusinessIdentityReply,
    looksLikeLowSignalMessage,
  } = await import('./whatsappBot.js');
  assert.equal(asksAboutBusinessIdentity('זה קיר טיפוס ?'), true);
  assert.equal(asksAboutBusinessIdentity('יש מקום בכיתה ב׳?'), false);
  assert.match(formatBusinessIdentityReply({ brandName: 'קיר בועז' }), /קיר הטיפוס קיר בועז/);
  assert.equal(looksLikeLowSignalMessage('לחנלח'), true);
  assert.equal(looksLikeLowSignalMessage('vhh'), true);
  assert.equal(looksLikeLowSignalMessage('זה קיר טיפוס ?'), false);
});

test('a named card hands the model a first name to greet with', async () => {
  const {
    buildParentCardContext,
    BOT_BOUNDS_RULES,
    greetingFirstName,
    knownParentGreeting,
  } = await import('./whatsappBot.js');
  const named = buildParentCardContext({ name: 'דלק כהן', phone: '0500000000' }, []);
  assert.match(named, /שם פרטי לפנייה: דלק/);
  assert.doesNotMatch(named, /שם פרטי לפנייה: דלק כהן/);

  const placeholder = buildParentCardContext({ name: 'לקוח וואטסאפ', phone: '0500000000' }, []);
  assert.doesNotMatch(placeholder, /שם פרטי לפנייה/);

  assert.match(BOT_BOUNDS_RULES, /שם פרטי לפנייה/);

  // A trainee writing from their own number must be greeted as themselves —
  // not as the parent whose card the thread is filed under (Omer / Mirit).
  const parent = { name: 'מירית בזר', phone: '972544402660' };
  const speaker = { id: 's1', name: 'עומר בזר', phone: '972539304898' };
  assert.equal(greetingFirstName(parent, speaker), 'עומר');
  assert.equal(greetingFirstName(parent, null), 'מירית');
  const fromChild = buildParentCardContext(parent, [speaker], { speaker });
  assert.match(fromChild, /שם פרטי לפנייה: עומר/);
  assert.doesNotMatch(fromChild, /שם פרטי לפנייה: מירית/);
  assert.match(fromChild, /הכותב הוא המתאמן עומר בזר/);
  assert.match(knownParentGreeting(parent, speaker), /מה נשמע עומר/);
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

test('a bare «אדם» is a noun, not a request for a person', () => {
  // "יש אדם שאחראי על החוג?" was answered with a canned handoff, because the
  // owner's keyword list carries «אדם» and it matched anywhere in a sentence.
  const settings = {
    // The live list, verbatim.
    aiHandoffKeywords: 'אדם,נציג,תלונה,מנהל,דחוף,לדבר עם,ביטול,לבטל,החזר,זיכוי,חשבונית,פציעה,נפצע,כאב',
  };
  assert.equal(wantsExplicitHumanStaff('יש אדם שאחראי על החוג?', settings), false);
  assert.equal(wantsExplicitHumanStaff('בן אדם אחראי שם?', settings), false);

  // Everything that really is a request still reaches the team.
  assert.equal(wantsExplicitHumanStaff('אפשר לדבר עם אדם?', settings), true);
  assert.equal(wantsExplicitHumanStaff('אפשר נציג בבקשה', settings), true);
  assert.equal(wantsExplicitHumanStaff('נציג', settings), true);
  assert.equal(wantsExplicitHumanStaff('אני רוצה החזר', settings), true);
  assert.equal(wantsExplicitHumanStaff('הילד נפצע באימון', settings), true);
  assert.equal(wantsExplicitHumanStaff('3', settings), true);
});
