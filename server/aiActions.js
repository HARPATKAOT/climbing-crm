/**
 * שכבת פעולות AI — המודל *מציע*, הצוות *מאשר*, הקוד *מבצע*.
 *
 * שלב 1 מכסה סוג פעולה אחד בלבד: `create_task` — משימת מעקב שנגזרת משיחה.
 * שום הצעה לא נכנסת ל-CRM לבד: היא נשמרת ב-`ai_suggestions` בסטטוס pending,
 * והצוות מאשר או דוחה. רק אישור יוצר רשומה ב-`crm_tasks`.
 *
 * התרחישים ("מה נחשב קצה פתוח") אינם קשיחים בקוד: הם רשומות ב-`ai_scenarios`
 * שנערכות ממסך העוזר החכם, והפרומפט נבנה מהן בזמן ריצה. רשימת התרחישים
 * הפעילים היא גם רשימת ההיתר — הצעה עם `scenario_id` שאינו פעיל נזרקת.
 *
 * כל האוספים נשמרים ב-kv_collections (כמו `activity_interest`), כך שאין צורך
 * במיגרציית SQL וההרשאות של kv_collections כבר סגורות לתפקידים ציבוריים.
 */

import { israelDateStr } from './attendanceUtils.js';
import { addInterest, insertRegistration, namesMatch } from './activityInterest.js';
import { activeRegistrations, remainingCapacity } from './activityRegistration.js';

export const SUGGESTIONS_COLLECTION = 'ai_suggestions';
export const TASKS_COLLECTION = 'crm_tasks';
export const SCENARIOS_COLLECTION = 'ai_scenarios';
export const SETTINGS_COLLECTION = 'ai_assistant_settings';
export const SETTINGS_ID = 'default';

export const SUGGESTION_PENDING = 'pending';
export const SUGGESTION_APPROVED = 'approved';
export const SUGGESTION_REJECTED = 'rejected';

export const TASK_OPEN = 'open';
export const TASK_DONE = 'done';
export const TASK_CANCELLED = 'cancelled';

/** רשימה סגורה. כל type אחר שהמודל יחזיר — נזרק בשקט. */
export const ACTION_TYPES = ['create_task'];

const MAX_TITLE_CHARS = 120;
const MAX_NAME_CHARS = 60;
const MAX_REASON_CHARS = 300;
const MAX_INSTRUCTION_CHARS = 600;
const MAX_ACTIONS_PER_RUN = 3;
const MIN_CONFIDENCE = 0.6;
const DUE_WINDOW_DAYS = 90;
const DEDUPE_WINDOW_DAYS = 14;
const HISTORY_MESSAGES = 12;
/** אותו לקוח לא מנותח שוב לפני שעברו X דקות — חוסך קריאות מודל בשיחה רצה. */
const REANALYZE_COOLDOWN_MS = 10 * 60 * 1000;

export const DEFAULT_ASSISTANT_SETTINGS = {
  enabled: false,
  analyze_on_inbound: false,
  cooldown_minutes: REANALYZE_COOLDOWN_MS / 60000,
  min_confidence: MIN_CONFIDENCE,
  max_actions_per_run: MAX_ACTIONS_PER_RUN,
  dedupe_window_days: DEDUPE_WINDOW_DAYS,
  // סריקה לילית — משלימה את הניתוח האוטומטי, שרץ רק על הודעה נכנסת ולכן
  // עיוור לשיחה שבה הצוות דיבר אחרון (בדיוק "הבטחה שלא מומשה").
  nightly_sweep: false,
  // ריק = בלי הגבלה. הבלם האמיתי על העלות הוא ה-spend cap בחשבון החיוב;
  // תקרה כאן רק הייתה מפילה בשקט את השיחה שמעבר לה — הכדור שנופל שאנחנו מחפשים.
  nightly_max_conversations: null,
  nightly_quiet_hours: 24,
  nightly_lookback_days: 14,
};

/**
 * התרחישים שהוכחו על שיחות אמיתיות. נזרעים כ-built-in: ניתנים לעריכה ולכיבוי,
 * לא למחיקה — מחיקה ממילא הייתה מתבטלת בזריעה הבאה.
 */
export const BUILTIN_SCENARIOS = [
  {
    id: 'sc-unanswered-question',
    name: 'שאלה שלא נענתה',
    instruction: 'שאלה או בקשה מפורשת של הלקוח שהצוות לא ענה עליה.',
    default_priority: 'high',
    default_due_days: 2,
    sort_order: 10,
  },
  {
    id: 'sc-broken-promise',
    name: 'הבטחה שלא מומשה',
    instruction:
      'הצוות הבטיח משהו ולא סיפק: "נחזור אליך", "נבדוק ונעדכן", "אשלח לך" — ובשיחה לא נשלח דבר.',
    default_priority: 'high',
    default_due_days: 2,
    sort_order: 20,
  },
  {
    id: 'sc-agreed-not-scheduled',
    name: 'הלקוח הסכים ולא נקבע כלום',
    instruction:
      'הלקוח אישר או הסכים — "בסדר גמור", "נשמע מעולה", "מעולה נרשם" — ובפועל לא נקבע מועד, ' +
      'לא נשלח קישור תשלום ולא בוצעה הרשמה בהמשך השיחה.',
    default_priority: 'normal',
    default_due_days: 2,
    sort_order: 30,
  },
  {
    id: 'sc-customer-will-return',
    name: 'הלקוח אמר שיחזור אלינו',
    instruction:
      'הלקוח אמר שיחזור עם תשובה — "אדבר איתו ואחזור", "אחשוב על זה" — וצריך מעקב יזום מצידנו.',
    default_priority: 'normal',
    default_due_days: 3,
    sort_order: 40,
  },
  {
    id: 'sc-long-absence',
    name: 'היעדרות ממושכת',
    instruction:
      'הלקוח הודיע על היעדרות ארוכה: חופשה, נסיעה לחו"ל, פציעה או מחלה ממושכת. ' +
      'המשימה היא לחזור אליו בסוף התקופה שהוא ציין — קבע את תאריך היעד לפי מה שנאמר בשיחה. ' +
      'היעדרות של אימון בודד שכבר טופלה אינה נחשבת.',
    default_priority: 'normal',
    default_due_days: null,
    sort_order: 50,
  },
];

