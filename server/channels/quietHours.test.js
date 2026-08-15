import test from 'node:test';
import assert from 'node:assert/strict';
import {
  quietReasonAt,
  holidayNameOn,
  nextAllowedTime,
  quietStatus,
  jerusalemParts,
} from './quietHours.js';

// All instants below are UTC; Israel is UTC+3 in summer (IDT).

test('midweek midday is not quiet', () => {
  // Wednesday 2026-08-12 12:00 IL
  assert.equal(quietReasonAt(new Date('2026-08-12T09:00:00Z')), '');
});

test('night hours are quiet, including after midnight', () => {
  // Wednesday 23:00 IL
  assert.equal(quietReasonAt(new Date('2026-08-12T20:00:00Z')), 'שעות לילה');
  // Thursday 02:30 IL
  assert.equal(quietReasonAt(new Date('2026-08-12T23:30:00Z')), 'שעות לילה');
  // 08:00 IL exactly — allowed again
  assert.equal(quietReasonAt(new Date('2026-08-13T05:00:00Z')), '');
});

test('friday evening and saturday are quiet; saturday night reopens', () => {
  // Friday 17:00 IL
  assert.equal(quietReasonAt(new Date('2026-08-14T14:00:00Z')), 'ערב שבת');
  // Saturday 11:00 IL
  assert.equal(quietReasonAt(new Date('2026-08-15T08:00:00Z')), 'שבת');
  // Saturday 20:40 IL — after exit, before night curfew at 21:00
  assert.equal(quietReasonAt(new Date('2026-08-15T17:40:00Z')), '');
});

test('holidays are recognised by the hebrew calendar', () => {
  // 10 Tishrei 5787 = Yom Kippur, 2026-09-21
  assert.equal(holidayNameOn(new Date('2026-09-21T09:00:00Z')), 'יום כיפור');
  // 15 Nisan 5786 = first day of Pesach, 2026-04-02
  assert.equal(holidayNameOn(new Date('2026-04-02T09:00:00Z')), 'פסח');
  // An ordinary summer day is no holiday
  assert.equal(holidayNameOn(new Date('2026-08-12T09:00:00Z')), '');
});

test('holiday daytime and its eve are quiet', () => {
  // Yom Kippur 12:00 IL
  assert.match(quietReasonAt(new Date('2026-09-21T09:00:00Z')), /יום כיפור/);
  // Erev Yom Kippur 17:00 IL (2026-09-20)
  assert.match(quietReasonAt(new Date('2026-09-20T14:00:00Z')), /ערב חג/);
});

test('nextAllowedTime from friday evening lands after shabbat exit', () => {
  const from = new Date('2026-08-14T14:00:00Z'); // Friday 17:00 IL
  const next = nextAllowedTime(from);
  const parts = jerusalemParts(next);
  assert.equal(parts.weekday, 6); // Saturday
  assert.ok(parts.time >= '20:30' && parts.time < '21:00', `got ${parts.time}`);
});

test('quietStatus carries reason and a next allowed slot', () => {
  const status = quietStatus(new Date('2026-08-12T20:00:00Z')); // Wed 23:00 IL
  assert.equal(status.quiet, true);
  assert.equal(status.reason, 'שעות לילה');
  const next = jerusalemParts(new Date(status.nextAllowed));
  assert.equal(next.time, '08:00');
});
