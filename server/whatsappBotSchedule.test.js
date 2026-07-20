import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldAiAutoReply } from './whatsapp.js';

test('bot stays off when responder disabled', () => {
  assert.equal(shouldAiAutoReply({ aiResponderEnabled: false }), false);
});

test('bot ignores schedule when hours are disabled', () => {
  assert.equal(
    shouldAiAutoReply({
      aiResponderEnabled: true,
      aiActiveHoursEnabled: false,
    }),
    true
  );
});

test('simulator can ignore schedule', () => {
  assert.equal(
    shouldAiAutoReply(
      {
        aiResponderEnabled: true,
        aiActiveHoursEnabled: true,
        aiActiveHoursStart: '00:00',
        aiActiveHoursEnd: '00:01',
        aiActiveDays: [],
      },
      { ignoreSchedule: true }
    ),
    true
  );
});