function clean(value) {
  return String(value ?? '').trim();
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** אותו כלל כמו בשאר ה-CRM: כתיבה שלא הגיעה לאחסון הדורבילי — נכשלה. */
async function requireDurable(persist, table, record) {
  if (typeof persist !== 'function') return record;
  const result = await persist(table, record);
  if (result?.ok === false) {
    throw Object.assign(new Error(result.error || `שמירת ${table} נכשלה`), { status: 503 });
  }
  return record;
}

export function addDays(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dateStr;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * תאריך יעד מהמודל: רק YYYY-MM-DD אמיתי. עבר — נמשך להיום; רחוק מדי — נזרק.
 * מודל שממציא "2026-02-31" לא יכניס תאריך שבור ל-CRM.
 */
export function normalizeDueDate(value, { today = israelDateStr(), windowDays = DUE_WINDOW_DAYS } = {}) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // 2026-02-31 מתגלגל ל-03-03 במקום להיכשל — השוואה חוזרת פוסלת תאריך שלא קיים.
  if (parsed.toISOString().slice(0, 10) !== text) return null;
  if (text < today) return today;
  if (text > addDays(today, windowDays)) return null;
  return text;
}

/** המודל מקבל שמות, לא מזהים — כך הוא לא יכול להמציא id של מתאמן. */
export function matchStudentByName(students = [], name) {
  const wanted = clean(name);
  if (!wanted) return null;
  return students.find((student) => namesMatch(student?.name, wanted)) || null;
}

/** מפתח כפילות: אותה פעולה, אותו לקוח, אותה כותרת במילים אחרות-אך-זהות. */
export function suggestionFingerprint({ type, parentId, title } = {}) {
  const normalizedTitle = clean(title)
    .replace(/\s+/g, ' ')
    .replace(/[.,!?…"'׳״]+$/g, '')
    .toLocaleLowerCase('he');
  return [clean(type), clean(parentId), normalizedTitle].join('|');
}

export function parseModelJson(raw) {
  const text = clean(raw);
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * הצעה גולמית מהמודל -> הצעה חוקית, או null.
 * כל שדה שהמודל לא רשאי לקבוע (parent_id, student_id) מגיע מההקשר, לא ממנו,
 * ו-`scenario_id` חייב להתאים לתרחיש פעיל — אחרת אין לו רשות להציע את זה בכלל.
 */
export function normalizeSuggestion(raw, context = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const type = clean(raw.type);
  if (!ACTION_TYPES.includes(type)) return null;

  const scenarios = context.scenarios instanceof Map
    ? context.scenarios
    : new Map((context.scenarios || []).map((s) => [String(s.id), s]));
  const scenario = scenarios.get(clean(raw.scenario_id));
  if (!scenario) return null;

  const confidence = Number(raw.confidence);
  if (!Number.isFinite(confidence)) return null;
  // סף התרחיש גובר על הסף הגלובלי — כך אפשר להחמיר עם תרחיש רועש בלי לפגוע בשאר.
  const minConfidence = Number.isFinite(scenario.min_confidence)
    ? scenario.min_confidence
    : (Number.isFinite(context.minConfidence) ? context.minConfidence : MIN_CONFIDENCE);
  if (confidence < minConfidence) return null;

  const title = clean(raw.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS);
  if (title.length < 3) return null;

  const student = matchStudentByName(context.students, raw.student_name);
  const today = context.today || israelDateStr();
  // תאריך מהמודל אם הוא תקין; אחרת ברירת המחדל של התרחיש, מחושבת בשרת.
  const dueFromModel = normalizeDueDate(raw.due_date, { today });
  const dueFallback = Number.isFinite(scenario.default_due_days)
    ? addDays(today, scenario.default_due_days)
    : null;

  return {
    type,
    scenario_id: String(scenario.id),
    scenario_name: scenario.name || '',
    confidence: Math.min(1, Math.max(0, confidence)),
    reason: clean(raw.reason).slice(0, MAX_REASON_CHARS),
    args: {
      title,
      due_date: dueFromModel || dueFallback,
      priority: (raw.priority || scenario.default_priority) === 'high' ? 'high' : 'normal',
      parent_id: context.parentId ? String(context.parentId) : null,
      student_id: student?.id ? String(student.id) : null,
      student_name: student?.name || '',
    },
  };
}

// ─── תרחישים ─────────────────────────────────────────────────────────────────

export function scenarioRows(db) {
  return db.get(SCENARIOS_COLLECTION) || [];
}

export function listScenarios(db, { enabledOnly = false } = {}) {
  return scenarioRows(db)
    .filter((row) => (enabledOnly ? row.enabled !== false : true))
    .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

function normalizeScenarioInput(body = {}, { partial = false } = {}) {
  const out = {};

  if (body.name !== undefined || !partial) {
    const name = clean(body.name).replace(/\s+/g, ' ').slice(0, MAX_NAME_CHARS);
    if (name.length < 2) throw badRequest('שם התרחיש חובה');
    out.name = name;
  }
  if (body.instruction !== undefined || !partial) {
    const instruction = clean(body.instruction).slice(0, MAX_INSTRUCTION_CHARS);
    if (instruction.length < 10) throw badRequest('ההנחיה לתרחיש קצרה מדי');
    out.instruction = instruction;
  }
  if (body.enabled !== undefined) out.enabled = body.enabled !== false;
  if (body.default_priority !== undefined) {
    out.default_priority = body.default_priority === 'high' ? 'high' : 'normal';
  }
  if (body.default_due_days !== undefined) {
    const days = Number(body.default_due_days);
    if (body.default_due_days === null || body.default_due_days === '') out.default_due_days = null;
    else if (!Number.isFinite(days) || days < 0 || days > DUE_WINDOW_DAYS) {
      throw badRequest(`ימים ליעד חייבים להיות בין 0 ל-${DUE_WINDOW_DAYS}`);
    } else out.default_due_days = Math.round(days);
  }
  if (body.min_confidence !== undefined) {
    const value = Number(body.min_confidence);
    if (body.min_confidence === null || body.min_confidence === '') out.min_confidence = null;
    else if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw badRequest('סף ביטחון חייב להיות בין 0 ל-1');
    } else out.min_confidence = value;
  }
  if (body.sort_order !== undefined) out.sort_order = Number(body.sort_order) || 0;

  return out;
}

export async function createScenario({ db, persist, input, actor = '' } = {}) {
  const record = normalizeScenarioInput(input);
  const row = db.insert(SCENARIOS_COLLECTION, {
    enabled: true,
    action_type: 'create_task',
    default_priority: 'normal',
    default_due_days: 2,
    min_confidence: null,
    sort_order: (listScenarios(db).at(-1)?.sort_order || 0) + 10,
    ...record,
    is_builtin: false,
    created_by: actor || 'crm',
  });
  await requireDurable(persist, SCENARIOS_COLLECTION, row);
  return row;
}

export async function updateScenario({ db, persist, id, patch = {} } = {}) {
  const scenario = scenarioRows(db).find((row) => String(row.id) === String(id));
  if (!scenario) throw Object.assign(new Error('התרחיש לא נמצא'), { status: 404 });
  const updated = db.update(SCENARIOS_COLLECTION, scenario.id, normalizeScenarioInput(patch, { partial: true }));
  await requireDurable(persist, SCENARIOS_COLLECTION, updated);
  return updated;
}

/** תרחיש מובנה ניתן לעריכה ולכיבוי אך לא למחיקה — הזריעה הבאה הייתה מחזירה אותו. */
export async function deleteScenario({ db, id } = {}) {
  const scenario = scenarioRows(db).find((row) => String(row.id) === String(id));
  if (!scenario) throw Object.assign(new Error('התרחיש לא נמצא'), { status: 404 });
  if (scenario.is_builtin) throw badRequest('תרחיש מובנה אפשר לכבות אך לא למחוק');
  db.delete(SCENARIOS_COLLECTION, scenario.id);
  return { ok: true };
}

export async function ensureDefaultScenarios({ db, persist } = {}) {
  const existing = new Set(scenarioRows(db).map((row) => String(row.id)));
  let created = 0;
  for (const def of BUILTIN_SCENARIOS) {
    if (existing.has(def.id)) continue;
    const row = db.insert(SCENARIOS_COLLECTION, {
      ...def,
      enabled: true,
      action_type: 'create_task',
      min_confidence: null,
      is_builtin: true,
      created_by: 'system',
    });
    await requireDurable(persist, SCENARIOS_COLLECTION, row);
    created += 1;
  }
  return created;
}

/** אחוז אישור לכל תרחיש — הדרך היחידה לדעת אם תרחיש מייצר ערך או רעש. */
export function scenarioStats(db) {
  const counts = new Map();
  const bump = (id, name, key) => {
    if (!counts.has(id)) {
      counts.set(id, { scenario_id: id, scenario_name: name, proposed: 0, approved: 0, rejected: 0, pending: 0 });
    }
    const row = counts.get(id);
    row.proposed += 1;
    row[key] += 1;
    if (name && !row.scenario_name) row.scenario_name = name;
  };

  for (const suggestion of suggestionRows(db)) {
    const id = String(suggestion.scenario_id || 'unknown');
    const status = String(suggestion.status || SUGGESTION_PENDING);
    const key = status === SUGGESTION_APPROVED ? 'approved'
      : status === SUGGESTION_REJECTED ? 'rejected'
        : 'pending';
    bump(id, suggestion.scenario_name || '', key);
  }

  const byId = new Map(scenarioRows(db).map((row) => [String(row.id), row]));
  for (const [id, row] of byId) {
    if (!counts.has(id)) {
      counts.set(id, { scenario_id: id, scenario_name: row.name || '', proposed: 0, approved: 0, rejected: 0, pending: 0 });
    }
  }

  return [...counts.values()].map((row) => {
    const reviewed = row.approved + row.rejected;
    return {
      ...row,
      scenario_name: row.scenario_name || byId.get(row.scenario_id)?.name || '',
      enabled: byId.get(row.scenario_id)?.enabled !== false,
      exists: byId.has(row.scenario_id),
      approval_rate: reviewed ? Number((row.approved / reviewed).toFixed(2)) : null,
    };
  }).sort((a, b) => b.proposed - a.proposed);
}

// ─── הגדרות העוזר ────────────────────────────────────────────────────────────

export function loadAssistantSettings(db) {
  const stored = (db.get(SETTINGS_COLLECTION) || []).find((row) => String(row.id) === SETTINGS_ID);
  return { ...DEFAULT_ASSISTANT_SETTINGS, ...(stored || {}), id: SETTINGS_ID };
}

export async function saveAssistantSettings({ db, persist, patch = {} } = {}) {
  const current = loadAssistantSettings(db);
  const next = { ...current };

  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  if (patch.analyze_on_inbound !== undefined) next.analyze_on_inbound = patch.analyze_on_inbound === true;
  if (patch.nightly_sweep !== undefined) next.nightly_sweep = patch.nightly_sweep === true;

  // תקרת הסריקה היא אופציונלית: ריק / null = בלי הגבלה.
  if (patch.nightly_max_conversations !== undefined) {
    const raw = patch.nightly_max_conversations;
    if (raw === null || raw === '') next.nightly_max_conversations = null;
    else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 1 || value > 1000) {
        throw badRequest('מקסימום שיחות בלילה חייב להיות בין 1 ל-1000, או ריק לבלי הגבלה');
      }
      next.nightly_max_conversations = Math.round(value);
    }
  }

  const numeric = [
    ['cooldown_minutes', 0, 1440],
    ['min_confidence', 0, 1],
    ['max_actions_per_run', 1, 10],
    ['dedupe_window_days', 1, 365],
    ['nightly_quiet_hours', 1, 168],
    ['nightly_lookback_days', 1, 90],
  ];
  for (const [key, min, max] of numeric) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < min || value > max) {
      throw badRequest(`הערך של ${key} חייב להיות בין ${min} ל-${max}`);
    }
    next[key] = value;
  }

  const exists = (db.get(SETTINGS_COLLECTION) || []).some((row) => String(row.id) === SETTINGS_ID);
  const saved = exists
    ? db.update(SETTINGS_COLLECTION, SETTINGS_ID, next)
    : db.insert(SETTINGS_COLLECTION, { ...next, id: SETTINGS_ID });
  await requireDurable(persist, SETTINGS_COLLECTION, saved);
  return { ...DEFAULT_ASSISTANT_SETTINGS, ...saved };
}

