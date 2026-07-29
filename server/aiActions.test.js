import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_SCENARIOS,
  SCENARIOS_COLLECTION,
  SETTINGS_COLLECTION,
  SETTINGS_ID,
  SUGGESTIONS_COLLECTION,
  SUGGESTION_APPROVED,
  SUGGESTION_PENDING,
  SUGGESTION_REJECTED,
  TASKS_COLLECTION,
  TASK_DONE,
  TASK_OPEN,
  analysisAllowed,
  buildAnalysisPrompt,
  callGeminiActions,
  createScenario,
  deleteScenario,
  ensureDefaultScenarios,
  listScenarios,
  loadAssistantSettings,
  saveAssistantSettings,
  scenarioStats,
  selectSweepCandidates,
  updateScenario,
  analyzeConversation,
  approveSuggestion,
  createTask,
  enrichForDisplay,
  isDuplicateSuggestion,
  listSuggestions,
  listTasks,
  matchStudentByName,
  normalizeDueDate,
  normalizeSuggestion,
  parseModelJson,
  rejectSuggestion,
  resetAnalysisCooldown,
  suggestionFingerprint,
  suggestionsAutoEnabled,
  updateTask,
} from './aiActions.js';

const TODAY = '2026-07-28';

const SCENARIO = {
  id: 'sc-test',
  name: 'שאלה שלא נענתה',
  instruction: 'שאלה של הלקוח שהצוות לא ענה עליה.',
  enabled: true,
  action_type: 'create_task',
  default_priority: 'normal',
  default_due_days: 2,
  min_confidence: null,
  is_builtin: false,
  sort_order: 10,
};

