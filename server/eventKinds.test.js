import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE,
  eventKindLabel,
  isEventType,
  normalizeActivityType,
} from './eventKinds.js';

test('the three former types are all events', () => {
  for (const legacy of ['birthday', 'school', 'company']) {
    assert.equal(isEventType(legacy), true, legacy);
  }
  assert.equal(isEventType(EVENT_TYPE), true);
  assert.equal(isEventType('trip'), false);
  assert.equal(isEventType('personal_training'), false);
});

test('a row saved before the merge keeps its meaning', () => {
  assert.deepEqual(normalizeActivityType('birthday'), { type: 'event', eventKind: 'birthday' });
  assert.deepEqual(normalizeActivityType('school'), { type: 'event', eventKind: 'school' });
  assert.deepEqual(normalizeActivityType('company'), { type: 'event', eventKind: 'company' });
});

test('an explicit kind wins over the one implied by a legacy type', () => {
  assert.deepEqual(normalizeActivityType('birthday', 'school'), { type: 'event', eventKind: 'school' });
});

test('an unknown kind is dropped rather than stored', () => {
  assert.deepEqual(normalizeActivityType('event', 'wedding'), { type: 'event', eventKind: '' });
  assert.deepEqual(normalizeActivityType('event', 'company'), { type: 'event', eventKind: 'company' });
});

test('a kind never leaks onto a type that is not an event', () => {
  assert.deepEqual(normalizeActivityType('trip', 'birthday'), { type: 'trip', eventKind: '' });
  assert.deepEqual(normalizeActivityType('personal_training', 'company'), { type: 'personal_training', eventKind: '' });
});

test('labels are looked up, and an unknown kind has none', () => {
  assert.equal(eventKindLabel('birthday'), 'יום הולדת');
  assert.equal(eventKindLabel('school'), 'בית ספר');
  assert.equal(eventKindLabel(''), '');
  assert.equal(eventKindLabel('wedding'), '');
});