export function suggestionRows(db) {
  return db.get(SUGGESTIONS_COLLECTION) || [];
}

export function taskRows(db) {
  return db.get(TASKS_COLLECTION) || [];
}

export function listSuggestions(db, { status = SUGGESTION_PENDING, parentId = null, scenarioId = null } = {}) {
  return suggestionRows(db)
    .filter((row) => (status ? String(row.status || SUGGESTION_PENDING) === status : true))
    .filter((row) => (parentId ? String(row.args?.parent_id || '') === String(parentId) : true))
    .filter((row) => (scenarioId ? String(row.scenario_id || '') === String(scenarioId) : true))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

export function listTasks(db, { status = TASK_OPEN, parentId = null } = {}) {
  return taskRows(db)
    .filter((row) => (status ? String(row.status || TASK_OPEN) === status : true))
    .filter((row) => (parentId ? String(row.parent_id || '') === String(parentId) : true))
    .sort((a, b) => {
      const left = a.due_date || '9999-12-31';
      const right = b.due_date || '9999-12-31';
      return left.localeCompare(right) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
}

/**
 * כפילות = הצעה ממתינה זהה, או משימה פתוחה זהה שנוצרה לאחרונה.
 * בלי זה, כל הודעה חוזרת של אותו הורה תייצר עוד עותק של אותה משימה.
 */
export function isDuplicateSuggestion(db, fingerprint, { today = israelDateStr(), windowDays = DEDUPE_WINDOW_DAYS } = {}) {
  const pending = suggestionRows(db).some(
    (row) => String(row.status || SUGGESTION_PENDING) === SUGGESTION_PENDING && row.fingerprint === fingerprint
  );
  if (pending) return true;

  const since = addDays(today, -windowDays);
  return taskRows(db).some((row) => {
    if (String(row.status || TASK_OPEN) !== TASK_OPEN) return false;
    if (row.fingerprint !== fingerprint) return false;
    return String(row.created_at || '').slice(0, 10) >= since;
  });
}

/**
 * התרחישים מגיעים מהמסד ומרונדרים כרשימה ממוספרת. כללי האיכות (ניסוח, איסור
 * המצאות, החרגות) נשארים קשיחים — הם לא תרחישים אלא איך מנסחים כל תרחיש.
 */
export function buildAnalysisPrompt({
  scenarios = [],
  history = [],
  cardContext = '',
  today = israelDateStr(),
  brandName = '',
  maxActions = MAX_ACTIONS_PER_RUN,
} = {}) {
  const scenarioLines = scenarios.map((scenario, index) => [
    `${index + 1}. [${scenario.id}] ${scenario.name}`,
    `   ${scenario.instruction}`,
  ].join('\n'));

  return [
    'אתה עוזר תפעולי של צוות ה-CRM בחדר טיפוס' + (brandName ? ` "${brandName}"` : '') + '.',
    'אתה לא מדבר עם הלקוח. אתה קורא שיחה שכבר קרתה ומציע לצוות משימות מעקב.',
    '',
    `התאריך היום: ${today}`,
    '',
    '## כרטיס הלקוח',
    cardContext || 'אין כרטיס לקוח.',
    '',
    '## השיחה',
    history.length ? history.join('\n') : '(אין הודעות)',
    '',
    '## התרחישים שאתה מורשה להציע',
    'הצע משימה רק כשהשיחה מתאימה לאחד מהתרחישים הבאים. עבור עליהם אחד אחד:',
    '',
    scenarioLines.join('\n'),
    '',
    'לכל משימה החזר scenario_id — המזהה בסוגריים המרובעים של התרחיש שהצדיק אותה.',
    'אין תרחיש מתאים? אל תציע. אסור להמציא scenario_id שאינו ברשימה.',
    '',
    'אל תציע משימה על: שיחה שנסגרה במלואה, ברכות ותודות, או מידע שכבר נמסר במלואו.',
    'אם אין שום קצה פתוח — החזר רשימה ריקה. זו תשובה טובה ומצופה.',
    'היה עקבי: אותה תבנית שיחה חייבת לקבל תמיד את אותה הכרעה.',
    '',
    'כללים:',
    `- לכל היותר ${maxActions} משימות.`,
    '- title: עברית, לשון ציווי, עד 12 מילים, מה בדיוק לעשות.',
    '- נסח את הכותרת כבדיקה או חזרה ללקוח, לא כאילו ההחלטה כבר התקבלה:',
    '  "לוודא מול ההורה ולהעביר את דנה לקבוצה" — ולא "להעביר את דנה לקבוצה".',
    '- reason: משפט קצר עם ציטוט/הפניה למה בשיחה הצדיק את המשימה.',
    '- due_date: בפורמט YYYY-MM-DD בלבד, ורק כשהשיחה מציינת מועד או תקופה.',
    '  אין מועד בשיחה? השמט — המערכת תשלים לפי התרחיש.',
    '- student_name: רק שם שמופיע בכרטיס הלקוח למעלה. אל תמציא שמות ואל תמציא מזהים.',
    '- priority: "high" רק ללקוח שממתין לתשובה או לתאריך שנקבע. אחרת "normal".',
    '- confidence: 0 עד 1. היה מחמיר — הצוות רואה כל הצעה וזמנו יקר.',
    '- אל תמציא מחירים, שעות, או מקומות פנויים שלא כתובים למעלה.',
    '',
    'החזר JSON בלבד במבנה: {"actions":[{"type":"create_task","scenario_id":"...","title":"...","reason":"...","confidence":0.8,"priority":"normal","due_date":"YYYY-MM-DD","student_name":"..."}]}',
  ].join('\n');
}

function actionsResponseSchema(scenarios = []) {
  const ids = scenarios.map((scenario) => String(scenario.id));
  return {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ACTION_TYPES },
            // הסכימה עצמה מגבילה את המודל לתרחישים הפעילים; האימות בקוד הוא הרשת השנייה.
            scenario_id: ids.length ? { type: 'string', enum: ids } : { type: 'string' },
            title: { type: 'string' },
            reason: { type: 'string' },
            confidence: { type: 'number' },
            priority: { type: 'string', enum: ['normal', 'high'] },
            due_date: { type: 'string' },
            student_name: { type: 'string' },
          },
          required: ['type', 'scenario_id', 'title', 'reason', 'confidence'],
        },
      },
    },
    required: ['actions'],
  };
}

