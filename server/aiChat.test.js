import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_ACTION_TYPES,
  READ_TOOLS,
  buildSystemPrompt,
  normalizeChatAction,
  runChatTurn,
  toolDeclarations,
} from './aiChat.js';
import {
  SUGGESTIONS_COLLECTION,
  SUGGESTION_PENDING,
  TASKS_COLLECTION,
  approveSuggestion,
} from './aiActions.js';

const TODAY = '2026-07-29';

function makeDb(seed = {}) {
  const tables = {
    parents: [
      { id: 'p1', name: 'מיכל לוי', phone: '972521234567', email: 'michal@gmail.com', status: 'active', notes: 'הערה ישנה' },
      { id: 'p2', name: 'דוד כהן', phone: '972549876543', status: 'lead_new' },
    ],
    students: [
      { id: 's1', name: 'עומרי לוי', parentId: 'p1', groupId: 'g1', status: 'registered' },
      { id: 's2', name: 'רוני כהן', parentId: 'p2', groupId: null, status: 'lead_new' },
    ],
    groups: [
      { id: 'g1', name: "ג'-ד' יום א׳", day: 0, time: '15:30', maxSlots: 2, ageCategory: "ג'-ד'", priceWeek: 280 },
      { id: 'g2', name: 'חטיבה יום ד׳', day: 3, time: '18:40', maxSlots: 12, ageCategory: 'חטיבה', priceWeek: 305 },
    ],
    enrollments: [{ id: 'e1', student_id: 's1', group_id: 'g1', status: 'active', price: 280 }],
    payments: [
      { id: 'pay1', parent_id: 'p1', amount: 280, status: 'paid', paid_at: '2026-07-10T10:00:00.000Z' },
      { id: 'pay2', parent_id: 'p2', amount: 150, status: 'pending', created_at: '2026-07-20T10:00:00.000Z' },
    ],
    activities: [
      {
        id: 'a1',
        name: 'יום הולדת',
        type: 'birthday',
        status: 'confirmed',
        date: '2026-08-02',
        price: 1200,
        max_participants: 2,
        registration_mode: 'paid_per_participant',
        price_includes_vat: true,
      },
      { id: 'a2', name: 'טיול סנפלינג', type: 'trip', status: 'confirmed', date: '2026-08-09', price: 0 },
    ],
    activity_registrations: [
      { id: 'ar1', activity_id: 'a1', parent_id: 'p1', participant_name: 'עומרי לוי', payment_status: 'paid', status: 'confirmed' },
    ],
    activity_interest: [],
    messages: [
      { id: 'm1', parent_id: 'p1', direction: 'inbound', message: 'יש מקום ביום שלישי?', created_at: '2026-07-27T09:00:00.000Z' },
    ],
    crm_tasks: [
      { id: 't1', title: 'לחזור למיכל', status: 'open', priority: 'normal', due_date: '2026-07-20', parent_id: 'p1' },
    ],
    [SUGGESTIONS_COLLECTION]: [],
    ...seed,
  };

  let counter = 0;
  return {
    tables,
    get: (table) => tables[table] || [],
    getOne: (table, id) => (tables[table] || []).find((row) => String(row.id) === String(id)),
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      counter += 1;
      const row = { ...record, id: record.id || `${table}-${counter}`, created_at: `${TODAY}T09:00:00.000Z` };
      tables[table].push(row);
      return row;
    },
    update: (table, id, patch) => {
      const list = tables[table] || [];
      const index = list.findIndex((row) => String(row.id) === String(id));
      if (index === -1) return null;
      list[index] = { ...list[index], ...patch };
      return list[index];
    },
    delete: (table, id) => {
      const list = tables[table] || [];
      const index = list.findIndex((row) => String(row.id) === String(id));
      if (index === -1) return false;
      list.splice(index, 1);
      return true;
    },
  };
}

const okPersist = async () => ({ ok: true });

/** מודל מזויף: מחזיר תסריט של תשובות, אחת לכל קריאה. */
function scriptedModel(steps) {
  const queue = [...steps];
  const seen = [];
  const call = async ({ contents }) => {
    seen.push(JSON.parse(JSON.stringify(contents)));
    const next = queue.shift();
    if (!next) return { content: null, error: 'model_error' };
    return { content: next, error: '' };
  };
  call.seen = seen;
  return call;
}

const modelText = (text) => ({ role: 'model', parts: [{ text }] });
const modelCall = (name, args) => ({ role: 'model', parts: [{ functionCall: { name, args } }] });

