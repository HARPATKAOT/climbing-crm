import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntilActivity,
  healthExpiryReminderKind,
  runHealthExpiryReminders,
  runParticipationDocumentReminders,
  scheduledReminderKind,
  withinReminderHours,
} from './participationReminders.js';

function testDb(seed = {}) {
  const store = {
    activities: [{ id: 'activity-1', name: 'טיול', date: '2026-08-08' }],
    activity_registrations: [{
      id: 'registration-1',
      activity_id: 'activity-1',
      student_id: 'student-1',
      document_status: 'awaiting_documents',
      status: 'confirmed',
    }],
    participation_reminders: [],
    ...seed,
  };
  return {
    store,
    get: (table) => store[table] || [],
    insert: (table, row) => {
      store[table] ||= [];
      store[table].push(row);
      return row;
    },
  };
}

test('document reminders are due exactly three days and one day before', () => {
  const activity = { date: '2026-08-08' };
  const threeDays = new Date('2026-08-05T09:00:00+03:00');
  const oneDay = new Date('2026-08-07T09:00:00+03:00');
  assert.equal(daysUntilActivity(activity, threeDays), 3);
  assert.equal(scheduledReminderKind(activity, threeDays), 'three_days_before');
  assert.equal(scheduledReminderKind(activity, oneDay), 'one_day_before');
});

test('restart-safe reminder runner sends each scheduled reminder only once', async () => {
  const db = testDb();
  const persisted = [];
  const sent = [];
  const args = {
    db,
    persist: async (table, row) => persisted.push({ table, row }),
    send: async ({ registration, kind }) => {
      sent.push({ registration: registration.id, kind });
      return { sent: true, via: 'template' };
    },
    now: new Date('2026-08-05T09:00:00+03:00'),
  };

  const first = await runParticipationDocumentReminders(args);
  const second = await runParticipationDocumentReminders(args);

  assert.deepEqual(first, { candidates: 1, sent: 1, skipped: 0, failed: 0 });
  assert.deepEqual(second, { candidates: 1, sent: 0, skipped: 1, failed: 0 });
  assert.deepEqual(sent, [{ registration: 'registration-1', kind: 'three_days_before' }]);
  assert.equal(persisted.length, 1);
});

test('eligible, cancelled and completed registrations receive no reminder', async () => {
  const db = testDb({
    activity_registrations: [
      { id: 'eligible', activity_id: 'activity-1', document_status: 'eligible', status: 'confirmed' },
      { id: 'cancelled', activity_id: 'activity-1', document_status: 'awaiting_documents', status: 'cancelled' },
      { id: 'completed', activity_id: 'activity-1', document_status: 'awaiting_documents', status: 'completed' },
    ],
  });
  const result = await runParticipationDocumentReminders({
    db,
    send: async () => ({ sent: true }),
    now: new Date('2026-08-05T09:00:00+03:00'),
  });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});

test('a reminder that comes due overnight waits for the morning', async () => {
  // A parent's phone lit up at 00:37 about a summer camp: the scan runs every
  // hour around the clock, and nothing said a reminder has civil hours.
  assert.equal(withinReminderHours(new Date('2026-08-08T00:37:00+03:00')), false);
  assert.equal(withinReminderHours(new Date('2026-08-08T06:30:00+03:00')), false);
  assert.equal(withinReminderHours(new Date('2026-08-08T09:00:00+03:00')), true);
  assert.equal(withinReminderHours(new Date('2026-08-08T20:59:00+03:00')), true);
  assert.equal(withinReminderHours(new Date('2026-08-08T21:00:00+03:00')), false);

  const db = testDb();
  const sent = [];
  const night = await runParticipationDocumentReminders({
    db,
    send: async (payload) => { sent.push(payload); return { sent: true }; },
    now: new Date('2026-08-07T00:37:00+03:00'),
  });
  assert.equal(night.quiet_hours, true);
  assert.equal(sent.length, 0);
  assert.equal(db.get('participation_reminders').length, 0, 'nothing is marked as sent');

  // The same family is found again in the morning, and told then.
  const morning = await runParticipationDocumentReminders({
    db,
    send: async (payload) => { sent.push(payload); return { sent: true }; },
    now: new Date('2026-08-07T09:10:00+03:00'),
  });
  assert.equal(morning.sent, 1);
  assert.equal(sent.length, 1);
});

// A month's notice before 31 August, and only while the declaration still holds.
test('the health expiry window opens 30 days before, not earlier', () => {
  const at = (iso) => new Date(`${iso}T09:00:00+03:00`);
  assert.equal(healthExpiryReminderKind('2026-08-31', at('2026-07-31')), null);
  assert.equal(healthExpiryReminderKind('2026-08-31', at('2026-08-01')), 'health_expiry_2026-08-31');
  assert.equal(healthExpiryReminderKind('2026-08-31', at('2026-08-31')), 'health_expiry_2026-08-31');
  // The day after it lapsed is somebody else's problem: registration and
  // check-in already refuse an expired declaration.
  assert.equal(healthExpiryReminderKind('2026-08-31', at('2026-09-01')), null);
});

test('a student is told once per season, however often the scan runs', async () => {
  const db = testDb({
    students: [{ id: 'student-1', name: 'יעל', parentId: 'parent-1', status: 'active' }],
    participation_reminders: [],
  });
  const healthState = () => ({ valid: true, expiresAt: '2026-08-31' });
  const send = async () => ({ sent: true, via: 'whatsapp' });
  const now = new Date('2026-08-10T09:00:00+03:00');
  const first = await runHealthExpiryReminders({ db, send, healthState, now });
  const second = await runHealthExpiryReminders({ db, send, healthState, now });
  assert.deepEqual(first, { candidates: 1, sent: 1, skipped: 0, failed: 0 });
  assert.deepEqual(second, { candidates: 1, sent: 0, skipped: 1, failed: 0 });
  assert.equal(db.store.participation_reminders.length, 1);
  assert.equal(db.store.participation_reminders[0].kind, 'health_expiry_2026-08-31');
});

test('nothing is sent for a declaration that is not in force', async () => {
  const db = testDb({ students: [{ id: 'student-1', name: 'יעל', parentId: 'parent-1' }] });
  const result = await runHealthExpiryReminders({
    db,
    send: async () => ({ sent: true }),
    healthState: () => ({ valid: false, expiresAt: '2026-08-31' }),
    now: new Date('2026-08-10T09:00:00+03:00'),
  });
  assert.deepEqual(result, { candidates: 0, sent: 0, skipped: 0, failed: 0 });
});
