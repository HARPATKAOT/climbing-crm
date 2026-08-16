import test from 'node:test';
import assert from 'node:assert/strict';
import { openBotReviewTask, reviewTaskFingerprint, reviewTasksEnabled } from './botReviewTasks.js';
import { recordBotAction } from './botActivityLog.js';
import { capabilitySettingKey } from './botCapabilities.js';
import { TASKS_COLLECTION, TASK_OPEN } from './aiActions.js';

const TODAY = '2026-08-16';

/** Two collections — the journal and the tasks — keyed by name. */
function memoryDb(settings = {}) {
  const data = new Map();
  return {
    settings,
    getSettings: () => settings,
    get: (table) => (data.get(table) || []),
    insert: (table, row) => {
      const saved = { id: `${table}-${(data.get(table) || []).length + 1}`, ...row };
      data.set(table, [...(data.get(table) || []), saved]);
      return saved;
    },
  };
}

const tasks = (db) => db.get(TASKS_COLLECTION);

test('every change the bot makes opens one task for the team', () => {
  const db = memoryDb();
  recordBotAction(db, null, {
    type: 'status_changed',
    summary: 'נטע יאירי סומן כרשום לחוג לפי דיווח המתנ״ס',
    studentId: 's1',
    studentName: 'נטע יאירי',
  });
  assert.equal(tasks(db).length, 1);
  const [task] = tasks(db);
  assert.match(task.title, /לבדוק: שינוי סטטוס מתאמן — נטע יאירי/);
  assert.match(task.notes, /לפי דיווח המתנ״ס/);
  assert.equal(task.status, TASK_OPEN);
  assert.equal(task.source, 'bot_review');
  assert.equal(task.student_id, 's1');
  assert.equal(task.created_by, 'bot');
});

test('what the bot said is not a task; only what it changed', () => {
  const db = memoryDb();
  recordBotAction(db, null, { type: 'reply', summary: 'היי 🙂' });
  recordBotAction(db, null, { type: 'handoff', summary: 'מעביר לצוות' });
  recordBotAction(db, null, { type: 'followup_sent', summary: 'מעקב נשלח' });
  assert.equal(tasks(db).length, 0);

  recordBotAction(db, null, { type: 'placement', summary: 'רוני שובצה', studentId: 's2' });
  assert.equal(tasks(db).length, 1);
});

test('a burst on one trainee is one task, not five', () => {
  // A review queue that gets five rows out of one conversation reads as noise,
  // and then nobody reads it at all — the outcome these tasks exist to prevent.
  const db = memoryDb();
  for (let i = 0; i < 5; i += 1) {
    recordBotAction(db, null, { type: 'placement', summary: `ניסיון ${i}`, studentId: 's1' });
  }
  assert.equal(tasks(db).length, 1);

  // A different kind of change on the same trainee is its own check.
  recordBotAction(db, null, { type: 'status_changed', summary: 'סטטוס', studentId: 's1' });
  assert.equal(tasks(db).length, 2);

  // And so is the same change on somebody else.
  recordBotAction(db, null, { type: 'placement', summary: 'אחר', studentId: 's2' });
  assert.equal(tasks(db).length, 3);
});

test('the switch is on until it is turned off, and off means off', () => {
  assert.equal(reviewTasksEnabled({}), true);
  assert.equal(reviewTasksEnabled({ [capabilitySettingKey('review_tasks')]: false }), false);

  const db = memoryDb({ [capabilitySettingKey('review_tasks')]: false });
  recordBotAction(db, null, { type: 'placement', summary: 'שיבוץ', studentId: 's1' });
  assert.equal(tasks(db).length, 0);
});

test('a task that cannot be written never breaks the action that caused it', () => {
  const db = memoryDb();
  db.insert = (table) => {
    if (table === TASKS_COLLECTION) throw new Error('boom');
    return { id: 'x' };
  };
  assert.doesNotThrow(() => recordBotAction(db, null, {
    type: 'placement', summary: 'שיבוץ', studentId: 's1',
  }));
});

test('the fingerprint is the action, the person and the day', () => {
  const entry = { type: 'placement', studentId: 's1' };
  assert.equal(reviewTaskFingerprint(entry, TODAY), 'bot_review:placement:s1:2026-08-16');
  assert.notEqual(
    reviewTaskFingerprint(entry, TODAY),
    reviewTaskFingerprint(entry, '2026-08-17')
  );
  // No trainee on the row — the customer, and then the phone, stand in.
  assert.match(reviewTaskFingerprint({ type: 'details_saved', parentId: 'p9' }, TODAY), /:p9:/);
  assert.match(reviewTaskFingerprint({ type: 'centre_report', phone: '9725' }, TODAY), /:9725:/);
});

test('an already open task is reused rather than duplicated', () => {
  const db = memoryDb();
  const first = openBotReviewTask(db, null, { type: 'placement', studentId: 's1', summary: 'א' }, { today: TODAY });
  const second = openBotReviewTask(db, null, { type: 'placement', studentId: 's1', summary: 'ב' }, { today: TODAY });
  assert.equal(second.id, first.id);
  assert.equal(tasks(db).length, 1);
});
