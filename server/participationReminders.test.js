import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntilActivity,
  runParticipationDocumentReminders,
  scheduledReminderKind,
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