/** Minimal in-memory stand-in for the db facade used by the service. */
function makeDb(seed = {}) {
  const tables = {
    parents: [],
    students: [],
    [SUGGESTIONS_COLLECTION]: [],
    [TASKS_COLLECTION]: [],
    [SCENARIOS_COLLECTION]: [{ ...SCENARIO }],
    [SETTINGS_COLLECTION]: [],
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
      const row = {
        ...record,
        id: record.id || `${table}-${counter}`,
        created_at: record.created_at || `${TODAY}T09:00:00.000Z`,
      };
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

function modelReturning(payload) {
  return async () => (typeof payload === 'string' ? payload : JSON.stringify(payload));
}

const baseAction = {
  type: 'create_task',
  scenario_id: 'sc-test',
  title: 'לחזור למשפחת כהן לגבי שיבוץ',
  reason: 'ההורה שאל אם יש מקום ביום שלישי ולא נענה',
  confidence: 0.85,
};

/** Every normalize test needs the active-scenario whitelist in context. */
const ctx = (extra = {}) => ({ today: TODAY, scenarios: [SCENARIO], ...extra });

// ─── פירוק פלט המודל ─────────────────────────────────────────────────────────

test('parseModelJson reads plain, fenced and noisy model output', () => {
  assert.deepEqual(parseModelJson('{"actions":[]}'), { actions: [] });
  assert.deepEqual(parseModelJson('```json\n{"actions":[]}\n```'), { actions: [] });
  assert.deepEqual(parseModelJson('בבקשה:\n{"actions":[]}\nבהצלחה'), { actions: [] });
});

test('parseModelJson returns null instead of throwing on junk', () => {
  assert.equal(parseModelJson(''), null);
  assert.equal(parseModelJson('אין לי מה להציע'), null);
  assert.equal(parseModelJson('{"actions": [oops}'), null);
});

// ─── אימות תאריך יעד ─────────────────────────────────────────────────────────

test('normalizeDueDate accepts a real date inside the window', () => {
  assert.equal(normalizeDueDate('2026-08-05', { today: TODAY }), '2026-08-05');
});

test('normalizeDueDate pulls a past date up to today', () => {
  assert.equal(normalizeDueDate('2026-01-01', { today: TODAY }), TODAY);
});

test('normalizeDueDate rejects impossible and malformed dates', () => {
  assert.equal(normalizeDueDate('2026-02-31', { today: TODAY }), null);
  assert.equal(normalizeDueDate('מחר', { today: TODAY }), null);
  assert.equal(normalizeDueDate('05/08/2026', { today: TODAY }), null);
  assert.equal(normalizeDueDate('', { today: TODAY }), null);
});

test('normalizeDueDate drops a date beyond the allowed window', () => {
  assert.equal(normalizeDueDate('2027-06-01', { today: TODAY }), null);
});

// ─── אימות הצעה ──────────────────────────────────────────────────────────────

test('normalizeSuggestion drops action types outside the whitelist', () => {
  assert.equal(normalizeSuggestion({ ...baseAction, type: 'set_status' }, ctx()), null);
  assert.equal(normalizeSuggestion({ ...baseAction, type: 'delete_student' }, ctx()), null);
});

test('normalizeSuggestion drops a scenario the model was never offered', () => {
  assert.equal(normalizeSuggestion({ ...baseAction, scenario_id: 'sc-invented' }, ctx()), null);
  assert.equal(normalizeSuggestion({ ...baseAction, scenario_id: '' }, ctx()), null);
  const { scenario_id, ...noScenario } = baseAction;
  assert.equal(normalizeSuggestion(noScenario, ctx()), null);
});

test('normalizeSuggestion drops a scenario that is switched off', () => {
  // רק תרחישים פעילים נכנסים להקשר — כיבוי במסך מסיר את ההיתר.
  assert.equal(normalizeSuggestion(baseAction, ctx({ scenarios: [] })), null);
});

test('normalizeSuggestion stamps the scenario it came from', () => {
  const normalized = normalizeSuggestion(baseAction, ctx());
  assert.equal(normalized.scenario_id, 'sc-test');
  assert.equal(normalized.scenario_name, 'שאלה שלא נענתה');
});

test('normalizeSuggestion drops low confidence and empty titles', () => {
  assert.equal(normalizeSuggestion({ ...baseAction, confidence: 0.3 }, ctx()), null);
  assert.equal(normalizeSuggestion({ ...baseAction, confidence: 'גבוה' }, ctx()), null);
  assert.equal(normalizeSuggestion({ ...baseAction, title: '  ' }, ctx()), null);
});

test('a scenario confidence floor overrides the global one', () => {
  const strict = { ...SCENARIO, min_confidence: 0.9 };
  assert.equal(normalizeSuggestion(baseAction, ctx({ scenarios: [strict] })), null);
  assert.ok(normalizeSuggestion({ ...baseAction, confidence: 0.95 }, ctx({ scenarios: [strict] })));
  // הסף הגלובלי נשאר רלוונטי לתרחיש בלי סף משלו
  assert.equal(normalizeSuggestion(baseAction, ctx({ minConfidence: 0.9 })), null);
  assert.ok(normalizeSuggestion(baseAction, ctx({ minConfidence: 0.5 })));
});

test('the scenario supplies the due date when the model gives none', () => {
  const normalized = normalizeSuggestion(baseAction, ctx());
  assert.equal(normalized.args.due_date, '2026-07-30', 'today + default_due_days');
});

test('a valid date from the model beats the scenario default', () => {
  const normalized = normalizeSuggestion({ ...baseAction, due_date: '2026-08-20' }, ctx());
  assert.equal(normalized.args.due_date, '2026-08-20');
});

test('a scenario without a default due date leaves the task undated', () => {
  const undated = { ...SCENARIO, default_due_days: null };
  const normalized = normalizeSuggestion({ ...baseAction, due_date: 'מתישהו' }, ctx({ scenarios: [undated] }));
  assert.equal(normalized.args.due_date, null);
});

test('the scenario supplies the priority when the model gives none', () => {
  const urgent = { ...SCENARIO, default_priority: 'high' };
  const { priority, ...noPriority } = baseAction;
  assert.equal(normalizeSuggestion(noPriority, ctx({ scenarios: [urgent] })).args.priority, 'high');
});

test('normalizeSuggestion takes ids from context, never from the model', () => {
  const normalized = normalizeSuggestion(
    { ...baseAction, parent_id: 'p-injected', student_id: 's-injected', student_name: 'נועה' },
    ctx({ parentId: 'p1', students: [{ id: 's1', name: 'נועה כהן' }] })
  );
  assert.equal(normalized.args.parent_id, 'p1');
  assert.equal(normalized.args.student_id, 's1');
  assert.equal(normalized.args.student_name, 'נועה כהן');
});

test('normalizeSuggestion leaves student empty when the name is not on the card', () => {
  const normalized = normalizeSuggestion(
    { ...baseAction, student_name: 'ילד שלא קיים' },
    ctx({ parentId: 'p1', students: [{ id: 's1', name: 'נועה כהן' }] })
  );
  assert.equal(normalized.args.student_id, null);
});

test('matchStudentByName matches a first name against the full name on the card', () => {
  const students = [{ id: 's1', name: 'נועה כהן' }];
  assert.equal(matchStudentByName(students, 'נועה')?.id, 's1');
  assert.equal(matchStudentByName(students, ''), null);
});

// ─── מניעת כפילויות ──────────────────────────────────────────────────────────

test('suggestionFingerprint ignores case, spacing and trailing punctuation', () => {
  const a = suggestionFingerprint({ type: 'create_task', parentId: 'p1', title: 'לחזור  להורה!' });
  const b = suggestionFingerprint({ type: 'create_task', parentId: 'p1', title: 'לחזור להורה' });
  assert.equal(a, b);
});

test('isDuplicateSuggestion catches a pending twin and a recent open task', () => {
  const fingerprint = suggestionFingerprint({ type: 'create_task', parentId: 'p1', title: 'לחזור להורה' });
  const withPending = makeDb({
    [SUGGESTIONS_COLLECTION]: [{ id: 'x1', status: SUGGESTION_PENDING, fingerprint }],
  });
  assert.equal(isDuplicateSuggestion(withPending, fingerprint, { today: TODAY }), true);

  const withTask = makeDb({
    [TASKS_COLLECTION]: [{ id: 't1', status: TASK_OPEN, fingerprint, created_at: `${TODAY}T08:00:00.000Z` }],
  });
  assert.equal(isDuplicateSuggestion(withTask, fingerprint, { today: TODAY }), true);
});

test('isDuplicateSuggestion allows a repeat after the task was closed or aged out', () => {
  const fingerprint = suggestionFingerprint({ type: 'create_task', parentId: 'p1', title: 'לחזור להורה' });
  const closed = makeDb({
    [TASKS_COLLECTION]: [{ id: 't1', status: TASK_DONE, fingerprint, created_at: `${TODAY}T08:00:00.000Z` }],
  });
  assert.equal(isDuplicateSuggestion(closed, fingerprint, { today: TODAY }), false);

  const stale = makeDb({
    [TASKS_COLLECTION]: [{ id: 't1', status: TASK_OPEN, fingerprint, created_at: '2026-06-01T08:00:00.000Z' }],
  });
  assert.equal(isDuplicateSuggestion(stale, fingerprint, { today: TODAY }), false);

  const rejected = makeDb({
    [SUGGESTIONS_COLLECTION]: [{ id: 'x1', status: SUGGESTION_REJECTED, fingerprint }],
  });
  assert.equal(isDuplicateSuggestion(rejected, fingerprint, { today: TODAY }), false);
});

// ─── ניתוח שיחה ──────────────────────────────────────────────────────────────

const analyzeArgs = (db, callModel, extra = {}) => ({
  db,
  persist: okPersist,
  parent: { id: 'p1', name: 'רונית כהן', phone: '972501234567' },
  students: [{ id: 's1', name: 'נועה כהן' }],
  history: ['לקוח: יש מקום ביום שלישי?', 'בוט: אבדוק ואחזור אליך'],
  cardContext: 'הורה: רונית כהן',
  today: TODAY,
  callModel,
  ...extra,
});

test('analyzeConversation stores a pending suggestion and changes nothing else', async () => {
  const db = makeDb();
  const result = await analyzeConversation(analyzeArgs(db, modelReturning({ actions: [baseAction] })));

  assert.equal(result.created.length, 1);
  assert.equal(result.reason, 'ok');
  const [row] = db.tables[SUGGESTIONS_COLLECTION];
  assert.equal(row.status, SUGGESTION_PENDING);
  assert.equal(row.args.parent_id, 'p1');
  assert.equal(row.created_by, 'ai');
  assert.ok(row.source.excerpt.includes('יש מקום ביום שלישי'));
  assert.equal(db.tables[TASKS_COLLECTION].length, 0, 'no task before approval');
});

test('analyzeConversation returns empty on an empty action list', async () => {
  const db = makeDb();
  const result = await analyzeConversation(analyzeArgs(db, modelReturning({ actions: [] })));
  assert.equal(result.created.length, 0);
  assert.equal(result.reason, 'nothing_actionable');
  assert.equal(db.tables[SUGGESTIONS_COLLECTION].length, 0);
});

test('analyzeConversation survives a dead or babbling model', async () => {
  const db = makeDb();
  assert.equal((await analyzeConversation(analyzeArgs(db, async () => null))).reason, 'no_model_output');
  assert.equal((await analyzeConversation(analyzeArgs(db, modelReturning('אין לי מושג')))).reason, 'unparsable');

  const thrower = async () => { throw new Error('HTTP 500'); };
  assert.equal((await analyzeConversation(analyzeArgs(db, thrower))).reason, 'model_error');
  assert.equal(db.tables[SUGGESTIONS_COLLECTION].length, 0);
});

test('analyzeConversation skips a suggestion it already made', async () => {
  const db = makeDb();
  const model = modelReturning({ actions: [baseAction] });
  await analyzeConversation(analyzeArgs(db, model));
  const second = await analyzeConversation(analyzeArgs(db, model));

  assert.equal(second.created.length, 0);
  assert.equal(second.skipped, 1);
  assert.equal(db.tables[SUGGESTIONS_COLLECTION].length, 1);
});

test('analyzeConversation caps how many suggestions one run may create', async () => {
  const db = makeDb();
  const actions = ['אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש'].map((n) => ({ ...baseAction, title: `לחזור להורה ${n}` }));
  const result = await analyzeConversation(analyzeArgs(db, modelReturning({ actions }), { maxActions: 3 }));

  assert.equal(result.created.length, 3);
  assert.equal(result.skipped, 2);
});

test('analyzeConversation does not call the model without conversation history', async () => {
  const db = makeDb();
  let called = false;
  const result = await analyzeConversation(analyzeArgs(db, async () => { called = true; return null; }, { history: [] }));
  assert.equal(called, false);
  assert.equal(result.reason, 'no_history');
});

// ─── אישור ודחייה ────────────────────────────────────────────────────────────

async function seedPendingSuggestion() {
  const db = makeDb({ parents: [{ id: 'p1', name: 'רונית כהן', phone: '972501234567' }] });
  await analyzeConversation(analyzeArgs(db, modelReturning({
    actions: [{ ...baseAction, due_date: '2026-08-04', priority: 'high' }],
  })));
  return { db, suggestion: db.tables[SUGGESTIONS_COLLECTION][0] };
}

test('approveSuggestion is what turns a suggestion into a task', async () => {
  const { db, suggestion } = await seedPendingSuggestion();
  const { task, suggestion: updated } = await approveSuggestion({
    db, persist: okPersist, id: suggestion.id, actor: 'staff@crm.test',
  });

  assert.equal(task.title, baseAction.title);
  assert.equal(task.status, TASK_OPEN);
  assert.equal(task.priority, 'high');
  assert.equal(task.due_date, '2026-08-04');
  assert.equal(task.parent_id, 'p1');
  assert.equal(task.source, 'ai_suggestion');
  assert.equal(task.suggestion_id, suggestion.id);

  assert.equal(updated.status, SUGGESTION_APPROVED);
  assert.equal(updated.reviewed_by, 'staff@crm.test');
  assert.equal(updated.applied_task_id, task.id);
});

test('a suggestion cannot be approved twice', async () => {
  const { db, suggestion } = await seedPendingSuggestion();
  await approveSuggestion({ db, persist: okPersist, id: suggestion.id });
  await assert.rejects(
    () => approveSuggestion({ db, persist: okPersist, id: suggestion.id }),
    /כבר טופלה/
  );
  assert.equal(db.tables[TASKS_COLLECTION].length, 1);
});

test('rejectSuggestion closes it without creating a task', async () => {
  const { db, suggestion } = await seedPendingSuggestion();
  const updated = await rejectSuggestion({
    db, persist: okPersist, id: suggestion.id, actor: 'staff@crm.test', note: 'כבר טופל בטלפון',
  });

  assert.equal(updated.status, SUGGESTION_REJECTED);
  assert.equal(updated.review_note, 'כבר טופל בטלפון');
  assert.equal(db.tables[TASKS_COLLECTION].length, 0);
  assert.equal(listSuggestions(db, { status: SUGGESTION_PENDING }).length, 0);
});

test('a missing suggestion id is a 404, not a crash', async () => {
  const db = makeDb();
  await assert.rejects(() => approveSuggestion({ db, persist: okPersist, id: 'nope' }), (err) => err.status === 404);
  await assert.rejects(() => rejectSuggestion({ db, persist: okPersist, id: 'nope' }), (err) => err.status === 404);
});

test('a failed durable write fails the approval', async () => {
  const { db, suggestion } = await seedPendingSuggestion();
  const failing = async () => ({ ok: false, error: 'supabase down' });
  await assert.rejects(
    () => approveSuggestion({ db, persist: failing, id: suggestion.id }),
    (err) => err.status === 503
  );
  assert.equal(db.tables[SUGGESTIONS_COLLECTION][0].status, SUGGESTION_PENDING, 'stays pending for a retry');
});

// ─── משימות ──────────────────────────────────────────────────────────────────

test('createTask validates the title and normalizes the due date', async () => {
  const db = makeDb();
  await assert.rejects(() => createTask({ db, persist: okPersist, input: { title: 'א' } }), (err) => err.status === 400);

  const task = await createTask({
    db, persist: okPersist, input: { title: 'להתקשר להורה', due_date: 'מחר', priority: 'high' },
  });
  assert.equal(task.due_date, null);
  assert.equal(task.priority, 'high');
  assert.equal(task.source, 'manual');
});

test('updateTask stamps completion and clears it on reopen', async () => {
  const db = makeDb();
  const task = await createTask({ db, persist: okPersist, input: { title: 'להתקשר להורה' } });

  const done = await updateTask({ db, persist: okPersist, id: task.id, patch: { status: TASK_DONE }, actor: 'staff@crm.test' });
  assert.equal(done.status, TASK_DONE);
  assert.ok(done.completed_at);
  assert.equal(done.completed_by, 'staff@crm.test');

  const reopened = await updateTask({ db, persist: okPersist, id: task.id, patch: { status: TASK_OPEN } });
  assert.equal(reopened.completed_at, null);
});

test('updateTask refuses an unknown status', async () => {
  const db = makeDb();
  const task = await createTask({ db, persist: okPersist, input: { title: 'להתקשר להורה' } });
  await assert.rejects(
    () => updateTask({ db, persist: okPersist, id: task.id, patch: { status: 'בוצע חלקית' } }),
    (err) => err.status === 400
  );
});

test('listTasks sorts by due date and keeps undated tasks last', async () => {
  const db = makeDb();
  await createTask({ db, persist: okPersist, input: { title: 'משימה בלי תאריך' } });
  await createTask({ db, persist: okPersist, input: { title: 'משימה מאוחרת', due_date: '2026-09-01' } });
  await createTask({ db, persist: okPersist, input: { title: 'משימה דחופה', due_date: '2026-07-30' } });

  assert.deepEqual(
    listTasks(db, { status: TASK_OPEN }).map((row) => row.title),
    ['משימה דחופה', 'משימה מאוחרת', 'משימה בלי תאריך']
  );
});

test('enrichForDisplay reads names from the CRM, not from the stored snapshot', async () => {
  const db = makeDb({
    parents: [{ id: 'p1', name: 'רונית לוי', phone: '972501234567' }],
    students: [{ id: 's1', name: 'נועה לוי' }],
  });
  const task = await createTask({
    db, persist: okPersist, input: { title: 'להתקשר להורה', parent_id: 'p1', student_id: 's1' },
  });
  const view = enrichForDisplay(db, task);
  assert.equal(view.parent_name, 'רונית לוי');
  assert.equal(view.student_name, 'נועה לוי');
});

// ─── קריאת המודל ─────────────────────────────────────────────────────────────

test('a quota error stops the model fallback instead of burning three requests', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: false, status: 429, text: async () => '{"error":{"code":429}}' };
  };
  const result = await callGeminiActions('prompt', { apiKey: 'k', fetchImpl, models: ['a', 'b', 'c'] });

  assert.equal(result, null);
  assert.equal(calls, 1, '429 is an account state, not a model failure');
});

