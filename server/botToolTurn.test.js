import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runCustomerToolTurn,
  historyToContents,
  whatsappifyMarkdown,
  CUSTOMER_TOOL_RULES,
} from './botToolTurn.js';
import { CUSTOMER_TOOL_DECLARATIONS } from './botTools.js';

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

test('the tools offered to the model are facts, links and placements — never sends or charges', () => {
  const names = CUSTOMER_TOOL_DECLARATIONS.map((d) => d.name).sort();
  assert.deepEqual(names, [
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
    'startSignup',
  ]);
  // The two writing tools must name the child they act on, so the bot can never
  // place "somebody" from the card.
  for (const name of ['startSignup', 'joinWaitlist']) {
    const decl = CUSTOMER_TOOL_DECLARATIONS.find((d) => d.name === name);
    assert.deepEqual(decl.parameters.required, ['childName']);
  }
  // A tool may hand over a link, but never message anyone, remove data or take
  // money — those stay with the team.
  assert.equal(names.some((n) => /send|delete|remove|charge|refund|cancel/i.test(n)), false);
  assert.match(CUSTOMER_TOOL_RULES, /HANDOFF/);
});
