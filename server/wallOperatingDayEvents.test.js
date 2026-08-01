import test from 'node:test';
import assert from 'node:assert/strict';
import { hasWallEventOn } from './wallOperatingDay.js';

const on = (type, extra = {}) => [{ type, date: '2026-08-07', category: 'field', ...extra }];
const DAY = '2026-08-07';

test('a merged event opens the wall day', () => {
  assert.equal(hasWallEventOn(on('event'), DAY), true);
});

test('an event booked before the merge still opens the day', () => {
  // These rows are migrated, but one can arrive later from a Google sync or a
  // restored backup — a Friday must not silently become a closed day.
  for (const legacy of ['birthday', 'school', 'company']) {
    assert.equal(hasWallEventOn(on(legacy), DAY), true, legacy);
  }
});

test('a personal training counts: the wall is in use', () => {
  assert.equal(hasWallEventOn(on('personal_training'), DAY), true);
});

test('what happens away from the wall does not open it', () => {
  assert.equal(hasWallEventOn(on('trip'), DAY), false);
  assert.equal(hasWallEventOn(on('route_building'), DAY), false);
  assert.equal(hasWallEventOn(on('training_vacation'), DAY), false);
  assert.equal(hasWallEventOn(on('opening_hours'), DAY), false);
});

test('anything else at the wall still opens the day by its category', () => {
  assert.equal(hasWallEventOn(on('other', { category: 'wall' }), DAY), true);
  assert.equal(hasWallEventOn(on('other', { category: 'field' }), DAY), false);
});