test('a model-specific failure still falls through to the next model', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 404, text: async () => 'model not found' };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"actions":[]}' }] } }] }) };
  };
  const result = await callGeminiActions('prompt', { apiKey: 'k', fetchImpl, models: ['a', 'b', 'c'] });

  assert.equal(calls, 3);
  assert.equal(result, '{"actions":[]}');
});

test('callGeminiActions does nothing without a key', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, json: async () => ({}) }; };
  assert.equal(await callGeminiActions('prompt', { apiKey: '', fetchImpl }), null);
  assert.equal(calls, 0);
});

// ─── תרחישים ─────────────────────────────────────────────────────────────────

test('ensureDefaultScenarios seeds the builtins once and never twice', async () => {
  const db = makeDb({ [SCENARIOS_COLLECTION]: [] });
  const first = await ensureDefaultScenarios({ db, persist: okPersist });
  const second = await ensureDefaultScenarios({ db, persist: okPersist });

  assert.equal(first, BUILTIN_SCENARIOS.length);
  assert.equal(second, 0);
  assert.equal(db.tables[SCENARIOS_COLLECTION].length, BUILTIN_SCENARIOS.length);
  assert.ok(db.tables[SCENARIOS_COLLECTION].every((row) => row.is_builtin));
});

test('a disabled builtin is not re-enabled by the next seed', async () => {
  const db = makeDb({ [SCENARIOS_COLLECTION]: [] });
  await ensureDefaultScenarios({ db, persist: okPersist });
  const target = db.tables[SCENARIOS_COLLECTION][0];
  await updateScenario({ db, persist: okPersist, id: target.id, patch: { enabled: false } });

  await ensureDefaultScenarios({ db, persist: okPersist });
  assert.equal(db.tables[SCENARIOS_COLLECTION].find((r) => r.id === target.id).enabled, false);
});

