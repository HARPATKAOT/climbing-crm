import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runCustomerToolTurn,
  historyToContents,
  whatsappifyMarkdown,
  unknownUrlsInReply,
  unbackedReplyClaims,
  CUSTOMER_TOOL_RULES,
  explicitGroupSuitabilityHandoff,
  confirmsLastBotQuestion,
  separateMultiChildGradeQuestion,
} from './botToolTurn.js';
import {
  CUSTOMER_TOOL_DECLARATIONS,
  groupScheduleFields,
  isRegisteredTrainee,
  shouldHideYouthPrices,
  groupSupportsFrequency,
  botVisibleStudentStatus,
  buildCustomerTools,
} from './botTools.js';
import { statusAfterHealthSignature } from './crmWaiverService.js';
import { db } from './db.js';

/** A model stand-in: replies with whatever script the test hands it. */
function scriptedModel(steps) {
  let i = 0;
  return async () => {
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return { content: step, error: '' };
  };
}

const textReply = (text) => ({ role: 'model', parts: [{ text }] });
const toolCall = (name, args = {}) => ({ role: 'model', parts: [{ functionCall: { name, args } }] });

test('a plain answer comes back as the reply', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'מתי אתם פתוחים?',
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('אנחנו פתוחים היום 16:00–22:00')]),
  });
  assert.equal(turn.text, 'אנחנו פתוחים היום 16:00–22:00');
  assert.equal(turn.handoff, false);
  assert.equal(turn.reason, 'ok');
});

test('HANDOFF on the first line marks the turn for the team', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'אני רוצה החזר',
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('HANDOFF\nמעביר את זה לצוות, הם יחזרו אליך.')]),
  });
  assert.equal(turn.handoff, true);
  assert.equal(turn.text, 'מעביר את זה לצוות, הם יחזרו אליך.');
});

test('a group-suitability handoff says plainly that the bot does not know', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: "היי, לאיזו קבוצה רועי מתאים שנה הבאה בכיתה ה'?",
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('HANDOFF\nקיבלנו 🙏 מעביר לצוות שלנו — מישהו יחזור אליכם בהקדם.')]),
  });

  assert.equal(turn.handoff, true);
  assert.equal(
    turn.text,
    'אני לא יודע לאיזו קבוצה רועי מתאים, ולכן אני מעביר את השאלה לצוות שלנו.\n'
      + 'מישהו מהצוות יחזור אליכם בהקדם.'
  );
});

test('the transparent wording is limited to group suitability questions', () => {
  assert.equal(
    explicitGroupSuitabilityHandoff('אני רוצה החזר', 'מעביר את בקשת ההחזר לצוות.'),
    'מעביר את בקשת ההחזר לצוות.'
  );
});

test('an UNSURE prefix is stripped and is not a handoff', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'אשדגכ',
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('UNSURE\nלא הבנתי — אפשר להסביר?')]),
  });
  assert.equal(turn.handoff, false);
  assert.equal(turn.unsure, true);
  assert.equal(turn.text, 'לא הבנתי — אפשר להסביר?');
});

test('a tool call is answered from the CRM and then phrased by the model', async () => {
  const calls = [];
  const model = scriptedModel([toolCall('listClasses', { grade: 'ג' }), textReply('יש מקום ביום ג׳ 15:00')]);
  const turn = await runCustomerToolTurn({
    incomingText: 'יש מקום לכיתה ג?',
    apiKey: 'test-key',
    callModel: async (args) => {
      calls.push(args);
      return model(args);
    },
  });
  assert.deepEqual(turn.toolsUsed, ['listClasses']);
  assert.equal(turn.text, 'יש מקום ביום ג׳ 15:00');
  // The tool result must be sent back to the model, not answered locally.
  const secondCall = calls[1];
  const parts = secondCall.contents[secondCall.contents.length - 1].parts;
  assert.equal(parts[0].functionResponse.name, 'listClasses');
});

test('an unknown tool name does not throw the turn away', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'מה קורה',
    apiKey: 'test-key',
    callModel: scriptedModel([toolCall('deleteEverything'), textReply('הכול טוב 🙂')]),
  });
  assert.equal(turn.text, 'הכול טוב 🙂');
  assert.deepEqual(turn.toolsUsed, []);
});

test('a model that never answers ends the turn empty so the caller can fall back', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'שלום',
    apiKey: 'test-key',
    maxSteps: 2,
    callModel: scriptedModel([toolCall('getOpeningHours')]),
  });
  assert.equal(turn.text, '');
  assert.equal(turn.reason, 'max_steps');
});

