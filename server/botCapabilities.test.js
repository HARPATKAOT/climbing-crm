import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_CAPABILITIES,
  CAPABILITY_KEYS,
  capabilitySettingKey,
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

test('a capability is on until it is explicitly turned off', () => {
  // Adding a switch must not quietly change what the bot already does.
  for (const key of CAPABILITY_KEYS) {
    assert.equal(isCapabilityEnabled({}, key), true, key);
  }
  assert.equal(isCapabilityEnabled({ botCap_events: false }, 'events'), false);
  assert.equal(isCapabilityEnabled({}, 'no_such_capability'), false);
});

test('turning off a capability withdraws its tools and nothing else', () => {
  const all = enabledToolNames({});
  assert.equal(all.has('startSignup'), true);

  const noPlacement = enabledToolNames({ botCap_placement: false });
  for (const tool of ['startSignup', 'joinWaitlist', 'cancelSignup']) {
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

test('the settings key is stable, because it is stored in the database', () => {
  assert.equal(capabilitySettingKey('events'), 'botCap_events');
  assert.equal(capabilityState({}).length, BOT_CAPABILITIES.length);
});