test('createScenario validates name and instruction', async () => {
  const db = makeDb();
  await assert.rejects(
    () => createScenario({ db, persist: okPersist, input: { name: 'א', instruction: 'הנחיה ארוכה מספיק' } }),
    (err) => err.status === 400
  );
  await assert.rejects(
    () => createScenario({ db, persist: okPersist, input: { name: 'תרחיש', instruction: 'קצר' } }),
    (err) => err.status === 400
  );

  const row = await createScenario({
    db, persist: okPersist, input: { name: 'לקוח שביקש הצעת מחיר', instruction: 'הלקוח ביקש מחיר ולא קיבל.' },
  });
  assert.equal(row.is_builtin, false);
  assert.equal(row.enabled, true);
  assert.equal(row.action_type, 'create_task');
});

test('scenario numbers are range-checked', async () => {
  const db = makeDb();
  const bad = [{ default_due_days: 999 }, { default_due_days: -1 }, { min_confidence: 2 }];
  for (const patch of bad) {
    await assert.rejects(
      () => updateScenario({ db, persist: okPersist, id: 'sc-test', patch }),
      (err) => err.status === 400
    );
  }
  const ok = await updateScenario({ db, persist: okPersist, id: 'sc-test', patch: { min_confidence: null } });
  assert.equal(ok.min_confidence, null);
});