test('no model key means no reply, and the caller falls back', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'שלום',
    apiKey: '',
    callModel: async () => ({ content: null, error: 'no_api_key' }),
  });
  assert.equal(turn.text, '');
  assert.equal(turn.reason, 'no_api_key');
});

test('WhatsApp bolds with one asterisk, so Markdown is converted', () => {
  assert.equal(whatsappifyMarkdown('**מחירים:**'), '*מחירים:*');
  assert.equal(whatsappifyMarkdown('## כותרת'), 'כותרת');
  assert.equal(whatsappifyMarkdown('- שורה'), '• שורה');
  assert.equal(whatsappifyMarkdown('* יום ראשון 20:10'), '• יום ראשון 20:10');
  // Real bold has no space after the asterisk and must survive.
  assert.equal(whatsappifyMarkdown('*מחירים*'), '*מחירים*');
  // A Markdown link is unusable in WhatsApp — the address must stand alone.
  assert.equal(
    whatsappifyMarkdown('[קישור להרשמה](https://example.com/a?b=1)'),
    'קישור להרשמה:\nhttps://example.com/a?b=1'
  );
});

test('history rows become model/user turns', () => {
  const contents = historyToContents([
    { role: 'user', content: 'היי' },
    { role: 'assistant', content: 'היי דלק!' },
    { role: 'user', content: '' },
  ]);
  assert.deepEqual(contents.map((c) => c.role), ['user', 'model']);
});

test('the current inbound message is not appended twice when history already contains it', async () => {
  let received;
  const turn = await runCustomerToolTurn({
    history: [{ role: 'user', parts: [{ text: 'כמה עולה חוג?' }] }],
    incomingText: 'כמה עולה חוג?',
    apiKey: 'test-key',
    callModel: async (args) => {
      received = args.contents;
      return { content: textReply('לאיזו כיתה?'), error: '' };
    },
  });
  assert.equal(turn.text, 'לאיזו כיתה?');
  assert.equal(received.length, 1);
  assert.equal(received[0].parts[0].text, 'כמה עולה חוג?');
});

test('model failure asks what signup the customer means instead of handing off', async () => {
  const previousStudents = db.get('students');
  db.set('students', [{ id: 'karni', parentId: 'adi', name: 'קרני אלימלך', status: 'lead_new' }]);
  try {
    const turn = await runCustomerToolTurn({
      parent: { id: 'adi', name: 'עדי אלימלך' },
      incomingText: 'היי איפה נרשמים. לא ברור',
      apiKey: 'test-key',
      callModel: async () => ({ content: null, error: 'temporary model error' }),
    });
    assert.equal(turn.handoff, false);
    assert.equal(turn.reason, 'deterministic_signup_clarification');
    assert.equal(turn.text, 'בשמחה — לאיזו קבוצה תרצו לרשום את קרני?');
  } finally {
    db.set('students', previousStudents || []);
  }
});

test('model failure lists real class days once the customer supplied a grade', async () => {
  const previousGroups = db.get('groups');
  const previousStudents = db.get('students');
  db.set('groups', [
    { id: 'gd-mon', ageCategory: 'ג׳-ד׳', day: 1, time: '16:00', maxSlots: 10 },
    { id: 'gd-thu', ageCategory: 'ג׳-ד׳', day: 4, time: '17:30', maxSlots: 10 },
  ]);
  db.set('students', [{ id: 'karni', parentId: 'adi', name: 'קרני אלימלך', status: 'lead_new' }]);
  try {
    const turn = await runCustomerToolTurn({
      parent: { id: 'adi', name: 'עדי אלימלך' },
      history: [{
        role: 'user',
        parts: [{ text: 'נכון. אשמח שתרשום את קרני, אבל לא הבנתי מה האופציות מבחינת ימים' }],
      }],
      incomingText: 'היא תהיה בכיתה ד׳ כן',
      apiKey: 'test-key',
      callModel: async () => ({ content: null, error: 'temporary model error' }),
    });
    assert.equal(turn.handoff, false);
    assert.equal(turn.reason, 'deterministic_group_options');
    assert.match(turn.text, /האפשרויות לכיתה ד׳ עבור קרני/);
    assert.match(turn.text, /יום ב׳ בשעה 16:00/);
    assert.match(turn.text, /יום ה׳ בשעה 17:30/);
    assert.deepEqual(turn.toolsUsed, ['listClasses', 'getFamilyCard']);
  } finally {
    db.set('groups', previousGroups || []);
    db.set('students', previousStudents || []);
  }
});