// ─── כלי קריאה ───────────────────────────────────────────────────────────────

test('search_customers מוצא לפי שם ילד וגם לפי טלפון', () => {
  const db = makeDb();
  const byChild = READ_TOOLS.search_customers(db, { query: 'עומרי' });
  assert.equal(byChild.total, 1);
  assert.equal(byChild.customers[0].parent_id, 'p1');
  assert.deepEqual(byChild.customers[0].students, ['עומרי לוי']);

  const byPhone = READ_TOOLS.search_customers(db, { query: '054-9876543' });
  assert.equal(byPhone.customers[0].parent_id, 'p2');
});

test('get_customer מחזיר כרטיס מלא, ושגיאה על מזהה שלא קיים', () => {
  const db = makeDb();
  const card = READ_TOOLS.get_customer(db, { parent_id: 'p1' });
  assert.equal(card.name, 'מיכל לוי');
  assert.equal(card.students.length, 1);
  assert.equal(card.students[0].group, "ג'-ד' יום א׳");
  assert.equal(card.enrollments[0].group, "ג'-ד' יום א׳");
  assert.equal(card.payments.length, 1);
  assert.equal(card.open_tasks[0].task_id, 't1');
  assert.equal(card.recent_messages[0].from, 'לקוח');

  assert.ok(READ_TOOLS.get_customer(db, { parent_id: 'nope' }).error);
});

test('get_student_attendance מדווח על האימון הראשון שאינו היכרות', () => {
  const db = makeDb({
    attendance: [
      { id: 'at1', student_id: 's1', group_id: 'g1', date: '2026-06-07', status: 'intro_attended' },
      { id: 'at2', student_id: 's1', group_id: 'g1', date: '2026-06-14', status: 'attended' },
      { id: 'at3', student_id: 's1', group_id: 'g1', date: '2026-06-21', status: 'absent' },
      { id: 'at4', student_id: 's2', group_id: 'g2', date: '2026-06-14', status: 'attended' },
    ],
  });
  const summary = READ_TOOLS.get_student_attendance(db, { student_id: 's1' });
  assert.equal(summary.name, 'עומרי לוי');
  assert.deepEqual(summary.intro_dates, ['2026-06-07']);
  assert.equal(summary.first_regular_training, '2026-06-14');
  assert.equal(summary.started_on, '2026-06-14');
  assert.equal(summary.attended_count, 1);
  assert.equal(summary.absent_count, 1);
  assert.equal(summary.consecutive_absences, 1);
  // שורות של מתאמן אחר לא נספרות
  assert.equal(summary.recent.length, 3);
});

test('get_student_attendance אומר במפורש כשאין שורות נוכחות', () => {
  const db = makeDb({ attendance: [] });
  const summary = READ_TOOLS.get_student_attendance(db, { student_id: 's1' });
  assert.equal(summary.started_on, null);
  assert.match(summary.note, /אין שורות נוכחות/);
  assert.ok(READ_TOOLS.get_student_attendance(db, { student_id: 'nope' }).error);
});

test('list_groups מחשב תפוסה בפועל ומסנן לפי יום', () => {
  const db = makeDb();
  const all = READ_TOOLS.list_groups(db, {});
  assert.equal(all.total, 2);
  const first = all.groups.find((row) => row.group_id === 'g1');
  assert.equal(first.enrolled, 1);
  assert.equal(first.spots_left, 1);
  assert.equal(first.day, 'ראשון');

  assert.equal(READ_TOOLS.list_groups(db, { day: 3 }).total, 1);
});

test('list_tasks מסמן משימה שעבר תאריך היעד שלה', () => {
  const db = makeDb();
  const open = READ_TOOLS.list_tasks(db, { today: TODAY });
  assert.equal(open.total, 1);
  assert.equal(open.tasks[0].overdue, true);
  assert.equal(open.tasks[0].customer, 'מיכל לוי');
  assert.equal(READ_TOOLS.list_tasks(db, { status: 'done', today: TODAY }).total, 0);
});

test('list_payments מסכם סכומים בטווח', () => {
  const db = makeDb();
  const july = READ_TOOLS.list_payments(db, { from: '2026-07-01', to: '2026-07-31' });
  assert.equal(july.count, 2);
  assert.equal(july.total_amount, 430);
  assert.equal(july.paid_amount, 280);
});