/**
 * קריאת ג'מיני עם פלט JSON כפוי לפי סכימה — ה-helper הגנרי לכל משימת סיווג
 * חד-פעמית (תיוג הוצאות, ניתוח שיחות). מחזיר טקסט גולמי או null; הפירוק
 * והאימות אצל הקורא.
 */
export async function callGeminiJson(prompt, {
  apiKey,
  fetchImpl = fetch,
  models,
  responseSchema,
  temperature = 0.2,
} = {}) {
  const key = clean(apiKey);
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') return null;

  // ברירת המחדל היא הכינוי המתגלגל ולא גרסה נעוצה: ב-29.7 התברר ש-gemini-2.5-flash
  // מחזיר 404 ("נסגר למשתמשים חדשים") ו-gemini-2.0-flash מחזיר מכסה אפס, כך שכל
  // קריאה שרפה שתי בקשות כושלות לפני שהצליחה. כינוי מתגלגל לא מת בשקט.
  const candidates = models || [
    process.env.GEMINI_MODEL || 'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ];

  let lastError = '';
  for (const model of candidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = `${model}: HTTP ${response.status} ${body.slice(0, 160)}`;
        // מכסה מוצתה היא מצב של החשבון, לא של המודל. ניסיון במודל הבא רק
        // שורף עוד בקשות מאותה מכסה ומאריך את החסימה — עוצרים מיד.
        if (response.status === 429) break;
        continue;
      }
      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (clean(text)) return clean(text);
      lastError = `${model}: empty candidates`;
    } catch (err) {
      lastError = `${model}: ${err.message}`;
    }
  }
  if (lastError) console.error('AI structured model call failed:', lastError);
  return null;
}