test('a shared grade question is rewritten as one fact per child', () => {
  assert.equal(
    separateMultiChildGradeQuestion('באיזו כיתה תום ואביב לומדים כיום?'),
    'מה הכיתה של תום כיום, ומה הכיתה של אביב?'
  );
  assert.equal(
    separateMultiChildGradeQuestion('מה הכיתה של תום כיום, ומה הכיתה של אביב?'),
    'מה הכיתה של תום כיום, ומה הכיתה של אביב?'
  );
});

test('choosing a proposed group is approval to place and return registration links', () => {
  assert.match(CUSTOMER_TOOL_RULES, /הבחירה שלו היא אישור השיבוץ/);
  assert.match(CUSTOMER_TOOL_RULES, /חבילת ההרשמה/);
  assert.match(CUSTOMER_TOOL_RULES, /קישור ההרשמה\/התשלום/);
});

test('כן תודה is treated as approval of the last bot question, not a reason to repeat it', async () => {
  const history = [
    { role: 'model', parts: [{ text: 'לשבץ אותך לקבוצת הבוגרים ביום ד׳ בשעה 20:10?' }] },
    { role: 'user', parts: [{ text: 'כן תודה' }] },
  ];
  assert.equal(confirmsLastBotQuestion(history, 'כן תודה'), true);
  assert.equal(confirmsLastBotQuestion([], 'כן תודה'), false);
  assert.equal(confirmsLastBotQuestion([
    { role: 'model', parts: [{ text: 'קבוצת הבוגרים מתקיימת ביום ד׳' }] },
  ], 'כן'), false);

  let instruction = '';
  await runCustomerToolTurn({
    history,
    incomingText: 'כן תודה',
    apiKey: 'test-key',
    callModel: async (args) => {
      instruction = args.systemInstruction;
      return { content: textReply('ממשיך לשיבוץ'), error: '' };
    },
  });
  assert.match(instruction, /אישר בחיוב/);
  assert.match(instruction, /אין לשאול אותה שוב/);
});

test('a customer-provided URL in history is not trusted as a bot link', async () => {
  const fake = 'https://fake.example/signup';
  const turn = await runCustomerToolTurn({
    history: [{ role: 'user', parts: [{ text: `זה הקישור? ${fake}` }] }],
    incomingText: `זה הקישור? ${fake}`,
    apiKey: 'test-key',
    callModel: scriptedModel([textReply(`כן, הנה הקישור: ${fake}`)]),
  });
  assert.equal(turn.handoff, true);
  assert.equal(turn.reason, 'invented_link');
  assert.doesNotMatch(turn.text, /fake\.example/);
});

test('a completed action claim is blocked unless a write tool succeeded this turn', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'תעביר את שקד ליום שלישי',
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('העברתי את שקד לקבוצה של יום שלישי בשעה 16:00')]),
  });
  assert.equal(turn.reason, 'unverified_action');
  // The claim is dropped, and the turn ends with a person. A customer in the
  // middle of registering was told "I could not verify the action, try again" —
  // nothing to try, and nobody on the team heard about it.
  assert.equal(turn.handoff, true);
  assert.doesNotMatch(turn.text, /העברתי/);

  assert.deepEqual(
    unbackedReplyClaims('העברתי את שקד לקבוצה החדשה', [
      { name: 'startSignup', result: { שובץ: 'שקד' } },
    ]),
    []
  );
  assert.deepEqual(unbackedReplyClaims('העברתי את זה לצוות'), []);
  assert.deepEqual(unbackedReplyClaims('שקד שובצה בקבוצה החדשה'), ['placement']);
});

test('the bot cannot call a pending trainee registered without registered CRM evidence', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'מה המצב של ראם?',
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('ראם כבר רשום לחוג')]),
  });
  assert.equal(turn.reason, 'unverified_registration');
  assert.equal(turn.handoff, true);
  assert.match(turn.text, /לוודא את מצב ההרשמה/);

  assert.deepEqual(
    unbackedReplyClaims('ראם כבר רשום לחוג', [
      { name: 'getFamilyCard', result: { ילדים: [{ שם: 'ראם', סטטוס: 'registered' }] } },
    ]),
    []
  );
});

test('grade is requested as a fact rather than offered as a preference', async () => {
  const turn = await runCustomerToolTurn({
    incomingText: 'תאריך הלידה של שקד הוא 4.4.2018',
    apiKey: 'test-key',
    callModel: scriptedModel([textReply('איזה גיל או כיתה תעדיף עבור שקד?')]),
  });
  assert.equal(turn.reason, 'invalid_grade_question');
  assert.equal(turn.text, 'באיזו כיתה הילד/ה לומד/ת כיום?');
});