test('list_activities סופר נרשמים ומשלמים', () => {
  const db = makeDb();
  const result = READ_TOOLS.list_activities(db, { from: '2026-08-01', to: '2026-08-05' });
  assert.equal(result.total, 1);
  assert.equal(result.activities[0].registered, 1);
  assert.equal(result.activities[0].paid, 1);
});

test('business_snapshot מחזיר תפוסה והכנסות החודש', () => {
  const db = makeDb();
  const snap = READ_TOOLS.business_snapshot(db, { today: TODAY });
  assert.equal(snap.students, 2);
  assert.equal(snap.capacity, 14);
  assert.equal(snap.enrolled, 1);
  assert.equal(snap.open_tasks, 1);
  assert.equal(snap.overdue_tasks, 1);
  assert.equal(snap.paid_this_month, 280);
});

// ─── אימות פעולות כתיבה ──────────────────────────────────────────────────────

test('normalizeChatAction דוחה מזהה שהמודל המציא', () => {
  const db = makeDb();
  assert.throws(
    () => normalizeChatAction(db, 'create_task', { title: 'לבדוק משהו', parent_id: 'p-fake' }, { today: TODAY }),
    /parent_id לא קיים/
  );
  assert.throws(
    () => normalizeChatAction(db, 'update_task', { task_id: 't-fake', status: 'done' }, { today: TODAY }),
    /task_id לא קיים/
  );
  assert.throws(
    () => normalizeChatAction(db, 'add_customer_note', { parent_id: 'p9', note: 'שלום' }, { today: TODAY }),
    /parent_id לא קיים/
  );
});

test('normalizeChatAction שולף student_id מהכרטיס ולא מהמודל', () => {
  const db = makeDb();
  const action = normalizeChatAction(db, 'create_task', {
    title: 'לתאם שיעור ניסיון',
    parent_id: 'p1',
    student_name: 'עומרי לוי',
    due_date: '2026-08-05',
    priority: 'high',
  }, { today: TODAY });

  assert.equal(action.args.student_id, 's1');
  assert.equal(action.args.due_date, '2026-08-05');
  assert.equal(action.args.priority, 'high');
});

test('normalizeChatAction מתעלם משם מתאמן שאינו בכרטיס של אותו לקוח', () => {
  const db = makeDb();
  const action = normalizeChatAction(db, 'create_task', {
    title: 'לבדוק שיבוץ',
    parent_id: 'p1',
    student_name: 'רוני כהן',
  }, { today: TODAY });
  assert.equal(action.args.student_id, null);
});

test('normalizeChatAction דורש שיהיה מה לעדכן, וסוג פעולה מוכר', () => {
  const db = makeDb();
  assert.throws(() => normalizeChatAction(db, 'update_task', { task_id: 't1' }, { today: TODAY }), /אין מה לעדכן/);
  assert.throws(() => normalizeChatAction(db, 'delete_parent', {}, { today: TODAY }), /לא נתמך/);
});

// ─── לולאת השיחה ─────────────────────────────────────────────────────────────

test('שאלה: הכלי רץ, התוצאה חוזרת למודל, ולא נוצרת שום הצעה', async () => {
  const db = makeDb();
  const callModel = scriptedModel([
    modelCall('list_groups', { day: 0 }),
    modelText('בחוג של יום ראשון נשאר מקום אחד.'),
  ]);

  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'כמה מקומות פנויים ביום ראשון?' }],
    today: TODAY,
    callModel,
  });

  assert.equal(result.reason, 'ok');
  assert.equal(result.reply, 'בחוג של יום ראשון נשאר מקום אחד.');
  assert.deepEqual(result.tools_used, ['list_groups']);
  assert.equal(result.proposals.length, 0);
  assert.equal(db.get(SUGGESTIONS_COLLECTION).length, 0);

  // התוצאה של הכלי אכן הוזרמה חזרה למודל בקריאה השנייה.
  const secondCall = callModel.seen[1];
  const toolResult = secondCall.at(-1).parts[0].functionResponse;
  assert.equal(toolResult.name, 'list_groups');
  assert.equal(toolResult.response.groups[0].spots_left, 1);
});