/** קריאת מודל בפלט מובנה. מוחזר טקסט גולמי — הפירוק והאימות נעשים בנפרד. */
export async function callGeminiActions(prompt, { apiKey, fetchImpl = fetch, models, scenarios = [] } = {}) {
  return callGeminiJson(prompt, {
    apiKey,
    fetchImpl,
    models,
    responseSchema: actionsResponseSchema(scenarios),
  });
}

/**
 * מנתח שיחה אחת ושומר הצעות ממתינות. לא משנה שום נתון ב-CRM.
 * מחזיר { created, skipped, reason } ולעולם לא זורק — זה נתיב רקע.
 */
export async function analyzeConversation({
  db,
  persist,
  parent,
  students = [],
  history = [],
  cardContext = '',
  channel = 'whatsapp',
  phone = '',
  brandName = '',
  apiKey = process.env.GEMINI_API_KEY,
  callModel = callGeminiActions,
  today = israelDateStr(),
  scenarios,
  maxActions,
  minConfidence,
  dedupeWindowDays,
} = {}) {
  if (!db) return { created: [], skipped: 0, reason: 'no_db' };
  if (!history.length) return { created: [], skipped: 0, reason: 'no_history' };

  const settings = loadAssistantSettings(db);
  const activeScenarios = scenarios || listScenarios(db, { enabledOnly: true });
  // בלי תרחיש פעיל אחד אין למודל מה להציע — וגם אין רשימת היתר להגן עליה.
  if (!activeScenarios.length) return { created: [], skipped: 0, reason: 'no_scenarios' };

  const limit = Number.isFinite(maxActions) ? maxActions : settings.max_actions_per_run;
  const floor = Number.isFinite(minConfidence) ? minConfidence : settings.min_confidence;
  const window = Number.isFinite(dedupeWindowDays) ? dedupeWindowDays : settings.dedupe_window_days;

  let raw = null;
  try {
    raw = await callModel(
      buildAnalysisPrompt({ scenarios: activeScenarios, history, cardContext, today, brandName, maxActions: limit }),
      { apiKey, scenarios: activeScenarios }
    );
  } catch (err) {
    console.error('analyzeConversation model error:', err.message);
    return { created: [], skipped: 0, reason: 'model_error' };
  }
  if (!raw) return { created: [], skipped: 0, reason: 'no_model_output' };

  const payload = parseModelJson(raw);
  const proposed = Array.isArray(payload?.actions) ? payload.actions : null;
  if (!proposed) return { created: [], skipped: 0, reason: 'unparsable' };

  const context = {
    parentId: parent?.id || null,
    students,
    today,
    minConfidence: floor,
    scenarios: new Map(activeScenarios.map((scenario) => [String(scenario.id), scenario])),
  };

  const created = [];
  let skipped = 0;

  for (const item of proposed) {
    if (created.length >= limit) {
      skipped += 1;
      continue;
    }
    const normalized = normalizeSuggestion(item, context);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    const fingerprint = suggestionFingerprint({
      type: normalized.type,
      parentId: normalized.args.parent_id,
      title: normalized.args.title,
    });
    if (isDuplicateSuggestion(db, fingerprint, { today, windowDays: window })) {
      skipped += 1;
      continue;
    }

    try {
      const row = db.insert(SUGGESTIONS_COLLECTION, {
        ...normalized,
        status: SUGGESTION_PENDING,
        fingerprint,
        created_by: 'ai',
        source: {
          channel,
          phone: phone || parent?.phone || '',
          parent_name: parent?.name || '',
          excerpt: history.slice(-3).join('\n').slice(0, 500),
        },
        reviewed_at: null,
        reviewed_by: '',
        review_note: '',
        applied_task_id: null,
      });
      await requireDurable(persist, SUGGESTIONS_COLLECTION, row);
      created.push(row);
    } catch (err) {
      console.error('Failed to store AI suggestion:', err.message);
      skipped += 1;
    }
  }

  return { created, skipped, reason: created.length ? 'ok' : 'nothing_actionable' };
}

