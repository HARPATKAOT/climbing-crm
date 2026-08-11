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

// Every real Cloud API payload shape we have seen, checked twice: the media id
// comes out, and — the part that matters — the text an inbound message is
// handled by is byte-identical to what it was before media capture existed.
// If that second assertion ever fails, customers are being answered differently.
const WEBHOOK_PAYLOADS = [
  {
    name: 'plain text',
    message: { type: 'text', text: { body: 'יש מקום ביום שני?' } },
    text: 'יש מקום ביום שני?',
    mediaRef: null,
  },
  {
    name: 'image with a caption',
    message: {
      type: 'image',
      image: { id: '1234567890123', mime_type: 'image/jpeg', caption: 'זה הציוד שלי' },
    },
    text: 'זה הציוד שלי',
    mediaRef: { kind: 'image', id: '1234567890123', mime: 'image/jpeg', filename: '' },
  },
  {
    name: 'image with no caption',
    message: { type: 'image', image: { id: '999', mime_type: 'image/png' } },
    text: '[תמונה]',
    mediaRef: { kind: 'image', id: '999', mime: 'image/png', filename: '' },
  },
  {
    name: 'document with a Hebrew filename',
    message: {
      type: 'document',
      document: { id: '555', mime_type: 'application/pdf', filename: 'חשבונית 3993.pdf' },
    },
    text: '[קובץ: חשבונית 3993.pdf]',
    mediaRef: { kind: 'document', id: '555', mime: 'application/pdf', filename: 'חשבונית 3993.pdf' },
  },
  {
    name: 'voice note',
    message: { type: 'audio', audio: { id: '777', mime_type: 'audio/ogg; codecs=opus', voice: true } },
    text: '[הודעה קולית]',
    mediaRef: { kind: 'audio', id: '777', mime: 'audio/ogg', filename: '' },
  },
  {
    name: 'video',
    message: { type: 'video', video: { id: '888', mime_type: 'video/mp4' } },
    text: '[סרטון]',
    mediaRef: { kind: 'video', id: '888', mime: 'video/mp4', filename: '' },
  },
  {
    name: 'sticker',
    message: { type: 'sticker', sticker: { id: '321', mime_type: 'image/webp' } },
    text: '[סטיקר]',
    mediaRef: { kind: 'sticker', id: '321', mime: 'image/webp', filename: '' },
  },
  {
    name: 'reaction',
    message: { type: 'reaction', reaction: { emoji: '👍', message_id: 'wamid.abc' } },
    text: 'ריאקציה: 👍',
    mediaRef: null,
  },
  {
    name: 'location',
    message: { type: 'location', location: { latitude: 32.1, longitude: 34.8 } },
    text: '[מיקום]',
    mediaRef: null,
  },
  {
    name: 'contact card',
    message: { type: 'contacts', contacts: [{ name: { formatted_name: 'דנה' } }] },
    text: '[איש קשר]',
    mediaRef: null,
  },
  {
    name: 'interactive button reply',
    message: {
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'menu_2', title: 'שיבוץ' } },
    },
    text: '2',
    mediaRef: null,
  },
  { name: 'empty object', message: {}, text: '', mediaRef: null },
  { name: 'undefined', message: undefined, text: '', mediaRef: null },
];

test('media ids are read without changing what inbound text says', () => {
  for (const { name, message, text, mediaRef } of WEBHOOK_PAYLOADS) {
    assert.equal(
      whatsappConnectService.extractMessageText(message),
      text,
      `text moved for ${name} — inbound handling would change`
    );
    assert.deepEqual(whatsappConnectService.extractMediaRef(message), mediaRef, `media ref for ${name}`);
  }
});

test('a media payload without an id yields no reference', () => {
  // Meta sends this shape when the file failed its own virus scan.
  assert.equal(whatsappConnectService.extractMediaRef({ type: 'image', image: {} }), null);
});

test('a hostile payload comes back as null instead of throwing', () => {
  const hostile = { type: 'image' };
  Object.defineProperty(hostile, 'image', { get() { throw new Error('boom'); } });
  assert.equal(whatsappConnectService.extractMediaRef(hostile), null);
});
