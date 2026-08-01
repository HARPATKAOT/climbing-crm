import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  hebrewDayLabel,
  wallCalendarItems,
  googleOverlayItems,
  sortAgendaItems,
  formatDailyDigest,
  formatWeeklyDigest,
  flattenForTemplate,
  normalizeAgendaSettings,
  agendaDigestsDue,
} from './agendaDigest.js';

test('addDays walks dates without drifting on DST', () => {
  assert.equal(addDays('2026-08-02', 1), '2026-08-03');
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
});

test('hebrewDayLabel names the weekday in Hebrew', () => {
  assert.equal(hebrewDayLabel('2026-08-02'), 'יום ראשון 2.8');
  assert.equal(hebrewDayLabel('2026-08-01'), 'יום שבת 1.8');
});

test('wall calendar items skip cancelled activities and span multi-day events', () => {
  const items = wallCalendarItems(
    [
      { name: 'טיול', date: '2026-08-02', start_time: '09:00', end_time: '14:00' },
      { name: 'מחנה', date: '2026-08-02', end_date: '2026-08-04', all_day: true },
      { name: 'בוטל', date: '2026-08-02', status: 'cancelled' },
      { name: 'מחוץ לטווח', date: '2026-08-09' },
    ],
    { from: '2026-08-02', to: '2026-08-03' }
  );

  assert.deepEqual(
    items.map((i) => `${i.date} ${i.title}`),
    ['2026-08-02 טיול', '2026-08-02 מחנה', '2026-08-03 מחנה']
  );
});

test('google all-day events stop before their exclusive end date', () => {
  const items = googleOverlayItems([
    {
      name: 'חופשה',
      date: '2026-08-02',
      end_date: '2026-08-04', // exclusive — the last real day is the 3rd
      all_day: true,
      calendar_name: 'משפחה',
    },
  ]);
  assert.deepEqual(items.map((i) => i.date), ['2026-08-02', '2026-08-03']);
});

test('a timed google event that runs past midnight is listed once', () => {
  const items = googleOverlayItems([
    {
      name: 'משמרת לילה',
      date: '2026-08-02',
      end_date: '2026-08-03',
      start_time: '22:00',
      end_time: '02:00',
      all_day: false,
    },
  ]);
  assert.deepEqual(items.map((i) => i.date), ['2026-08-02']);
});

test('all-day items sort ahead of timed ones, then by hour', () => {
  const sorted = sortAgendaItems([
    { date: '2026-08-02', time: '14:00', title: 'ב' },
    { date: '2026-08-02', time: '', allDay: true, title: 'א' },
    { date: '2026-08-02', time: '09:00', title: 'ג' },
  ]);
  assert.deepEqual(sorted.map((i) => i.title), ['א', 'ג', 'ב']);
});

test('daily digest lists tomorrow hour by hour, from both calendars', () => {
  const text = formatDailyDigest('2026-08-02', [
    {
      date: '2026-08-02', time: '09:00', endTime: '14:00',
      title: 'טיול', location: 'נחל הבשור', source: 'wall',
    },
    {
      date: '2026-08-02', time: '17:30', endTime: '',
      title: 'רופא שיניים', location: '', source: 'google', calendarName: 'אישי',
    },
    { date: '2026-08-03', time: '10:00', title: 'יום אחר', source: 'wall' },
  ]);

  assert.match(text, /יום ראשון 2\.8/);
  assert.match(text, /09:00–14:00 · טיול \(נחל הבשור\)/);
  assert.match(text, /17:30 · רופא שיניים \(אישי\)/);
  assert.doesNotMatch(text, /יום אחר/);
});

test('daily digest says so plainly when tomorrow is empty', () => {
  assert.match(formatDailyDigest('2026-08-02', []), /יום פנוי/);
});

test('weekly digest gives one condensed line per day, including empty days', () => {
  const text = formatWeeklyDigest('2026-08-02', [
    { date: '2026-08-02', time: '09:00', title: 'טיול', source: 'wall' },
    { date: '2026-08-02', time: '17:30', title: 'רופא שיניים', source: 'google' },
    { date: '2026-08-03', time: '', allDay: true, title: 'שקד לגן', source: 'google' },
  ]);

  const lines = text.split('\n').filter(Boolean);
  assert.match(lines[0], /2\.8–8\.8/);
  assert.equal(lines[1], 'יום ראשון 2.8 — 09:00 טיול, 17:30 רופא שיניים');
  assert.equal(lines[2], 'יום שני 3.8 — שקד לגן');
  assert.equal(lines[3], 'יום שלישי 4.8 — פנוי');
  assert.equal(lines.length, 8); // header + 7 days
});

test('template flattening drops the newlines Meta rejects', () => {
  const flat = flattenForTemplate('כותרת\n\n09:00 · טיול\n17:30 · רופא');
  assert.equal(flat, 'כותרת | 09:00 · טיול | 17:30 · רופא');
  assert.doesNotMatch(flat, /\n/);
});

test('settings normalize bad times and weekdays instead of failing', () => {
  const s = normalizeAgendaSettings({
    dailyTime: '99:99', weeklyDay: 12, channel: 'carrier-pigeon', phone: ' 0501234567 ',
  });
  assert.equal(s.dailyTime, '20:00');
  assert.equal(s.weeklyDay, 6);
  assert.equal(s.channel, 'whatsapp');
  assert.equal(s.phone, '0501234567');
});

test('a digest already sent for tomorrow is not sent again after a restart', () => {
  const settings = normalizeAgendaSettings({
    dailyEnabled: true, weeklyEnabled: true, weeklyDay: 6, lastDailySentFor: '2026-08-02',
  });
  const at = { weekday: 6, time: '21:30', tomorrow: '2026-08-02' };
  assert.deepEqual(agendaDigestsDue(settings, at), { daily: false, weekly: true });
});

test('nothing is due before the configured evening hour', () => {
  const settings = normalizeAgendaSettings({ dailyEnabled: true, weeklyEnabled: true });
  assert.deepEqual(
    agendaDigestsDue(settings, { weekday: 6, time: '14:00', tomorrow: '2026-08-02' }),
    { daily: false, weekly: false }
  );
});

test('the weekly digest only fires on its own weekday', () => {
  const settings = normalizeAgendaSettings({ weeklyEnabled: true, weeklyDay: 6 });
  assert.equal(
    agendaDigestsDue(settings, { weekday: 3, time: '20:00', tomorrow: '2026-08-02' }).weekly,
    false
  );
});