/**
 * שיבוץ ורישום לאירוע, ברגע האישור.
 *
 * התפוסה נבדקת *כאן* ולא רק כשההצעה נוצרה: בין הצעה לאישור עוברים דקות,
 * ובינתיים דף ההרשמה הציבורי יכול לסגור את האירוע. אישור שמכניס משתתף
 * מעבר לתקרה הוא בדיוק סוג התקלה שהשער הזה קיים כדי למנוע.
 */
async function applyActivityAction({ db, persist, suggestion, actor = '' }) {
  const args = suggestion.args || {};
  const activity = (db.get('activities') || []).find((row) => String(row.id) === String(args.activity_id));
  if (!activity) throw Object.assign(new Error('האירוע לא נמצא'), { status: 404 });

  const participant = {
    student_id: args.student_id || null,
    participant_type: args.participant_type === 'adult' ? 'adult' : 'child',
    name: args.participant_name,
    notes: args.notes || '',
  };

  if (suggestion.type === 'add_activity_interest') {
    return addInterest({
      db,
      persist,
      activityId: activity.id,
      input: {
        name: participant.name,
        phone: '',
        email: '',
        parent_id: args.parent_id || null,
        student_id: participant.student_id,
        participant_type: participant.participant_type,
        notes: [participant.notes, `שובץ על ידי הסוכן${actor ? ` (${actor})` : ''}`]
          .filter(Boolean).join(' · '),
      },
    });
  }

  const parent = (db.get('parents') || []).find((row) => String(row.id) === String(args.parent_id));
  if (!parent) throw Object.assign(new Error('הלקוח לא נמצא'), { status: 404 });

  const left = remainingCapacity(activity, activeRegistrations(db, activity.id));
  if (left !== null && left < 1) throw badRequest('אין מקומות פנויים באירוע');

  return insertRegistration({
    db,
    persist,
    activity,
    parent,
    participant,
    paymentStatus: args.payment_status || undefined,
    note: `נרשם על ידי הסוכן${actor ? ` (${actor})` : ''}`,
  });
}

/**
 * ביצוע בפועל.
 *
 * `ACTION_TYPES` הוא רשימת ההיתר של *ניתוח שיחה* (וגם סכימת הפלט שלו), ולכן
 * הוא נשאר `create_task` בלבד. סוכן השיחה מציע גם עדכון משימה והערה לכרטיס,
 * ולכן רשימת הביצוע כאן רחבה ממנו — מה שלא מוכר בשני המקומות פשוט נזרק.
 */
