import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpecialHourPeriods,
  mergeSpecialHourPeriods,
} from './googleBusinessProfile.js';

const TODAY = '2026-08-13';

test('opening-hours calendar becomes a complete Google special-hours window', () => {
  const periods = buildSpecialHourPeriods([
    { type: 'opening_hours', date: TODAY, start_time: '16:00', end_time: '20:30', status: 'open' },
    { type: 'opening_hours', date: TODAY, start_time: '09:00', end_time: '12:00', status: 'open' },
    { type: 'opening_hours', date: '2026-08-14', start_time: '10:00', end_time: '14:00', status: 'draft' },
    { type: 'trip', date: '2026-08-14', start_time: '10:00', end_time: '14:00' },
  ], { today: TODAY, days: 2 });

  assert.equal(periods.length, 3);
  assert.deepEqual(periods[0], {
    startDate: { year: 2026, month: 8, day: 13 },
    openTime: { hours: 9, minutes: 0 },
    closeTime: { hours: 12, minutes: 0 },
    closed: false,
  });
  assert.equal(periods[1].openTime.hours, 16);
  assert.deepEqual(periods[2], {
    startDate: { year: 2026, month: 8, day: 14 },
    closed: true,
  });
});

test('all-day and overnight entries use valid Google time periods', () => {
  const periods = buildSpecialHourPeriods([
    { type: 'opening_hours', date: TODAY, all_day: true },
    { type: 'opening_hours', date: '2026-08-14', start_time: '20:00', end_time: '01:00' },
  ], { today: TODAY, days: 2 });

  assert.deepEqual(periods[0].openTime, { hours: 0, minutes: 0 });
  assert.deepEqual(periods[0].closeTime, { hours: 24, minutes: 0 });
  assert.deepEqual(periods[1].endDate, { year: 2026, month: 8, day: 15 });
});

test('merge replaces only the CRM rolling window', () => {
  const existing = [
    { startDate: { year: 2026, month: 8, day: 12 }, closed: true },
    { startDate: { year: 2026, month: 8, day: 13 }, closed: false },
    { startDate: { year: 2026, month: 8, day: 20 }, closed: true },
  ];
  const replacement = [
    { startDate: { year: 2026, month: 8, day: 13 }, closed: true },
    { startDate: { year: 2026, month: 8, day: 14 }, closed: true },
  ];
  const merged = mergeSpecialHourPeriods(existing, replacement, { today: TODAY, days: 2 });
  assert.deepEqual(merged.map((period) => period.startDate.day), [12, 13, 14, 20]);
  assert.equal(merged.find((period) => period.startDate.day === 13).closed, true);
});
