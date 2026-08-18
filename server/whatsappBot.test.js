import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clipReply,
  textMatchesKeywords,
  textMatchesStandaloneKeywords,
  audienceAllows,
  isBotPaused,
  isOptedOut,
  describeBotState,
  decideBotGate,
  classifyAudience,
  mergeBotSettings,
  applyBusinessBrand,
  isStaffPhone,
  centrePhones,
  centreContactName,
  isCentrePhone,
  isHumanOutboundLog,
  shouldDeferToHumanStaff,
  withBotMark,
  botReplyText,
  withStaffMark,
  wantsExplicitHumanStaff,
  normalizeHistoryLimit,
  customerNameParts,
  hasCustomerFullName,
  customerNameWords,
  parseCustomerFullName,
  isClosingAcknowledgement,
  hasOpenBotHandoff,
  FREE_CLIMBING_POLICY,
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

test('free climbing keeps the adult rules and states the minimum age', () => {
  assert.match(FREE_CLIMBING_POLICY, /הכניסה מגיל 6 ומעלה/);
  assert.match(FREE_CLIMBING_POLICY, /מגיל 11 ניתן להגיע ללא מבוגר/);
  assert.match(FREE_CLIMBING_POLICY, /בגיל 6–10 ניתן להגיע עם מבוגר/);
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

test('a centre number may carry the name of the person who writes from it', () => {
  // The secretary was asked "מה השם הפרטי שלך?" by a bot that already had her
  // number on a list. The name sits beside the number, and a list of bare
  // numbers keeps working exactly as before.
  const named = { aiCentrePhones: '0526688649 כרמית, 0501234567' };
  assert.deepEqual(centrePhones(named), ['0526688649', '0501234567']);
  assert.equal(isCentrePhone(named, '972526688649'), true);
  assert.equal(centreContactName(named, '972526688649'), 'כרמית');
  assert.equal(centreContactName(named, '972501234567'), '');
  assert.equal(centreContactName({ aiCentrePhones: '' }, '972526688649'), '');

  // The live value was pasted into a right-to-left field, so it arrived
  // wrapped in invisible direction marks. They used to be harmless; now they
  // would have swallowed the name.
  const pasted = { aiCentrePhones: '⁦+972526688649⁩ כרמית' };
  assert.deepEqual(centrePhones(pasted), ['+972526688649']);
  assert.equal(centreContactName(pasted, '972526688649'), 'כרמית');
});

test('every bot reply is marked, and the mark never stacks', () => {
  // The robot says what it is; the climber is the wall's own mark.
  assert.equal(withBotMark('היי דלק!'), '🤖🧗🏾 היי דלק!');
  assert.equal(withBotMark('שעות:\nשני 16:30'), '🤖🧗🏾 שעות:\nשני 16:30');
  // sendBotReply and the caller can both pass through the same text.
  assert.equal(withBotMark('🤖🧗🏾 היי דלק!'), '🤖🧗🏾 היי דלק!');
  // A reply written before the mark grew must not end up wearing both.
  assert.equal(withBotMark('🧗 היי דלק!'), '🧗 היי דלק!');
  assert.equal(withBotMark('  היי  '), '🤖🧗🏾 היי');
  // Nothing to mark stays nothing, so an empty reply is still not sent.
  assert.equal(withBotMark(''), '');
  assert.equal(withBotMark(null), '');
});

test('the two questions that open a conversation carry no mark', () => {
  // Someone who asked "מאיזה גיל אפשר לטפס?" was answered with a robot icon, a
  // climber, a smiley and a request for their "first name". People stop replying
  // once they see software, and these are the two answers we cannot afford to
  // lose — so the badge comes off here, the wording is what a person would type,
  // and both go back to normal for everything after.
  assert.equal(botReplyText('היי, איך קוראים לך?', { unmarked: true }), 'היי, איך קוראים לך?');
  assert.equal(botReplyText('נעים מאוד רלי, ומה שם המשפחה?', { unmarked: true }), 'נעים מאוד רלי, ומה שם המשפחה?');
  // Everything else is the bot, and says so.
  assert.equal(botReplyText('היי דלק!'), '🤖🧗🏾 היי דלק!');
  assert.equal(botReplyText('היי דלק!', { unmarked: false }), '🤖🧗🏾 היי דלק!');
  assert.equal(botReplyText('', { unmarked: true }), '');
  assert.equal(botReplyText(null, { unmarked: true }), '');
});

test('a bot reply is never also signed as a person', () => {
  assert.equal(withStaffMark('🤖🧗🏾 היי דלק!'), '🤖🧗🏾 היי דלק!');
  assert.equal(withStaffMark('🧗 היי דלק!'), '🧗 היי דלק!');
  assert.equal(withStaffMark('היי דלק!'), '👤 היי דלק!');
});

test('a standalone thank-you closes the exchange without another bot turn', () => {
  for (const text of ['תודה', 'תודה רבה!', 'מעולה תודה 🙏', 'סבבה תודה', 'בסדר, תודה רבה', 'אוקיי תודה', 'נעשה', 'אעשה', 'נטפל', 'נבדוק']) {
    assert.equal(isClosingAcknowledgement(text), true, text);
  }
  for (const text of ['תודה, באיזה יום האימון?', 'כן תודה', 'תודה אבל לא קיבלתי קישור']) {
    assert.equal(isClosingAcknowledgement(text), false, text);
  }
});

test('an open handoff stays open until a human replies', () => {
  const original = db.get;
  const handedAt = new Date(Date.now() - 60_000).toISOString();
  const parent = { phone: '972500000099', bot_handoff_at: handedAt };
  let rows = [{
    direction: 'outbound', phone: parent.phone, is_ai: true, source: 'bot_control',
    created_at: new Date(Date.now() - 50_000).toISOString(),
  }];
  db.get = (table) => (table === 'messages' ? rows : original.call(db, table));
  try {
    assert.equal(hasOpenBotHandoff(parent), true);
    rows = [...rows, {
      direction: 'outbound', phone: parent.phone, is_ai: false, source: 'phone',
      created_at: new Date().toISOString(),
    }];
    assert.equal(hasOpenBotHandoff(parent), false);
  } finally {
    db.get = original;
  }
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
  // A bare «3» used to be the menu's "talk to staff". With no menu it is just a
  // number, and the model is the one that should read it in context.
  assert.equal(decideBotGate(base, {}, [], '3').action, 'reply');
  assert.equal(decideBotGate(base, {}, [], 'עצור').action, 'mailing_preferences');

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

test('staff-in-team questions do not hard-handoff via keywords', () => {
  const settings = mergeBotSettings({ aiResponderEnabled: true });
  assert.equal(decideBotGate(settings, { status: 'active' }, [], 'כמה מדריכים יש לכם בצוות ?').action, 'reply');
  assert.equal(decideBotGate(settings, { status: 'active' }, [], 'רוצה נציג').action, 'handoff');
});

test('a named card hands the model a first name to greet with', async () => {
  const {
    buildParentCardContext,
    BOT_BOUNDS_RULES,
    greetingFirstName,
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
  // «3» was a menu row. The menu is gone, and a lone digit is not a request.
  assert.equal(wantsExplicitHumanStaff('3', settings), false);
});