export const APPLIABLE_ACTION_TYPES = [
  'create_task',
  'update_task',
  'add_customer_note',
  'add_activity_interest',
  'register_to_activity',
];

async function applyAction({ db, persist, suggestion, actor = '' }) {
  if (!APPLIABLE_ACTION_TYPES.includes(suggestion.type)) {
    throw badRequest(`סוג פעולה לא נתמך: ${suggestion.type}`);
  }

  if (suggestion.type === 'add_activity_interest' || suggestion.type === 'register_to_activity') {
    return applyActivityAction({ db, persist, suggestion, actor });
  }

  if (suggestion.type === 'update_task') {
    const args = suggestion.args || {};
    return updateTask({ db, persist, id: args.task_id, patch: args.patch || {}, actor });
  }

  if (suggestion.type === 'add_customer_note') {
    const args = suggestion.args || {};
    const parent = (db.get('parents') || []).find((row) => String(row.id) === String(args.parent_id));
    if (!parent) throw Object.assign(new Error('הלקוח לא נמצא'), { status: 404 });
    const stamp = israelDateStr();
    const line = `[${stamp}] ${clean(args.note)}`;
    const updated = db.update('parents', parent.id, {
      notes: parent.notes ? `${parent.notes}\n${line}` : line,
    });
    await requireDurable(persist, 'parents', updated);
    return updated;
  }

  const args = suggestion.args || {};
  const task = db.insert(TASKS_COLLECTION, {
    title: args.title,
    status: TASK_OPEN,
    priority: args.priority === 'high' ? 'high' : 'normal',
    due_date: args.due_date || null,
    parent_id: args.parent_id || null,
    student_id: args.student_id || null,
    source: 'ai_suggestion',
    suggestion_id: suggestion.id,
    fingerprint: suggestion.fingerprint || null,
    notes: suggestion.reason || '',
    created_by: actor || 'crm',
    completed_at: null,
  });
  await requireDurable(persist, TASKS_COLLECTION, task);
  return task;
}

export async function approveSuggestion({ db, persist, id, actor = '' } = {}) {
  const suggestion = suggestionRows(db).find((row) => String(row.id) === String(id));
  if (!suggestion) throw Object.assign(new Error('ההצעה לא נמצאה'), { status: 404 });
  if (String(suggestion.status || SUGGESTION_PENDING) !== SUGGESTION_PENDING) {
    throw badRequest('ההצעה כבר טופלה');
  }

  const applied = await applyAction({ db, persist, suggestion, actor });
  // רק `create_task` מייצר משימה חדשה; שאר הפעולות מחזירות את הרשומה שעודכנה,
  // ולכן קישור אליה כ-`applied_task_id` היה מצביע על הדבר הלא נכון.
  const task = suggestion.type === 'create_task' ? applied : null;
  const updated = db.update(SUGGESTIONS_COLLECTION, suggestion.id, {
    status: SUGGESTION_APPROVED,
    reviewed_at: new Date().toISOString(),
    reviewed_by: actor || 'crm',
    applied_task_id: task?.id || null,
  });
  await requireDurable(persist, SUGGESTIONS_COLLECTION, updated);
  return { suggestion: updated, task, applied };
}

export async function rejectSuggestion({ db, persist, id, actor = '', note = '' } = {}) {
  const suggestion = suggestionRows(db).find((row) => String(row.id) === String(id));
  if (!suggestion) throw Object.assign(new Error('ההצעה לא נמצאה'), { status: 404 });
  if (String(suggestion.status || SUGGESTION_PENDING) !== SUGGESTION_PENDING) {
    throw badRequest('ההצעה כבר טופלה');
  }
  const updated = db.update(SUGGESTIONS_COLLECTION, suggestion.id, {
    status: SUGGESTION_REJECTED,
    reviewed_at: new Date().toISOString(),
    reviewed_by: actor || 'crm',
    review_note: clean(note).slice(0, MAX_REASON_CHARS),
  });
  await requireDurable(persist, SUGGESTIONS_COLLECTION, updated);
  return updated;
}

export function normalizeTaskInput(body = {}) {
  const title = clean(body.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS);
  if (title.length < 3) throw badRequest('כותרת המשימה חובה');
  return {
    title,
    status: TASK_OPEN,
    priority: body.priority === 'high' ? 'high' : 'normal',
    due_date: normalizeDueDate(body.due_date) || null,
    parent_id: body.parent_id ? String(body.parent_id) : null,
    student_id: body.student_id ? String(body.student_id) : null,
    notes: clean(body.notes).slice(0, MAX_REASON_CHARS),
    source: 'manual',
    suggestion_id: null,
    fingerprint: null,
    completed_at: null,
  };
}

export async function createTask({ db, persist, input, actor = '' } = {}) {
  const record = normalizeTaskInput(input);
  const task = db.insert(TASKS_COLLECTION, { ...record, created_by: actor || 'crm' });
  await requireDurable(persist, TASKS_COLLECTION, task);
  return task;
}

