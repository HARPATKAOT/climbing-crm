import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mediaKindOf,
  hasStoredMedia,
  mediaFilenameOf,
  replyTargetOf,
  reactionTargetOf,
  isReactionRow,
  reactionEmojiOf,
} from './mediaRef.js';

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

test('a bubble reads its quote from the meta column', () => {
  assert.equal(replyTargetOf({ meta: { reply_to: 'wamid.NEW' } }), 'wamid.NEW');
  assert.equal(reactionTargetOf({ meta: { reaction_to: 'wamid.NEW' } }), 'wamid.NEW');
  // The column wins over a row that also carries the older encoding.
  assert.equal(
    replyTargetOf({ meta: { reply_to: 'wamid.NEW' }, media_url: 'ctx:?reply_to=wamid.OLD' }),
    'wamid.NEW'
  );
});

test('a bubble knows which message it quotes', () => {
  assert.equal(replyTargetOf({ media_url: 'ctx:?reply_to=wamid.ABC' }), 'wamid.ABC');
  // A quoted photo carries both, and neither reading disturbs the other.
  const quotedPhoto = { media_url: 'wa-media:42?mime=image%2Fjpeg&reply_to=wamid.ABC' };
  assert.equal(replyTargetOf(quotedPhoto), 'wamid.ABC');
  assert.equal(mediaKindOf({ ...quotedPhoto, media_type: 'image' }), 'image');
  assert.equal(replyTargetOf({ media_url: 'wa-media:42' }), '');
  assert.equal(replyTargetOf({}), '');
});

test('a reaction points at its target and carries its emoji', () => {
  const row = { media_type: 'reaction', media_url: 'ctx:?reaction_to=wamid.XYZ', message: 'ריאקציה: 👍' };
  assert.equal(isReactionRow(row), true);
  assert.equal(reactionTargetOf(row), 'wamid.XYZ');
  assert.equal(reactionEmojiOf(row), '👍');
  // Removing a reaction stores the same row shape with no emoji.
  assert.equal(reactionEmojiOf({ ...row, message: 'ריאקציה הוסרה' }), '');
});

test('an ordinary message is not a reaction', () => {
  assert.equal(isReactionRow({ media_type: 'text', message: 'ריאקציה: לא באמת' }), false);
});

test('a public link never has its own query read as ours', () => {
  const row = { media_url: 'https://example.com/a.pdf?reply_to=not-ours&name=not-ours' };
  assert.equal(replyTargetOf(row), '');
  assert.equal(mediaFilenameOf(row), 'a.pdf');
});
