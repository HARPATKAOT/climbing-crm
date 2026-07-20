import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWaPhone,
  phonesMatch,
  whatsappConnectService,
} from './whatsappConnect.js';

function withEnv(values, run) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Israeli WhatsApp numbers are normalized for Meta', () => {
  assert.equal(normalizeWaPhone('054-123-4567'), '972541234567');
  assert.equal(normalizeWaPhone('+972 54 123 4567'), '972541234567');
  assert.equal(phonesMatch('0541234567', '+972541234567'), true);
});

test('direct connection config never exposes the verification token', () => {
  withEnv({
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'app-secret',
    META_WEBHOOK_VERIFY_TOKEN: 'private-verify-token',
    META_WA_PHONE_NUMBER_ID: 'phone-id',
    META_WA_WABA_ID: 'waba-id',
    META_WA_ACCESS_TOKEN: 'long-private-access-token',
  }, () => {
    const config = whatsappConnectService.getConnectConfig();
    assert.equal(config.configured, true);
    assert.equal(config.messagingReady, true);
    assert.equal(config.connectionMode, 'direct');
    assert.equal(config.verifyTokenConfigured, true);
    assert.equal(JSON.stringify(config).includes('private-verify-token'), false);

    const status = whatsappConnectService.getStatus();
    assert.equal(status.connected, true);
    assert.equal(status.connectionMode, 'direct');
    assert.equal(JSON.stringify(status).includes('long-private-access-token'), false);
  });
});

test('messaging is ready with only phone id and access token', () => {
  withEnv({
    META_APP_ID: undefined,
    META_APP_SECRET: undefined,
    META_WEBHOOK_VERIFY_TOKEN: undefined,
    META_WA_PHONE_NUMBER_ID: 'phone-id',
    META_WA_WABA_ID: undefined,
    META_WA_ACCESS_TOKEN: 'long-private-access-token',
  }, () => {
    const config = whatsappConnectService.getConnectConfig();
    assert.equal(config.messagingReady, true);
    assert.equal(config.configured, true);
    assert.equal(config.canActivate, false);
    assert.ok(config.missingRecommended.includes('META_WA_WABA_ID'));
  });
});