test('משימה: כלי כתיבה לא נוגע ב-CRM — הוא רושם הצעה ממתינה', async () => {
  const db = makeDb();
  const callModel = scriptedModel([
    modelCall('search_customers', { query: 'מיכל' }),
    modelCall('create_task', { title: 'לחזור למיכל לגבי יום שלישי', parent_id: 'p1', reason: 'ביקשת' }),
    modelText('רשמתי הצעה למשימה, היא מחכה לאישור שלך.'),
  ]);

  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תפתח משימה לחזור למיכל' }],
    actor: 'dalak@example.com',
    today: TODAY,
    callModel,
  });

  assert.equal(result.reason, 'ok');
  assert.equal(result.proposals.length, 1);

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  assert.equal(suggestion.status, SUGGESTION_PENDING);
  assert.equal(suggestion.type, 'create_task');
  assert.equal(suggestion.args.parent_id, 'p1');
  assert.equal(suggestion.source.kind, 'chat');
  assert.equal(suggestion.source.actor, 'dalak@example.com');
  // הדבר החשוב: המשימה עצמה עדיין לא קיימת.
  assert.equal(db.get(TASKS_COLLECTION).filter((row) => row.source === 'ai_suggestion').length, 0);
});

test('אישור הצעה מהשיחה יוצר את המשימה בפועל', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תפתח משימה' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('create_task', { title: 'לבדוק ציוד לקבוצת חטיבה', priority: 'high' }),
      modelText('ההצעה ממתינה לאישור.'),
    ]),
  });

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  const { task } = await approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' });

  assert.equal(task.title, 'לבדוק ציוד לקבוצת חטיבה');
  assert.equal(task.priority, 'high');
  assert.equal(task.status, 'open');
  assert.equal(db.get(SUGGESTIONS_COLLECTION)[0].status, 'approved');
});

test('אישור update_task מעדכן את המשימה הקיימת ולא יוצר חדשה', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תסגור את המשימה של מיכל' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('update_task', { task_id: 't1', status: 'done' }),
      modelText('ההצעה ממתינה לאישור.'),
    ]),
  });

  const before = db.get('crm_tasks').length;
  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  const result = await approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' });

  assert.equal(result.task, null);
  assert.equal(result.applied.status, 'done');
  assert.equal(db.get('crm_tasks').length, before);
  assert.equal(db.get('crm_tasks').find((row) => row.id === 't1').status, 'done');
});

test('אישור add_customer_note מוסיף שורה ולא דורס את ההערות הקיימות', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תרשום שהיא ביקשה לעבור ליום ד' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('add_customer_note', { parent_id: 'p1', note: 'ביקשה לעבור ליום רביעי' }),
      modelText('ההצעה ממתינה לאישור.'),
    ]),
  });

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  await approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' });

  const notes = db.get('parents').find((row) => row.id === 'p1').notes;
  assert.match(notes, /הערה ישנה/);
  assert.match(notes, /ביקשה לעבור ליום רביעי/);
});

test('כלי כתיבה שנכשל מחזיר שגיאה למודל ולא מפיל את השיחה', async () => {
  const db = makeDb();
  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תפתח משימה ללקוח שלא קיים' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('create_task', { title: 'לבדוק משהו', parent_id: 'p-fake' }),
      modelText('לא מצאתי את הלקוח הזה.'),
    ]),
  });

  assert.equal(result.reason, 'ok');
  assert.equal(result.proposals.length, 0);
  assert.equal(db.get(SUGGESTIONS_COLLECTION).length, 0);
  assert.equal(result.reply, 'לא מצאתי את הלקוח הזה.');
});

test('כלי לא מוכר לא מבוצע ולא מפיל את השיחה', async () => {
  const db = makeDb();
  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תמחק את כל הלקוחות' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('delete_all_parents', {}),
      modelText('אין לי אפשרות כזו.'),
    ]),
  });

  assert.equal(result.reply, 'אין לי אפשרות כזו.');
  assert.equal(db.get('parents').length, 2);
});

test('כישלון מודל מוחזר כ-reason ולא כחריגה', async () => {
  const db = makeDb();
  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'שאלה' }],
    today: TODAY,
    callModel: async () => ({ content: null, error: 'quota' }),
  });
  assert.equal(result.reason, 'quota');
  assert.equal(result.reply, '');
});

test('לולאה שלא מתכנסת נעצרת ומחזירה max_steps', async () => {
  const db = makeDb();
  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'שאלה' }],
    today: TODAY,
    maxSteps: 3,
    callModel: async () => ({ content: modelCall('list_groups', {}), error: '' }),
  });
  assert.equal(result.reason, 'max_steps');
  assert.equal(result.model_calls, 3);
});

