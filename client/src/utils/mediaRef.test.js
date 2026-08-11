import test from 'node:test';
import assert from 'node:assert/strict';

import { mediaKindOf, hasStoredMedia, mediaFilenameOf } from './mediaRef.js';

test('a media kind is read from either collection field name', () => {
  // mergeThread mixes durable `messages` rows (media_type) with the local
  // whatsapp_logs mirror (message_type). Reading only one was the original bug:
  // every inbound photo stored durably rendered as a plain text bubble.
  assert.equal(mediaKindOf({ media_type: 'image' }), 'image');
  assert.equal(mediaKindOf({ message_type: 'image' }), 'image');
  assert.equal(mediaKindOf({ media_type: 'document' }), 'document');
  assert.equal(mediaKindOf({ message_type: 'AUDIO' }), 'audio');
});

test('a voice note is played as audio', () => {
  assert.equal(mediaKindOf({ media_type: 'voice' }), 'audio');
});

test('rows that carry no file report no kind', () => {
  for (const row of [
    { media_type: 'text' },
    { media_type: 'reaction' },
    { media_type: 'interactive' },
    { media_type: 'unsupported' },
    { message_type: 'system' },
    {},
  ]) {
    assert.equal(mediaKindOf(row), '', `expected no kind for ${JSON.stringify(row)}`);
  }
});

test('a row only counts as stored when it points somewhere', () => {
  assert.equal(hasStoredMedia({ media_type: 'image', media_url: 'wa-media:123' }), true);
  // Every photo received before inbound capture shipped looks like this.
  assert.equal(hasStoredMedia({ media_type: 'image', media_url: null }), false);
  assert.equal(hasStoredMedia({ media_type: 'image', media_url: '  ' }), false);
});

test('the filename is read off the reference, including Hebrew', () => {
  assert.equal(
    mediaFilenameOf({ media_url: 'wa-media:9?mime=application%2Fpdf&name=%D7%A7%D7%91%D7%9C%D7%94.pdf' }),
    'קבלה.pdf'
  );
  assert.equal(mediaFilenameOf({ media_url: 'https://example.com/docs/invoice-3993.pdf' }), 'invoice-3993.pdf');
  assert.equal(mediaFilenameOf({ media_url: 'wa-media:9' }), '');
  assert.equal(mediaFilenameOf({}), '');
});