test('a builtin scenario can be switched off but not deleted', async () => {
  const db = makeDb({ [SCENARIOS_COLLECTION]: [{ ...SCENARIO, is_builtin: true }] });
  await assert.rejects(() => deleteScenario({ db, id: 'sc-test' }), (err) => err.status === 400);
  assert.equal(db.tables[SCENARIOS_COLLECTION].length, 1);

  const off = await updateScenario({ db, persist: okPersist, id: 'sc-test', patch: { enabled: false } });
  assert.equal(off.enabled, false);
  assert.equal(listScenarios(db, { enabledOnly: true }).length, 0);
});

test('a custom scenario can be deleted', async () => {
  const db = makeDb();
  await deleteScenario({ db, id: 'sc-test' });
  assert.equal(db.tables[SCENARIOS_COLLECTION].length, 0);
  await assert.rejects(() => deleteScenario({ db, id: 'sc-test' }), (err) => err.status === 404);
});

test('the prompt lists only what the model is allowed to propose', () => {
  const prompt = buildAnalysisPrompt({
    scenarios: [SCENARIO, { id: 'sc-two', name: 'הבטחה שלא מומשה', instruction: 'הצוות הבטיח ולא סיפק.' }],
    history: ['לקוח: יש מקום?'],
    today: TODAY,
  });
  assert.ok(prompt.includes('[sc-test]'));
  assert.ok(prompt.includes('[sc-two]'));
  assert.ok(prompt.includes('שאלה של הלקוח שהצוות לא ענה עליה.'));
  assert.ok(prompt.includes('אסור להמציא scenario_id'));
});