export async function updateTask({ db, persist, id, patch = {}, actor = '' } = {}) {
  const task = taskRows(db).find((row) => String(row.id) === String(id));
  if (!task) throw Object.assign(new Error('המשימה לא נמצאה'), { status: 404 });

  const next = {};
  if (patch.title !== undefined) {
    const title = clean(patch.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS);
    if (title.length < 3) throw badRequest('כותרת המשימה חובה');
    next.title = title;
  }
  if (patch.status !== undefined) {
    const status = clean(patch.status);
    if (![TASK_OPEN, TASK_DONE, TASK_CANCELLED].includes(status)) throw badRequest('סטטוס משימה לא חוקי');
    next.status = status;
    next.completed_at = status === TASK_DONE ? new Date().toISOString() : null;
    next.completed_by = status === TASK_DONE ? (actor || 'crm') : '';
  }
  if (patch.priority !== undefined) next.priority = patch.priority === 'high' ? 'high' : 'normal';
  if (patch.due_date !== undefined) next.due_date = normalizeDueDate(patch.due_date) || null;
  if (patch.notes !== undefined) next.notes = clean(patch.notes).slice(0, MAX_REASON_CHARS);

  const updated = db.update(TASKS_COLLECTION, task.id, next);
  await requireDurable(persist, TASKS_COLLECTION, updated);
  return updated;
}

/** מצרף שם הורה/מתאמן לתצוגה — המקור הוא ה-CRM, לא צילום המצב שנשמר בהצעה. */
export function enrichForDisplay(db, row) {
  const parent = row.parent_id || row.args?.parent_id
    ? (db.get('parents') || []).find((p) => String(p.id) === String(row.parent_id || row.args?.parent_id))
    : null;
  const studentId = row.student_id || row.args?.student_id;
  const student = studentId
    ? (db.get('students') || []).find((s) => String(s.id) === String(studentId))
    : null;
  return {
    ...row,
    parent_name: parent?.name || row.source?.parent_name || '',
    parent_phone: parent?.phone || row.source?.phone || '',
    student_name: student?.name || row.args?.student_name || '',
  };
}

// ─── סריקה לילית ─────────────────────────────────────────────────────────────

/** מפתח השוואה לטלפון — תשע ספרות אחרונות, כמו בשאר ה-CRM. */
function sweepPhoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/**
 * שיחות ששקטו: ההודעה האחרונה בהן ישנה מספיק כדי שברור שאיש לא ממשיך אותן,
 * וטרייה מספיק כדי שעוד אכפת. זה בדיוק העיוור של הניתוח האוטומטי — שיחה
 * שהצוות דיבר בה אחרון לא תקבל לעולם הודעה נכנסת שתפעיל ניתוח.
 *
 * שיחה שכבר יש לה הצעה ממתינה מדולגת — אין טעם לשלם על אותה מסקנה פעמיים.
 */
export function selectSweepCandidates(db, {
  now = Date.now(),
  quietHours = DEFAULT_ASSISTANT_SETTINGS.nightly_quiet_hours,
  lookbackDays = DEFAULT_ASSISTANT_SETTINGS.nightly_lookback_days,
  max = null,
} = {}) {
  const quietBefore = now - quietHours * 3600 * 1000;
  const freshAfter = now - lookbackDays * 24 * 3600 * 1000;

  const lastByPhone = new Map();
  for (const log of db.get('whatsapp_logs') || []) {
    const phone = log.phone || '';
    const key = sweepPhoneKey(phone);
    if (key.length < 9) continue;
    const at = Date.parse(log.created_at || '');
    if (!Number.isFinite(at)) continue;
    const current = lastByPhone.get(key);
    if (!current || at > current.at) lastByPhone.set(key, { phone, at });
  }

  const pending = new Set(
    suggestionRows(db)
      .filter((row) => String(row.status || SUGGESTION_PENDING) === SUGGESTION_PENDING)
      .map((row) => sweepPhoneKey(row.source?.phone))
      .filter(Boolean)
  );

  const ordered = [...lastByPhone.entries()]
    .filter(([key, { at }]) => at <= quietBefore && at >= freshAfter && !pending.has(key))
    .sort((a, b) => b[1].at - a[1].at)
    .map(([, { phone }]) => phone);

  return Number.isFinite(max) && max > 0 ? ordered.slice(0, max) : ordered;
}

// ─── חיבור לזרימת ההודעות הנכנסות ────────────────────────────────────────────

const lastAnalyzedByPhone = new Map();

/**
 * הפעלה אוטומטית דורשת שלושה תנאים. משתנה הסביבה הוא מתג-הרג קשיח: כשהוא
 * מוגדר במפורש ל-false שום הגדרה במסך לא תדליק ניתוח אוטומטי בסביבה הזאת.
 */
export function suggestionsAutoEnabled(settings = {}, env = process.env) {
  const killSwitch = clean(env.AI_SUGGESTIONS_ENABLED).toLowerCase();
  if (killSwitch === 'false') return false;
  if (!clean(env.GEMINI_API_KEY)) return false;
  return settings.enabled === true && settings.analyze_on_inbound === true;
}

/** קירור לפי טלפון. בזיכרון בלבד — אחרי אתחול שרת הניתוח הבא מותר מיד. */
export function analysisAllowed(phone, { now = Date.now(), cooldownMs = REANALYZE_COOLDOWN_MS } = {}) {
  const key = clean(phone);
  if (!key) return true;
  const last = lastAnalyzedByPhone.get(key) || 0;
  if (now - last < cooldownMs) return false;
  lastAnalyzedByPhone.set(key, now);
  return true;
}

export function resetAnalysisCooldown(phone) {
  if (phone) lastAnalyzedByPhone.delete(clean(phone));
  else lastAnalyzedByPhone.clear();
}

export { HISTORY_MESSAGES, MAX_ACTIONS_PER_RUN, MIN_CONFIDENCE, REANALYZE_COOLDOWN_MS };

// Auto-deploy connectivity check — see git history for context.
