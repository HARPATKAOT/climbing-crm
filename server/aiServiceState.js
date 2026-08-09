export const AI_STATE_COLLECTION = 'ai_service_state';
export const AI_STATE_ID = 'gemini';

const TRANSIENT_FAILURE_LIMIT = 3;
const PROBE_INTERVAL_MS = 5 * 60 * 1000;

export function defaultAiServiceState() {
  return {
    id: AI_STATE_ID,
    status: 'healthy',
    consecutive_failures: 0,
    outage_id: null,
    failed_at: null,
    recovered_at: null,
    last_error: '',
    next_probe_at: null,
    outage_alerted_at: null,
    recovery_alerted_at: null,
    updated_at: new Date().toISOString(),
  };
}

export function getAiServiceState(db) {
  return db?.getOne?.(AI_STATE_COLLECTION, AI_STATE_ID) || defaultAiServiceState();
}

export function isAiServiceOpen(db, now = new Date()) {
  const state = getAiServiceState(db);
  const opened = state.status === 'quota_exhausted'
    || (state.status === 'degraded' && Boolean(state.next_probe_at));
  return opened;
}

function stateIsOpen(state) {
  return state?.status === 'quota_exhausted'
    || (state?.status === 'degraded' && Boolean(state?.next_probe_at));
}

async function saveState(db, persist, state) {
  const existing = db.getOne(AI_STATE_COLLECTION, AI_STATE_ID);
  const saved = existing
    ? db.update(AI_STATE_COLLECTION, AI_STATE_ID, state)
    : db.insert(AI_STATE_COLLECTION, state);
  if (saved && typeof persist === 'function') await persist(AI_STATE_COLLECTION, saved);
  return saved;
}

export function classifyAiFailure(error = '') {
  const value = String(error || '').toLowerCase();
  if (/quota|resource_exhausted|http\s*429|429/.test(value)) return 'quota_exhausted';
  if (/no_model|no_api_key|api key|configuration/.test(value)) return 'configuration';
  return 'transient';
}

export async function recordAiFailure(db, persist, error, { now = new Date() } = {}) {
  const previous = getAiServiceState(db);
  const kind = classifyAiFailure(error);
  const failures = Number(previous.consecutive_failures || 0) + 1;
  const mustOpen = kind !== 'transient' || failures >= TRANSIENT_FAILURE_LIMIT;
  const timestamp = new Date(now).toISOString();
  const alreadyOpen = stateIsOpen(previous);
  const outageId = alreadyOpen && previous.outage_id
    ? previous.outage_id
    : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const next = {
    ...previous,
    status: mustOpen && kind === 'quota_exhausted' ? 'quota_exhausted' : 'degraded',
    consecutive_failures: failures,
    outage_id: outageId,
    failed_at: previous.failed_at || timestamp,
    last_error: String(error || kind).slice(0, 500),
    next_probe_at: mustOpen ? new Date(new Date(now).getTime() + PROBE_INTERVAL_MS).toISOString() : null,
    recovered_at: null,
    recovery_alerted_at: null,
    updated_at: timestamp,
  };
  return { state: await saveState(db, persist, next), opened: mustOpen && !alreadyOpen, mustOpen, kind };
}

export async function recordAiSuccess(db, persist, { now = new Date() } = {}) {
  const previous = getAiServiceState(db);
  const wasOpen = stateIsOpen(previous);
  const timestamp = new Date(now).toISOString();
  const next = {
    ...previous,
    status: 'healthy',
    consecutive_failures: 0,
    recovered_at: wasOpen ? timestamp : previous.recovered_at,
    last_error: '',
    next_probe_at: null,
    updated_at: timestamp,
  };
  return { state: await saveState(db, persist, next), recovered: wasOpen };
}

export async function markAiAlertSent(db, persist, kind, { now = new Date() } = {}) {
  const previous = getAiServiceState(db);
  const field = kind === 'recovery' ? 'recovery_alerted_at' : 'outage_alerted_at';
  const next = { ...previous, [field]: new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
  return saveState(db, persist, next);
}

export function aiProbeDue(db, now = new Date()) {
  const state = getAiServiceState(db);
  return stateIsOpen(state)
    && (!state.next_probe_at || new Date(state.next_probe_at).getTime() <= new Date(now).getTime());
}

export { PROBE_INTERVAL_MS };
