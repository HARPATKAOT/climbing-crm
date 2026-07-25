import test from 'node:test';
import assert from 'node:assert/strict';
import { daysInclusive } from './googleCalendar.js';

test('daysInclusive counts inclusive date ranges', () => {
  assert.equal(daysInclusive('2026-07-01', null), 1);
  assert.equal(daysInclusive('2026-07-01', '2026-07-01'), 1);
  assert.equal(daysInclusive('2026-07-01', '2026-07-05'), 5);
  assert.equal(daysInclusive('2026-07-05', '2026-07-01'), 1);
});