test('analyzeConversation refuses to run with every scenario off', async () => {
  const db = makeDb({ [SCENARIOS_COLLECTION]: [{ ...SCENARIO, enabled: false }] });
  let called = false;
  const result = await analyzeConversation(analyzeArgs(db, async () => { called = true; return null; }));
  assert.equal(called, false, 'no model call, no cost');
  assert.equal(result.reason, 'no_scenarios');
});

test('scenarioStats reports an approval rate per scenario', async () => {
  const db = makeDb();
  await analyzeConversation(analyzeArgs(db, modelReturning({
    actions: [
      { ...baseAction, title: 'משימה ראשונה' },
      { ...baseAction, title: 'משימה שנייה' },
      { ...baseAction, title: 'משימה שלישית' },
    ],
  })));
  const [first, second] = db.tables[SUGGESTIONS_COLLECTION];
  await approveSuggestion({ db, persist: okPersist, id: first.id });
  await rejectSuggestion({ db, persist: okPersist, id: second.id });

  const stats = scenarioStats(db).find((row) => row.scenario_id === 'sc-test');
  assert.equal(stats.proposed, 3);
  assert.equal(stats.approved, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.approval_rate, 0.5, 'pending is not counted against the rate');
  assert.equal(stats.scenario_name, 'שאלה שלא נענתה');
});