test('placing, moving and unplacing is locked only once a trainee is registered', () => {
  // The line the owner drew: registration at the מתנ״ס is the team's, and
  // every step before it is the bot's to arrange. An earlier version also
  // locked a booked intro lesson, which sent a perfectly ordinary signup to
  // the team. Both startSignup and cancelSignup gate on this one predicate.
  for (const status of ['lead_new', 'health_signed', 'pending_signup',
    'intro_scheduled', 'intro_paid', 'past_registered', 'waitlist']) {
    assert.equal(isRegisteredTrainee({ status }), false, status);
  }
  for (const status of ['registered', 'active']) {
    assert.equal(isRegisteredTrainee({ status }), true, status);
  }
  assert.equal(isRegisteredTrainee({}), false);
  assert.equal(isRegisteredTrainee(null), false);
});

test('a link the model wrote itself never reaches the customer', () => {
  // The real failure: a signup link for Wednesday's group, rewritten for
  // Sunday's, pointing at a page that does not exist.
  const wednesday = 'https://app.kirboaz.co.il/onboard?interest=%D7%99%D7%95%D7%9D+%D7%93&phone=05';
  const sunday = 'https://app.kirboaz.co.il/onboard?interest=%D7%99%D7%95%D7%9D+%D7%90&phone=05';
  const allowed = new Set([wednesday]);

  assert.deepEqual(unknownUrlsInReply(`הנה הקישור: ${wednesday}`, allowed), []);
  assert.deepEqual(unknownUrlsInReply(`הנה הקישור: ${sunday}`, allowed), [sunday]);
  // Punctuation the sentence added is not part of the address.
  assert.deepEqual(unknownUrlsInReply(`בבקשה ${wednesday}.`, allowed), []);
  assert.deepEqual(unknownUrlsInReply('אין כאן קישור בכלל', allowed), []);
});

test('the tools offered to the model are facts, links and placements — never sends or charges', () => {
  const names = CUSTOMER_TOOL_DECLARATIONS.map((d) => d.name).sort();
  assert.deepEqual(names, [
    'addActivityInterest',
    'cancelSignup',
    'getEquipmentInfo',
    'getEquipmentPaymentLink',
    'getEvents',
    'getFamilyCard',
    'getHealthDeclarations',
    'getOpeningHours',
    'getPrices',
    'getRegistrationPack',
    'getSignupLink',
    'joinWaitlist',
    'listClasses',
    'removeActivityInterest',
    'reportCentreRegistration',
    'scheduleFollowUp',
    'startSignup',
    'updateCustomerDetails',
  ]);
  // Every writing tool must name the child it acts on, so the bot can never
  // place — or unplace — "somebody" from the card.
  for (const name of ['startSignup', 'joinWaitlist', 'cancelSignup']) {
    const decl = CUSTOMER_TOOL_DECLARATIONS.find((d) => d.name === name);
    assert.deepEqual(decl.parameters.required, ['childName']);
  }
  // A tool may hand over a link and undo something the bot itself did, but it
  // may never message anyone, delete a record or take money — those stay with
  // the team. The two reversals are exactly the two soft holds the bot can
  // make: a placement, and an interest in a trip. Both restore the state from
  // before rather than deleting anything.
  assert.equal(names.some((n) => /send|charge|refund/i.test(n)), false);
  assert.deepEqual(
    names.filter((n) => /cancel|remove/i.test(n)),
    ['cancelSignup', 'removeActivityInterest']
  );
  const details = CUSTOMER_TOOL_DECLARATIONS.find((d) => d.name === 'updateCustomerDetails');
  assert.deepEqual(details.parameters.required, ['firstName', 'lastName']);
  assert.deepEqual(Object.keys(details.parameters.properties).sort(), ['firstName', 'lastName']);
  assert.equal(names.includes('saveChildBirthDate'), false);
  assert.match(CUSTOMER_TOOL_RULES, /HANDOFF/);
  assert.match(CUSTOMER_TOOL_RULES, /ימי_אימון[\s\S]*כולם/);
});

test('a twice-weekly squad exposes both training days to the model', () => {
  assert.deepEqual(
    groupScheduleFields({ name: 'נבחרת בוגרת — ב׳+ה׳ 19:10', day: 4 }),
    { יום: 'ב׳+ה׳', ימי_אימון: ['ב׳', 'ה׳'] }
  );
});

