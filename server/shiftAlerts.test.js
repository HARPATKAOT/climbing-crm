import test from 'node:test';
import assert from 'node:assert/strict';
import { dueShiftReminders, israelTimeToEpoch, whenLabel } from './shiftAlerts.js';

/** Only `get` is read by the scan. */
function fakeStore(tables = {}) {
  return { get: (name) => tables[name] || [] };
}

const EVENT_DAY = '2026-08-10';
const EVENT_START = israelTimeToEpoch(EVENT_DAY, '16:00');
const hoursBefore = (n) => new Date(EVENT_START - n * 3600000);

function storeWith({ employees, sends = [] } = {}) {
  return fakeStore({
    employees,
    automation_sends: sends,
    work_assignments: [
      {
        id: 'wo1',
        employee_id: 'e1',
        activity_id: 'ac1',
        date: EVENT_DAY,
        start_time: '16:00',
        end_time: '22:00',
        role: 'הפעלת קיר',
      },
    ],
    activities: [
      { id: 'ac1', name: 'יום הולדת', date: EVENT_DAY, start_time: '16:00', location: 'קיר בועז' },
    ],
  });
}

const subscriber = (extra = {}) => ({
  id: 'e1',
  name: 'מעוז',
  phone: '0501111111',
  alerts: ['shift_reminder'],
  ...extra,
});

test('a wall-clock time in Israel resolves through the summer offset', () => {
  // 16:00 IDT is 13:00 UTC.
  assert.equal(new Date(EVENT_START).toISOString(), '2026-08-10T13:00:00.000Z');
  // …and 16:00 in January is 14:00 UTC, standard time.
  assert.equal(
    new Date(israelTimeToEpoch('2026-01-10', '16:00')).toISOString(),
    '2026-01-10T14:00:00.000Z'
  );
});

test('the reminder waits for the lead time, then stops once the event began', () => {
  const store = storeWith({ employees: [subscriber()] });
  assert.equal(dueShiftReminders({ now: hoursBefore(25), store }).length, 0);
  assert.equal(dueShiftReminders({ now: hoursBefore(23), store }).length, 1);
  // Started an hour ago: a "reminder" now is only noise, and after a restart it
  // would fire for every event in the past.
  assert.equal(dueShiftReminders({ now: hoursBefore(-1), store }).length, 0);
});

test('each employee is reminded on their own lead time', () => {
  const store = fakeStore({
    employees: [
      subscriber(),
      { id: 'e2', name: 'חגי', phone: '0502222222', alerts: ['shift_reminder'], alert_settings: { shift_reminder: { lead_hours: 2 } } },
    ],
    work_assignments: [
      { id: 'wo1', employee_id: 'e1', activity_id: 'ac1', date: EVENT_DAY, start_time: '16:00' },
      { id: 'wo2', employee_id: 'e2', activity_id: 'ac1', date: EVENT_DAY, start_time: '16:00' },
    ],
    activities: [{ id: 'ac1', name: 'יום הולדת', date: EVENT_DAY, start_time: '16:00' }],
  });

  const dayBefore = dueShiftReminders({ now: hoursBefore(20), store });
  assert.deepEqual(dayBefore.map((d) => d.employee.id), ['e1']);

  const sameDay = dueShiftReminders({ now: hoursBefore(1), store });
  assert.deepEqual(sameDay.map((d) => d.employee.id).sort(), ['e1', 'e2']);
});

test('a reminder already sent is not sent again on the next tick', () => {
  const store = storeWith({
    employees: [subscriber()],
    sends: [{ id: 'sa-shift-reminder-wo1' }],
  });
  assert.equal(dueShiftReminders({ now: hoursBefore(5), store }).length, 0);
});

test('nobody subscribed, nobody archived, nobody reminded', () => {
  assert.equal(
    dueShiftReminders({ now: hoursBefore(5), store: storeWith({ employees: [subscriber({ alerts: [] })] }) }).length,
    0
  );
  assert.equal(
    dueShiftReminders({ now: hoursBefore(5), store: storeWith({ employees: [subscriber({ is_active: false })] }) }).length,
    0
  );
});

test('the message names the event, the day and the hours', () => {
  const [due] = dueShiftReminders({ now: hoursBefore(5), store: storeWith({ employees: [subscriber()] }) });
  assert.match(due.text, /יום הולדת/);
  assert.match(due.text, /16:00–22:00/);
  assert.match(due.text, /קיר בועז/);
  // Template variables keep their documented order.
  assert.deepEqual(due.variables, ['מעוז', 'יום הולדת', EVENT_DAY, '16:00']);
});

test('a day with no end time still reads as a date', () => {
  assert.equal(whenLabel({ date: '2026-08-10', start_time: '16:00' }), 'יום שני, 10.8 · 16:00');
});
