import test from 'node:test';
import assert from 'node:assert/strict';
import { webhookNotificationMatches } from './googleCalendar.js';

const settings = {
  channelId: 'channel-123',
  channelResourceId: 'resource-456',
  channelToken: 'token-789',
};

test('Google webhook notifications require channel, resource and secret token', () => {
  assert.equal(webhookNotificationMatches(settings, {
    'x-goog-channel-id': settings.channelId,
    'x-goog-resource-id': settings.channelResourceId,
    'x-goog-channel-token': settings.channelToken,
  }), true);
  assert.equal(webhookNotificationMatches(settings, {
    'x-goog-channel-id': settings.channelId,
    'x-goog-resource-id': settings.channelResourceId,
    'x-goog-channel-token': 'wrong',
  }), false);
  assert.equal(webhookNotificationMatches(settings, {}), false);
});

test('existing pre-token watches remain bound to their unguessable ids', () => {
  const legacy = { channelId: settings.channelId, channelResourceId: settings.channelResourceId };
  assert.equal(webhookNotificationMatches(legacy, {
    'x-goog-channel-id': settings.channelId,
    'x-goog-resource-id': settings.channelResourceId,
  }), true);
});