test('scenarioStats lists a scenario that has never fired', () => {
  const stats = scenarioStats(makeDb());
  assert.deepEqual(
    stats.map((row) => [row.scenario_id, row.proposed, row.approval_rate]),
    [['sc-test', 0, null]]
  );
});

// ─── הגדרות העוזר ────────────────────────────────────────────────────────────

test('assistant settings default to off', () => {
  const settings = loadAssistantSettings(makeDb());
  assert.equal(settings.enabled, false);
  assert.equal(settings.analyze_on_inbound, false);
  assert.equal(settings.min_confidence, 0.6);
});

test('saveAssistantSettings merges, validates and persists', async () => {
  const db = makeDb();
  const saved = await saveAssistantSettings({
    db, persist: okPersist, patch: { enabled: true, min_confidence: 0.8 },
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.min_confidence, 0.8);
  assert.equal(saved.max_actions_per_run, 3, 'untouched fields keep their default');
  assert.equal(loadAssistantSettings(db).enabled, true, 'survives a reload');

  const again = await saveAssistantSettings({ db, persist: okPersist, patch: { max_actions_per_run: 5 } });
  assert.equal(again.enabled, true, 'a second save does not reset the switch');
  assert.equal(db.tables[SETTINGS_COLLECTION].length, 1, 'single row, not a new one each save');
  assert.equal(db.tables[SETTINGS_COLLECTION][0].id, SETTINGS_ID);
});

test('saveAssistantSettings rejects out-of-range numbers', async () => {
  const db = makeDb();
  for (const patch of [{ min_confidence: 5 }, { max_actions_per_run: 0 }, { cooldown_minutes: -1 }]) {
    await assert.rejects(() => saveAssistantSettings({ db, persist: okPersist, patch }), (err) => err.status === 400);
  }
});

test('settings drive the analysis limits', async () => {
  const db = makeDb();
  await saveAssistantSettings({ db, persist: okPersist, patch: { max_actions_per_run: 1 } });
  const actions = ['אחת', 'שתיים', 'שלוש'].map((n) => ({ ...baseAction, title: `לחזור להורה ${n}` }));
  const result = await analyzeConversation(analyzeArgs(db, modelReturning({ actions })));

  assert.equal(result.created.length, 1);
  assert.equal(result.skipped, 2);
});

// ─── סריקה לילית ─────────────────────────────────────────────────────────────

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** whatsapp_logs עם הודעה אחרונה בגיל נתון. */
function logsAgedHours(entries, now) {
  return entries.map(([phone, ageHours], i) => ({
    id: `w${i}`,
    phone,
    channel: 'whatsapp',
    direction: 'outbound',
    message: '...',
    created_at: new Date(now - ageHours * HOUR).toISOString(),
  }));
}

test('the sweep picks conversations that went quiet, not active ones', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    whatsapp_logs: logsAgedHours([
      ['972500000001', 2],    // still active — the inbound path covers it
      ['972500000002', 48],   // quiet two days — the blind spot
      ['972500000003', 24 * 30], // ancient — past the lookback window
    ], now),
  });

  assert.deepEqual(
    selectSweepCandidates(db, { now, quietHours: 24, lookbackDays: 14, max: 10 }),
    ['972500000002']
  );
});

test('the sweep skips a conversation that already has a pending suggestion', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    whatsapp_logs: logsAgedHours([['972500000002', 48], ['972500000004', 72]], now),
    [SUGGESTIONS_COLLECTION]: [
      { id: 's1', status: SUGGESTION_PENDING, source: { phone: '972500000002' } },
    ],
  });

  assert.deepEqual(
    selectSweepCandidates(db, { now, quietHours: 24, lookbackDays: 14, max: 10 }),
    ['972500000004'],
    'no point paying for the same conclusion twice'
  );
});

test('a resolved suggestion lets the conversation be swept again', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    whatsapp_logs: logsAgedHours([['972500000002', 48]], now),
    [SUGGESTIONS_COLLECTION]: [
      { id: 's1', status: SUGGESTION_REJECTED, source: { phone: '972500000002' } },
    ],
  });

  assert.deepEqual(selectSweepCandidates(db, { now, quietHours: 24, lookbackDays: 14 }), ['972500000002']);
});

