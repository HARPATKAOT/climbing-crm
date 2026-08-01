import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weekdayFromDateStr,
  isWallOperatingDay,
  isWallOpenForSafety,
  lastOperatingDayOnOrBefore,
  isDailySafetyOverdue,
  isDailySafetyCheck,
  hasOpeningHoursOn,
  hasWallEventOn,
  hasWallShiftOn,
} from './wallOperatingDay.js';

// Aug 1 2026 = Saturday (confirmed). Nearby:
const SUN = '2026-07-26';
const THU = '2026-07-30';
const FRI = '2026-07-31';
const SAT = '2026-08-01';
const MON = '2026-07-27';

test('weekdayFromDateStr matches Israel civil weekdays', () => {
  assert.equal(weekdayFromDateStr(SUN), 0);
  assert.equal(weekdayFromDateStr(THU), 4);
  assert.equal(weekdayFromDateStr(FRI), 5);
  assert.equal(weekdayFromDateStr(SAT), 6);
});

test('Sun–Thu are open without calendar entries', () => {
  assert.equal(isWallOperatingDay(SUN, []), true);
  assert.equal(isWallOperatingDay(MON, []), true);
  assert.equal(isWallOperatingDay(THU, []), true);
});

test('Sun–Thu close when training_vacation covers the day', () => {
  const activities = [
    { id: 'v1', type: 'training_vacation', date: MON, name: 'ט׳ באב' },
  ];
  assert.equal(isWallOperatingDay(MON, activities), false);
  assert.equal(isWallOperatingDay(THU, activities), true);
});

test('multi-day training vacation closes each covered weekday', () => {
  const activities = [
    { id: 'v1', type: 'training_vacation', date: SUN, end_date: THU, name: 'חופש' },
  ];
  assert.equal(isWallOperatingDay(SUN, activities), false);
  assert.equal(isWallOperatingDay(MON, activities), false);
  assert.equal(isWallOperatingDay(THU, activities), false);
});

test('Fri/Sat are closed with an empty calendar', () => {
  assert.equal(isWallOperatingDay(FRI, []), false);
  assert.equal(isWallOperatingDay(SAT, []), false);
});

test('Fri/Sat open with opening_hours', () => {
  const activities = [
    { id: 'o1', type: 'opening_hours', date: SAT, start_time: '10:00', end_time: '14:00' },
  ];
  assert.equal(hasOpeningHoursOn(activities, SAT), true);
  assert.equal(isWallOperatingDay(SAT, activities), true);
  assert.equal(isWallOperatingDay(FRI, activities), false);
});

test('Fri/Sat open with a wall birthday', () => {
  const activities = [
    { id: 'b1', type: 'birthday', category: 'wall', date: SAT, name: 'יום הולדת' },
  ];
  assert.equal(hasWallEventOn(activities, SAT), true);
  assert.equal(isWallOperatingDay(SAT, activities), true);
});

test('Fri/Sat open with category wall even if type is other', () => {
  const activities = [
    { id: 'w1', type: 'other', category: 'wall', date: FRI, name: 'אירוע פרטי' },
  ];
  assert.equal(isWallOperatingDay(FRI, activities), true);
});

test('field trips and route building do not open Fri/Sat', () => {
  const activities = [
    { id: 't1', type: 'trip', category: 'field', date: SAT, name: 'טיול' },
    { id: 'r1', type: 'route_building', category: 'ops', date: FRI, name: 'בניית מסלולים' },
  ];
  assert.equal(isWallOperatingDay(SAT, activities), false);
  assert.equal(isWallOperatingDay(FRI, activities), false);
});

test('cancelled wall events are ignored', () => {
  const activities = [
    { id: 'b1', type: 'birthday', category: 'wall', date: SAT, cancelled: true },
    { id: 'o1', type: 'opening_hours', date: SAT, status: 'cancelled' },
  ];
  assert.equal(isWallOperatingDay(SAT, activities), false);
});

test('lastOperatingDayOnOrBefore skips closed weekend', () => {
  assert.equal(lastOperatingDayOnOrBefore(SAT, []), THU);
  assert.equal(lastOperatingDayOnOrBefore(FRI, []), THU);
  assert.equal(lastOperatingDayOnOrBefore(THU, []), THU);
});

test('lastOperatingDayOnOrBefore uses Saturday when it has a wall event', () => {
  const activities = [
    { id: 'b1', type: 'birthday', category: 'wall', date: SAT },
  ];
  assert.equal(lastOperatingDayOnOrBefore(SAT, activities), SAT);
});

test('daily overdue: closed weekend after Thursday signature is not overdue', () => {
  // Signed Thursday; as-of Friday/Saturday closed → last required day is Thursday.
  assert.equal(isDailySafetyOverdue(THU, FRI, []), false);
  assert.equal(isDailySafetyOverdue(THU, SAT, []), false);
});

test('daily overdue: missing Thursday still overdue on closed Friday', () => {
  // Last signed Wednesday; Thursday was open and missed.
  const WED = '2026-07-29';
  assert.equal(isDailySafetyOverdue(WED, FRI, []), true);
});

test('daily overdue: open Sunday after closed weekend needs a new signature', () => {
  const nextSun = '2026-08-02';
  assert.equal(weekdayFromDateStr(nextSun), 0);
  assert.equal(isDailySafetyOverdue(THU, nextSun, []), true);
  assert.equal(isDailySafetyOverdue(nextSun, nextSun, []), false);
});

test('isDailySafetyCheck recognises daily frequency and interval 1', () => {
  assert.equal(isDailySafetyCheck({ frequency: 'יומי', interval_days: 1 }), true);
  assert.equal(isDailySafetyCheck({ frequency: 'שבועי', interval_days: 7 }), false);
  assert.equal(isDailySafetyCheck({ frequency: 'שבועי', interval_days: 1 }), true);
});

test('opening a wall shift on a closed Saturday forces safety open', () => {
  assert.equal(isWallOperatingDay(SAT, []), false);
  const shifts = [
    { id: 'sh1', clock_in: '2026-08-01T07:00:00.000Z', status: 'open', activity_type: 'counter_shift' },
  ];
  assert.equal(hasWallShiftOn(SAT, shifts), true);
  assert.equal(isWallOpenForSafety(SAT, [], shifts), true);
  assert.equal(lastOperatingDayOnOrBefore(SAT, [], { shifts }), SAT);
  assert.equal(isDailySafetyOverdue(THU, SAT, [], shifts), true);
});

test('wall shift on a training-vacation weekday also forces safety open', () => {
  const activities = [
    { id: 'v1', type: 'training_vacation', date: MON, name: 'חג' },
  ];
  assert.equal(isWallOperatingDay(MON, activities), false);
  const shifts = [
    { id: 'sh1', clock_in: '2026-07-27T08:00:00.000Z', status: 'open' },
  ];
  assert.equal(isWallOpenForSafety(MON, activities, shifts), true);
});

test('a closed shift from earlier that day still counts as open for safety', () => {
  const shifts = [
    {
      id: 'sh1',
      clock_in: '2026-08-01T06:00:00.000Z',
      clock_out: '2026-08-01T10:00:00.000Z',
      status: 'closed',
    },
  ];
  assert.equal(hasWallShiftOn(SAT, shifts), true);
  assert.equal(isWallOpenForSafety(SAT, [], shifts), true);
});
