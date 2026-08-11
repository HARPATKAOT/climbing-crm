import test from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeMediaRef,
  parseMediaRef,
  mediaExtensionForMime,
  mediaKindForMime,
  mediaKindOfRow,
  storagePathForMedia,
} from './mediaRef.js';

test('a Meta media reference survives the round trip', () => {
  const encoded = encodeMediaRef({
    kind: 'meta',
    id: '1234567890123',
    mime: 'image/jpeg',
    filename: 'IMG_1234.jpg',
  });
  assert.equal(parseMediaRef(encoded).kind, 'meta');
  assert.equal(parseMediaRef(encoded).id, '1234567890123');
  assert.equal(parseMediaRef(encoded).mime, 'image/jpeg');
  assert.equal(parseMediaRef(encoded).filename, 'IMG_1234.jpg');
});

test('a Hebrew filename with a slash-carrying mime survives encoding', () => {
  const encoded = encodeMediaRef({
    kind: 'storage',
    id: 'wa-media/2026/08/wh1.pdf',
    mime: 'application/pdf',
    filename: 'חשבונית מס קבלה 3993.pdf',
  });
  const parsed = parseMediaRef(encoded);
  assert.equal(parsed.kind, 'storage');
  assert.equal(parsed.id, 'wa-media/2026/08/wh1.pdf');
  assert.equal(parsed.mime, 'application/pdf');
  assert.equal(parsed.filename, 'חשבונית מס קבלה 3993.pdf');
});

test('a bare digit string is read as a legacy Meta media id', () => {
  // sendImageMessage stored the raw Meta id in media_url before this format existed.
  assert.deepEqual(parseMediaRef('987654321098'), {
    kind: 'meta',
    id: '987654321098',
    mime: '',
    filename: '',
  });
});

test('a public link is passed through whole and never gains our params', () => {
  const link = 'https://crm.example.com/invoices/3993.pdf?token=abc';
  assert.equal(encodeMediaRef({ kind: 'link', id: link, mime: 'application/pdf' }), link);
  const parsed = parseMediaRef(link);
  assert.equal(parsed.kind, 'link');
  assert.equal(parsed.id, link);
  assert.equal(parsed.filename, '3993.pdf');
});

test('rows that point nowhere parse to null instead of throwing', () => {
  for (const input of [null, undefined, '', '   ', 'text', 'wa-media:', 'storage:', '12345']) {
    assert.equal(parseMediaRef(input), null, `expected null for ${JSON.stringify(input)}`);
  }
});

test('a reference with no metadata still parses', () => {
  assert.deepEqual(parseMediaRef('wa-media:abc123'), {
    kind: 'meta',
    id: 'abc123',
    mime: '',
    filename: '',
  });
});

test('mime maps to the WhatsApp type word', () => {
  assert.equal(mediaKindForMime('image/jpeg'), 'image');
  // A webp must go out as a sticker — WhatsApp rejects it as an image.
  assert.equal(mediaKindForMime('image/webp'), 'sticker');
  assert.equal(mediaKindForMime('video/mp4'), 'video');
  assert.equal(mediaKindForMime('audio/ogg; codecs=opus'), 'audio');
  assert.equal(mediaKindForMime('application/pdf'), 'document');
  assert.equal(mediaKindForMime(''), 'document');
});

test('mime maps to a file extension, and never to a vendor tree', () => {
  assert.equal(mediaExtensionForMime('application/pdf'), 'pdf');
  assert.equal(mediaExtensionForMime('image/jpeg'), 'jpg');
  assert.equal(mediaExtensionForMime('image/heic'), 'heic');
  assert.equal(
    mediaExtensionForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'docx'
  );
  assert.equal(mediaExtensionForMime('application/x-some-unknown-thing'), 'bin');
  assert.equal(mediaExtensionForMime(''), 'bin');
});

test('a row carries a file only for the media types', () => {
  // The two collections disagree on the field name — both must be read.
  assert.equal(mediaKindOfRow({ media_type: 'image' }), 'image');
  assert.equal(mediaKindOfRow({ message_type: 'document' }), 'document');
  for (const row of [{ media_type: 'text' }, { media_type: 'reaction' }, { media_type: 'interactive' }, {}]) {
    assert.equal(mediaKindOfRow(row), '');
  }
});

test('the storage path is dated and strips anything unsafe from the id', () => {
  const path = storagePathForMedia('wh1786../../etc', 'application/pdf', {
    at: new Date('2026-08-11T09:00:00Z'),
  });
  assert.equal(path, 'wa-media/2026/08/wh1786etc.pdf');
});