test('the sweep matches phones across 050… and 972… forms', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    whatsapp_logs: logsAgedHours([['0500000002', 48]], now),
    [SUGGESTIONS_COLLECTION]: [
      { id: 's1', status: SUGGESTION_PENDING, source: { phone: '972500000002' } },
    ],
  });

  assert.deepEqual(selectSweepCandidates(db, { now, quietHours: 24 }), [], 'same person, different format');
});

test('the sweep returns every quiet conversation by default, newest first', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    whatsapp_logs: logsAgedHours([
      ['972500000001', 100],
      ['972500000002', 48],
      ['972500000003', 72],
    ], now),
  });

  assert.deepEqual(
    selectSweepCandidates(db, { now, quietHours: 24, lookbackDays: 14 }),
    ['972500000002', '972500000003', '972500000001'],
    'no silent truncation — a dropped ball past an arbitrary cap is the bug we are hunting'
  );
});

test('an explicit cap still truncates, keeping the freshest', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    whatsapp_logs: logsAgedHours([
      ['972500000001', 100],
      ['972500000002', 48],
      ['972500000003', 72],
    ], now),
  });

  assert.deepEqual(
    selectSweepCandidates(db, { now, quietHours: 24, max: 2 }),
    ['972500000002', '972500000003']
  );
});

test('the sweep uses the newest message per conversation, not the oldest', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const db = makeDb({
    // one conversation: an old message and a recent one — it is still active
    whatsapp_logs: logsAgedHours([['972500000005', 200], ['972500000005', 2]], now),
  });

  assert.deepEqual(selectSweepCandidates(db, { now, quietHours: 24 }), []);
});

test('sweep settings are range-checked and persist', async () => {
  const db = makeDb();
  await assert.rejects(
    () => saveAssistantSettings({ db, persist: okPersist, patch: { nightly_quiet_hours: 999 } }),
    (err) => err.status === 400
  );

  const saved = await saveAssistantSettings({
    db, persist: okPersist, patch: { nightly_sweep: true, nightly_quiet_hours: 48 },
  });
  assert.equal(saved.nightly_sweep, true);
  assert.equal(saved.nightly_quiet_hours, 48);
  assert.equal(saved.nightly_lookback_days, 14, 'untouched fields keep their default');
});

test('the nightly cap defaults to unlimited and accepts an empty value', async () => {
  const db = makeDb();
  assert.equal(loadAssistantSettings(db).nightly_max_conversations, null, 'no cap out of the box');

  const capped = await saveAssistantSettings({
    db, persist: okPersist, patch: { nightly_max_conversations: 50 },
  });
  assert.equal(capped.nightly_max_conversations, 50);

  const uncapped = await saveAssistantSettings({
    db, persist: okPersist, patch: { nightly_max_conversations: '' },
  });
  assert.equal(uncapped.nightly_max_conversations, null, 'clearing the field removes the cap');

  await assert.rejects(
    () => saveAssistantSettings({ db, persist: okPersist, patch: { nightly_max_conversations: 0 } }),
    (err) => err.status === 400
  );
});

// ─── שערי הפעלה ──────────────────────────────────────────────────────────────

test('automatic analysis needs the master switch, the inbound switch and a key', () => {
  const env = { GEMINI_API_KEY: 'k' };
  const on = { enabled: true, analyze_on_inbound: true };

  assert.equal(suggestionsAutoEnabled(on, env), true);
  assert.equal(suggestionsAutoEnabled({ enabled: true, analyze_on_inbound: false }, env), false);
  assert.equal(suggestionsAutoEnabled({ enabled: false, analyze_on_inbound: true }, env), false);
  assert.equal(suggestionsAutoEnabled({}, env), false);
  assert.equal(suggestionsAutoEnabled(on, {}), false, 'no model key');
});

test('the env kill switch beats the screen', () => {
  const on = { enabled: true, analyze_on_inbound: true };
  assert.equal(suggestionsAutoEnabled(on, { GEMINI_API_KEY: 'k', AI_SUGGESTIONS_ENABLED: 'false' }), false);
  assert.equal(suggestionsAutoEnabled(on, { GEMINI_API_KEY: 'k', AI_SUGGESTIONS_ENABLED: 'true' }), true);
});

test('analysisAllowed rate-limits one phone without blocking another', () => {
  resetAnalysisCooldown();
  const now = Date.now();
  assert.equal(analysisAllowed('972501234567', { now }), true);
  assert.equal(analysisAllowed('972501234567', { now: now + 1000 }), false);
  assert.equal(analysisAllowed('972509999999', { now: now + 1000 }), true);
  assert.equal(analysisAllowed('972501234567', { now: now + 11 * 60 * 1000 }), true);
  resetAnalysisCooldown();
});