test('twice-weekly is offered only with both a configured price and signup link', async () => {
  const valid = {
    id: 'g-valid-twice',
    ageCategory: 'ג׳-ד׳',
    day: 0,
    time: '15:30',
    priceWeek: 290,
    priceTwice: 370,
    signupLinkWeek: 'https://example.com/week',
    signupLinkTwice: 'https://example.com/twice',
  };
  const invalid = {
    id: 'g-invalid-twice',
    ageCategory: 'ג׳-ד׳',
    day: 2,
    time: '16:00',
    priceWeek: 290,
    priceTwice: 370,
    signupLinkWeek: 'https://example.com/week-only',
    signupLinkTwice: '',
  };
  assert.equal(groupSupportsFrequency(valid, 'פעמיים בשבוע'), true);
  assert.equal(groupSupportsFrequency(invalid, 'פעמיים בשבוע'), false);

  const previous = db.get('groups');
  db.set('groups', [valid, invalid]);
  try {
    const tools = buildCustomerTools();
    const classes = await tools.listClasses({ grade: 'ג', frequency: 'פעמיים בשבוע' });
    assert.equal(classes.קבוצות.length, 1);
    assert.equal(classes.קבוצות[0].שעה, '15:30');
    assert.deepEqual(classes.קבוצות[0].תדירויות_אפשריות, ['פעם בשבוע', 'פעמיים בשבוע']);

    const invalidLink = await tools.getSignupLink({
      grade: 'ג',
      day: 2,
      time: '16:00',
      frequency: 'פעמיים בשבוע',
    });
    assert.deepEqual(invalidLink.קישורים, []);

    const validLink = await tools.getSignupLink({
      grade: 'ג',
      day: 0,
      time: '15:30',
      frequency: 'פעמיים בשבוע',
    });
    assert.equal(validLink.קישורים.length, 1);
    assert.equal(validLink.קישורים[0].תדירות, 'פעמיים בשבוע');
    assert.equal(validLink.קישורים[0].קישור_פעם_בשבוע, '');
    assert.match(validLink.קישורים[0].קישור_פעמיים_בשבוע, /\/s\/g-valid-twice\/2$/);
  } finally {
    db.set('groups', previous || []);
  }
});

test('document signing preserves progress and pending without a group is not shown as placed', () => {
  for (const status of ['registered', 'active', 'pending_signup', 'waitlist',
    'intro_scheduled', 'intro_paid', 'past_registered']) {
    assert.equal(statusAfterHealthSignature(status), status);
  }
  assert.equal(statusAfterHealthSignature('lead_new'), 'health_signed');
  assert.equal(statusAfterHealthSignature(''), 'health_signed');

  assert.equal(botVisibleStudentStatus({ status: 'pending_signup' }, null), 'health_signed');
  assert.equal(
    botVisibleStudentStatus({ status: 'pending_signup' }, { id: 'g1' }),
    'pending_signup'
  );
});

test('trainees under 18 do not receive class or equipment prices', async () => {
  const now = new Date('2026-08-04T12:00:00Z');
  assert.equal(shouldHideYouthPrices(null, now), false);
  assert.equal(
    shouldHideYouthPrices({ name: 'עומר', birth_date: '2009-09-17' }, now),
    true
  );
  assert.equal(
    shouldHideYouthPrices({ name: 'דני', birthDate: '2005-01-01' }, now),
    false
  );
  // Unknown age on a trainee speaker — hide rather than guess.
  assert.equal(shouldHideYouthPrices({ name: 'נועם' }, now), true);

  const prev = db.get('pricelist');
  db.set('pricelist', [
    { name: 'כניסה לקיר', price: 70, category: 'כניסה', active: true },
  ]);
  try {
    const tools = buildCustomerTools({
      speaker: { name: 'עומר בזר', birth_date: '2009-09-17' },
    });
    const prices = await tools.getPrices({ grade: 'ג', equipment: true, entry: true });
    assert.ok(prices.כניסה_לקיר);
    assert.equal(prices.חוגים, undefined);
    assert.equal(prices.ציוד, undefined);
    assert.equal(prices.דמי_העשרה, undefined);
    assert.match(prices.הערה, /מתחת לגיל 18/);

    const adultTools = buildCustomerTools({
      speaker: { name: 'דני', birthDate: '2005-01-01' },
    });
    const adultPrices = await adultTools.getPrices({ entry: true, equipment: false });
    assert.ok(adultPrices.כניסה_לקיר);
    assert.equal(adultPrices.הערה, undefined);
  } finally {
    db.set('pricelist', prev || []);
  }
});
