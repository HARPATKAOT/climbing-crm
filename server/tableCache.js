/**
 * Serve list reads from memory, refresh from the durable store behind them.
 *
 * Every screen that opened used to wait for a full Supabase download of every
 * table it touched — 3.5s for `students`, 2.1s for `parents`, 2.7s for
 * `pricelist` — even though the server already holds those rows in memory and
 * every write path keeps them current. Switching a tab paid that toll again.
 *
 * What the old "prefer Supabase" reads actually guarded against was serving an
 * *empty* cache after a deploy, not a slightly stale one. So that is the only
 * case still worth blocking on: an empty table waits for the durable read, a
 * populated one answers immediately and refreshes in the background.
 */
import { supa } from './supa.js';
import { db } from './db.js';

/** How long a table may go unrefreshed before the next read triggers one. */
export const REFRESH_AFTER_MS = 30_000;

/**
 * What a read should do, given what is in memory and how old it is.
 * @returns {'memory'|'await-durable'|'refresh-behind'}
 */
export function readPlan({ durableEnabled, cachedCount, ageMs }) {
  if (!durableEnabled) return 'memory';
  if (cachedCount === 0) return 'await-durable';
  return ageMs > REFRESH_AFTER_MS ? 'refresh-behind' : 'memory';
}

const refreshedAt = new Map();
const inFlight = new Map();

/** Pull one table from the durable store into the in-memory cache. */
async function refreshTable(table) {
  const pending = inFlight.get(table);
  if (pending) return pending;

  const startedAt = Date.now();
  const run = (async () => {
    try {
      const rows = await supa.getAll(table);
      // null means the read failed — keep whatever is in memory.
      if (!Array.isArray(rows)) return null;
      // Refused when a local write landed mid-flight: the cache is then newer
      // than this response, and applying it would undo that write.
      const applied = db.hydrate(table, rows, startedAt);
      refreshedAt.set(table, Date.now());
      return applied ? rows : db.get(table) || [];
    } catch (error) {
      console.error(`refreshTable(${table}) failed:`, error?.message || error);
      return null;
    } finally {
      inFlight.delete(table);
    }
  })();

  inFlight.set(table, run);
  return run;
}

/**
 * Rows of `table`, served from memory whenever memory has any.
 * @returns {Promise<Array>} always an array — never null.
 */
export async function readTable(table) {
  const cached = db.get(table) || [];
  const plan = readPlan({
    durableEnabled: supa.isEnabled(),
    cachedCount: cached.length,
    ageMs: Date.now() - (refreshedAt.get(table) || 0),
  });
  if (plan === 'memory') return cached;
  if (plan === 'await-durable') return (await refreshTable(table)) ?? cached;
  refreshTable(table).catch(() => {});
  return cached;
}

/** Same contract as `readTable`, for the routes that need several tables. */
export async function readTables(...tables) {
  return Promise.all(tables.map((table) => readTable(table)));
}

/** Boot hydration already read these — don't re-download them on first request. */
export function markFreshlyLoaded(tables = []) {
  const now = Date.now();
  for (const table of tables) refreshedAt.set(table, now);
}