test('מכסת פעולות בתור אחד נאכפת בקוד', async () => {
  const db = makeDb();
  const flood = { role: 'model', parts: Array.from({ length: 7 }, (_, i) => ({
    functionCall: { name: 'create_task', args: { title: `משימה מספר ${i + 1}` } },
  })) };

  const result = await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תפתח המון משימות' }],
    today: TODAY,
    callModel: scriptedModel([flood, modelText('נרשמו הצעות.')]),
  });

  assert.equal(result.proposals.length, 5);
  assert.equal(db.get(SUGGESTIONS_COLLECTION).length, 5);
});

test('כשל בשמירה דורבילית לא משאיר הצעה מקומית', async () => {
  const db = makeDb();
  const result = await runChatTurn({
    db,
    persist: async () => ({ ok: false, error: 'supabase down' }),
    messages: [{ role: 'user', content: 'תפתח משימה' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('create_task', { title: 'משימה כלשהי' }),
      modelText('לא הצלחתי לשמור.'),
    ]),
  });

  assert.equal(result.proposals.length, 0);
  assert.equal(db.get(SUGGESTIONS_COLLECTION).length, 0);
});

// ─── שיבוץ ורישום לאירוע ─────────────────────────────────────────────────────

test('get_activity מחזיר רשומים, מתעניינים ומקומות שנשארו', () => {
  const db = makeDb();
  const activity = READ_TOOLS.get_activity(db, { activity_id: 'a1' });
  assert.equal(activity.name, 'יום הולדת');
  assert.equal(activity.registered.length, 1);
  assert.equal(activity.registered[0].customer, 'מיכל לוי');
  assert.equal(activity.spots_left, 1);
  assert.deepEqual(activity.interested, []);

  // בלי תקרה מוגדרת spots_left הוא null, לא 0 — ההבדל קובע אם אפשר לרשום.
  assert.equal(READ_TOOLS.get_activity(db, { activity_id: 'a2' }).spots_left, null);
  assert.ok(READ_TOOLS.get_activity(db, { activity_id: 'nope' }).error);
});

test('שיבוץ כמתעניין: לא דורש לקוח, ולא תופס מקום', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תשבץ את רוני ליום הולדת' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('add_activity_interest', { activity_id: 'a1', parent_id: 'p2', student_name: 'רוני כהן' }),
      modelText('שובץ, ממתין לאישור.'),
    ]),
  });

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  assert.equal(suggestion.type, 'add_activity_interest');
  assert.equal(suggestion.args.student_id, 's2');
  assert.match(suggestion.label, /שיבוץ רוני כהן כמתעניין ב-יום הולדת/);

  const before = READ_TOOLS.get_activity(db, { activity_id: 'a1' }).spots_left;
  await approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' });

  const after = READ_TOOLS.get_activity(db, { activity_id: 'a1' });
  assert.equal(after.spots_left, before, 'מתעניין לא אמור לתפוס מקום');
  assert.equal(after.interested.length, 1);
  assert.equal(after.interested[0].name, 'רוני כהן');
});

test('רישום מלא תופס מקום ויוצר חיוב לפי מחיר האירוע', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תרשום את רוני ליום הולדת' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('register_to_activity', { activity_id: 'a1', parent_id: 'p2', student_name: 'רוני כהן' }),
      modelText('ממתין לאישור.'),
    ]),
  });

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  assert.match(suggestion.label, /רישום רוני כהן ל-יום הולדת .* · 1 מקומות פנויים כרגע/);

  const registration = (await approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' })).applied;
  assert.equal(registration.participant_name, 'רוני כהן');
  assert.equal(registration.parent_id, 'p2');
  assert.equal(registration.student_id, 's2');
  assert.equal(registration.amount, 1200);
  assert.match(registration.notes, /נרשם על ידי הסוכן \(me\)/);
  assert.equal(READ_TOOLS.get_activity(db, { activity_id: 'a1' }).spots_left, 0);
});

test('רישום מחייב לקוח — שיבוץ כמתעניין לא', () => {
  const db = makeDb();
  assert.throws(
    () => normalizeChatAction(db, 'register_to_activity', { activity_id: 'a1', participant_name: 'אורח' }, { today: TODAY }),
    /מחייב parent_id/
  );
  const interest = normalizeChatAction(db, 'add_activity_interest', {
    activity_id: 'a1', participant_name: 'אורח מהאינסטגרם',
  }, { today: TODAY });
  assert.equal(interest.args.parent_id, null);
  assert.equal(interest.args.participant_name, 'אורח מהאינסטגרם');
});

