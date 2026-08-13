import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_CAPABILITIES,
  CAPABILITY_INPUT_KEYS,
  CAPABILITY_KEYS,
  capabilitySettingKey,
  capabilitySettingsPatch,
  capabilityState,
  enabledToolNames,
  isCapabilityEnabled,
} from './botCapabilities.js';
import { CUSTOMER_TOOL_DECLARATIONS } from './botTools.js';

test('every tool the model can be offered belongs to exactly one switch', () => {
  // A tool nobody owns can never be turned off — the whole point of the panel.
  const owned = BOT_CAPABILITIES.flatMap((c) => c.tools);
  const declared = CUSTOMER_TOOL_DECLARATIONS.map((d) => d.name).sort();
  assert.deepEqual([...owned].sort(), declared);
  assert.equal(new Set(owned).size, owned.length, 'a tool is listed twice');
});

test('every capability says which screen its answer comes from', () => {
  // The bot screen is not a place to type business facts. Naming the owning
  // screen on every row is what keeps a price from being written in two places.
  for (const capability of BOT_CAPABILITIES) {
    assert.ok(
      String(capability.source || '').trim(),
      `${capability.key} does not say where its data comes from`
    );
  }
  const state = capabilityState({});
  assert.equal(state.every((c) => c.source), true);
});

test('a capability is on until it is explicitly turned off', () => {
  // Adding a switch must not quietly change what the bot already does.
  const optIn = new Set(BOT_CAPABILITIES.filter((c) => c.defaultOff).map((c) => c.key));
  for (const key of CAPABILITY_KEYS) {
    if (optIn.has(key)) continue;
    assert.equal(isCapabilityEnabled({}, key), true, key);
  }
  // Carmit's fixed exchange is handled atomically by the centre-report
  // capability itself; there is no second hidden switch for the mutation.
  assert.equal(isCapabilityEnabled({}, 'centre_report'), true);
  assert.equal(isCapabilityEnabled({ botCap_centre_report: false }, 'centre_report'), false);
  assert.equal(isCapabilityEnabled({ botCap_events: false }, 'events'), false);
  assert.equal(isCapabilityEnabled({}, 'no_such_capability'), false);
});

test('turning off a capability withdraws its tools and nothing else', () => {
  const all = enabledToolNames({});
  assert.equal(all.has('startSignup'), true);

  const noPlacement = enabledToolNames({ botCap_placement: false });
  for (const tool of [
    'startSignup',
    'scheduleIntroSession',
    'acceptWaitlistOffer',
    'continueAfterIntro',
    'retryIntroAfterNoShow',
    'joinWaitlist',
    'cancelSignup',
  ]) {
    assert.equal(noPlacement.has(tool), false, tool);
  }
  // Neighbouring capabilities are untouched.
  assert.equal(noPlacement.has('getSignupLink'), true);
  assert.equal(noPlacement.has('listClasses'), true);
});

test('registering an interest cannot outlive talking about events', () => {
  // Otherwise the bot offers to slot someone into a trip it may not describe.
  const off = enabledToolNames({ botCap_events: false });
  assert.equal(off.has('getEvents'), false);
  assert.equal(off.has('addActivityInterest'), false);
  assert.equal(isCapabilityEnabled({ botCap_events: false }, 'event_interest'), false);

  const state = capabilityState({ botCap_events: false });
  assert.equal(state.find((c) => c.key === 'event_interest').enabled, false);
});

test('a capability may own a field, and stays inert while it is empty', () => {
  // The community centre's secretary can change, so the phone is something the
  // owner types — not a redeploy.
  const centre = capabilityState({}).find((c) => c.key === 'centre_report');
  assert.equal(centre.input.key, 'aiCentrePhones');
  assert.equal(centre.input.value, '');
  assert.deepEqual(CAPABILITY_INPUT_KEYS, ['aiCentrePhones']);

  const withPhone = capabilityState({ aiCentrePhones: '0501234567' })
    .find((c) => c.key === 'centre_report');
  assert.equal(withPhone.input.value, '0501234567');

  // Turning it off withdraws the one tool it owns — writing down a parent's
  // claim to have registered — and nothing else.
  const off = enabledToolNames({ botCap_centre_report: false });
  assert.equal(off.has('reportCentreRegistration'), false);
  assert.equal(enabledToolNames({}).has('reportCentreRegistration'), true);
  assert.equal(off.has('listClasses'), true);
  assert.equal(isCapabilityEnabled({ botCap_centre_report: false }, 'centre_report'), false);
});

test('the settings key is stable, because it is stored in the database', () => {
  assert.equal(capabilitySettingKey('events'), 'botCap_events');
  assert.equal(capabilityState({}).length, BOT_CAPABILITIES.length);
});

test('a capability-owned field saves without a switch in the same request', () => {
  assert.deepEqual(
    capabilitySettingsPatch({ values: { aiCentrePhones: '0501234567' } }),
    { aiCentrePhones: '0501234567' }
  );
  assert.deepEqual(
    capabilitySettingsPatch({ capabilities: { centre_report: false } }),
    { botCap_centre_report: false }
  );
  assert.deepEqual(capabilitySettingsPatch({ values: { unknown: 'x' } }), {});
});
