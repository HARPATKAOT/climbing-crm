import test from 'node:test';
import assert from 'node:assert/strict';
import { staffReliability } from './staffReliability.js';
import {
  DEFAULT_STAFF_RELIABILITY_SETTINGS,
  normalizeStaffReliabilitySettings,
} from './staffReliabilitySettings.js';

const TODAY = '2026-08-17';
const SETTINGS = DEFAULT_STAFF_RELIABILITY_SETTINGS;

const eventRow = (date, status) => ({ date, status, activity_id: `a-${date}-${status}` });
const classRow = (date, status) => ({ date, status, group_id: 'g1' });

test('a session nobody marked is neither an arrival nor a no-show', () => {
  const result = staffReliability([
    eventRow('2026-08-01', 'present'),
    eventRow('2026-08-02', 'absent'),
    { date: '2026-08-03', status: 'pending', activity_id: 'a3' },
    { date: '2026-08-04', activity_id: 'a4' },
  ], SETTINGS, TODAY);
  assert.equal(result.total.marked, 2);
  assert.equal(result.total.attendance_pct, 50);
});

test('a substitution counts on its own, in neither direction', () => {
  const result = staffReliability([
    eventRow('2026-08-01', 'present'),
    eventRow('2026-08-02', 'present'),
    eventRow('2026-08-03', 'substituted'),
  ], SETTINGS, TODAY);
  assert.equal(result.total.substituted, 1);
  // המכנה הוא שתי הגעות בלבד — ההחלפה אינה מורידה את האחוז.
  assert.equal(result.total.attendance_pct, 100);
});

test('classes and events are counted apart', () => {
  const result = staffReliability([
    classRow('2026-08-04', 'present'),
    classRow('2026-08-11', 'present'),
    eventRow('2026-08-05', 'absent'),
  ], SETTINGS, TODAY);
  assert.equal(result.classes.present, 2);
  assert.equal(result.classes.attendance_pct, 100);
  assert.equal(result.events.absent, 1);
  assert.equal(result.events.attendance_pct, 0);
});

test('the reliability flag stays down until there is a pattern to see', () => {
  // הברזה אחת מתוך אחת היא 0% — ועדיין אינה דפוס.
  const thin = staffReliability([eventRow('2026-08-01', 'absent')], SETTINGS, TODAY);
  assert.equal(thin.total.attendance_pct, 0);
  assert.equal(thin.flags.reliability, false);

  const enough = staffReliability([
    eventRow('2026-08-01', 'absent'),
    eventRow('2026-08-02', 'absent'),
    eventRow('2026-08-03', 'present'),
    eventRow('2026-08-04', 'present'),
  ], SETTINGS, TODAY);
  assert.equal(enough.total.attendance_pct, 50);
  assert.equal(enough.flags.reliability, true);
});

test('someone who always turns up is never flagged for reliability', () => {
  const rows = Array.from({ length: 6 }, (_, i) => eventRow(`2026-08-0${i + 1}`, 'present'));
  assert.equal(staffReliability(rows, SETTINGS, TODAY).flags.reliability, false);
});

test('the volume flag counts events only — a weekly class must not silence it', () => {
  // מדריך חוג נאמן לגמרי, בלי אף אירוע: הדגל הכמותי חייב לדלוק.
  const classesOnly = Array.from({ length: 12 }, (_, i) => classRow(`2026-08-${String(i + 1).padStart(2, '0')}`, 'present'));
  const result = staffReliability(classesOnly, SETTINGS, TODAY);
  assert.equal(result.classes.present, 12);
  assert.equal(result.monthly_average, 0);
  assert.equal(result.flags.volume, true);
  assert.equal(result.flags.reliability, false);
});

test('an empty month inside the window pulls the average down', () => {
  const rows = [
    eventRow('2026-08-01', 'present'), eventRow('2026-08-02', 'present'),
    eventRow('2026-08-03', 'present'), eventRow('2026-08-04', 'present'),
    eventRow('2026-08-05', 'present'), eventRow('2026-08-06', 'present'),
  ];
  const result = staffReliability(rows, SETTINGS, TODAY);
  // שישה אירועים בחודש אחד, על פני חלון של שלושה חודשים = 2 בממוצע.
  assert.deepEqual(result.per_month.map((m) => m.ym), ['2026-06', '2026-07', '2026-08']);
  assert.equal(result.monthly_average, 2);
  assert.equal(result.flags.volume, false);
});

test('an absence never counts towards the monthly volume', () => {
  const rows = Array.from({ length: 9 }, (_, i) => eventRow(`2026-08-0${i + 1}`, 'absent'));
  const result = staffReliability(rows, SETTINGS, TODAY);
  assert.equal(result.monthly_average, 0);
  assert.equal(result.flags.volume, true);
});

test('settings are clamped to something a threshold can mean', () => {
  const s = normalizeStaffReliabilitySettings({
    reliability_min_pct: 500,
    reliability_min_marked: 0,
    volume_min_events_per_month: -3,
    volume_window_months: 99,
  });
  assert.equal(s.reliability_min_pct, 100);
  assert.equal(s.reliability_min_marked, 1);
  assert.equal(s.volume_min_events_per_month, 0);
  assert.equal(s.volume_window_months, 24);
  assert.deepEqual(normalizeStaffReliabilitySettings({}), DEFAULT_STAFF_RELIABILITY_SETTINGS);
});