test('אירוע מלא נחסם כבר בשלב ההצעה', () => {
  const db = makeDb({
    activity_registrations: [
      { id: 'ar1', activity_id: 'a1', parent_id: 'p1', status: 'confirmed' },
      { id: 'ar2', activity_id: 'a1', parent_id: 'p1', status: 'confirmed' },
    ],
  });
  assert.throws(
    () => normalizeChatAction(db, 'register_to_activity', { activity_id: 'a1', parent_id: 'p2' }, { today: TODAY }),
    /אין מקומות פנויים/
  );
});

test('מקום אחרון שנתפס בין ההצעה לאישור חוסם את האישור', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תרשום את רוני' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('register_to_activity', { activity_id: 'a1', parent_id: 'p2' }),
      modelText('ממתין לאישור.'),
    ]),
  });

  // בינתיים מישהו נרשם בדף הציבורי ותפס את המקום האחרון.
  db.insert('activity_registrations', { activity_id: 'a1', parent_id: 'p1', status: 'confirmed' });

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  await assert.rejects(
    approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' }),
    /אין מקומות פנויים/
  );
  assert.equal(db.get(SUGGESTIONS_COLLECTION)[0].status, SUGGESTION_PENDING, 'הצעה שנכשלה נשארת ממתינה');
});

test('סטטוס תשלום לא מוכר נדחה ולא נופל בשקט ל"שולם"', () => {
  const db = makeDb();
  // 'unpaid' אינו באוצר המילים של ההרשמות. אם הוא עובר הלאה, ברירת המחדל של
  // אירוע בתשלום היא "שולם" — כלומר מישהו שלא שילם מסומן כמשלם.
  assert.throws(
    () => normalizeChatAction(db, 'register_to_activity', {
      activity_id: 'a1', parent_id: 'p2', payment_status: 'unpaid',
    }, { today: TODAY }),
    /סטטוס תשלום לא חוקי/
  );

  const ok = normalizeChatAction(db, 'register_to_activity', {
    activity_id: 'a1', parent_id: 'p2', payment_status: 'pending',
  }, { today: TODAY });
  assert.equal(ok.args.payment_status, 'pending');
  assert.match(ok.label, /טרם שולם/);
});

test('רישום בסטטוס "טרם שולם" לא מסומן כמשולם', async () => {
  const db = makeDb();
  await runChatTurn({
    db,
    persist: okPersist,
    messages: [{ role: 'user', content: 'תרשום את רוני, הוא עוד לא שילם' }],
    today: TODAY,
    callModel: scriptedModel([
      modelCall('register_to_activity', {
        activity_id: 'a1', parent_id: 'p2', student_name: 'רוני כהן', payment_status: 'pending',
      }),
      modelText('ממתין לאישור.'),
    ]),
  });

  const suggestion = db.get(SUGGESTIONS_COLLECTION)[0];
  const registration = (await approveSuggestion({ db, persist: okPersist, id: suggestion.id, actor: 'me' })).applied;
  assert.equal(registration.payment_status, 'pending');
  assert.equal(registration.paid_at, null);
});

test('שם מתאמן שאינו בכרטיס הלקוח נדחה בשיבוץ לאירוע', () => {
  const db = makeDb();
  assert.throws(
    () => normalizeChatAction(db, 'add_activity_interest', {
      activity_id: 'a1', parent_id: 'p1', student_name: 'ילד שהומצא',
    }, { today: TODAY }),
    /אינו מתאמן בכרטיס של הלקוח הזה/
  );
});

test('activity_id שהומצא נדחה', () => {
  const db = makeDb();
  assert.throws(
    () => normalizeChatAction(db, 'add_activity_interest', { activity_id: 'a-fake', parent_id: 'p1' }, { today: TODAY }),
    /activity_id לא קיים/
  );
});

// ─── חוזה מול המודל ──────────────────────────────────────────────────────────

test('כל כלי מוצהר קיים בפועל, וכל כלי כתיבה מוצהר', () => {
  const declared = toolDeclarations().map((row) => row.name);
  const implemented = [...Object.keys(READ_TOOLS), ...CHAT_ACTION_TYPES];
  assert.deepEqual([...declared].sort(), [...implemented].sort());
});

test('הפרומפט אומר במפורש שכלי כתיבה לא מבצע', () => {
  const prompt = buildSystemPrompt({ today: TODAY, brandName: 'קיר בועז' });
  assert.match(prompt, /קיר בועז/);
  assert.match(prompt, new RegExp(TODAY));
  assert.match(prompt, /ממתינה לאישור/);
});
