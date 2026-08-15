#!/usr/bin/env node
/**
 * 04-rewrite-urls.mjs — run 04-rewrite-urls.sql against the NEW Supabase
 * project and prove it worked.
 *
 * What it does, in order:
 *   1. resolves config from server/.env plus flags (never printing a secret)
 *   2. proves it is talking to the target database, and that the target is not
 *      the source
 *   3. prints the BEFORE count of rows still holding the old project ref
 *   4. runs 04-rewrite-urls.sql — which ROLLS BACK unless --confirm was given
 *   5. CHECKS the machine-readable markers the SQL emits, rather than printing
 *      output and hoping somebody reads it: the in-transaction result, the
 *      commit/rollback that actually happened, and the residual scan
 *   6. prints the AFTER count, and the delta
 *
 * Without --confirm this is a dry run at both layers: the wrapper passes
 * apply=off and the SQL rolls its own transaction back. Nothing is written.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *   It proves no row in schema `public` still holds the old ref, and that the
 *   rewritten rows now hold the new one. It does NOT prove the images load:
 *   the bucket objects are copied by 03-copy-storage.mjs, and a correct URL
 *   pointing at an object that was never copied is a 404 that this script would
 *   otherwise report as success. Pass --check-urls to HEAD a sample and close
 *   that gap.
 *
 * Usage
 *   node migration/04-rewrite-urls.mjs --target-url "postgresql://..."            # dry run
 *   node migration/04-rewrite-urls.mjs --target-url "postgresql://..." --confirm  # writes
 *
 * Flags
 *   --target-url <conn>  connection string for the NEW project. Defaults to
 *                        TARGET_DATABASE_URL from the environment or server/.env.
 *                        Use the SESSION-mode pooler (port 5432); the direct
 *                        db.<ref>.supabase.co host is IPv6-only.
 *   --new-ref <ref>      target project ref. Derived from --target-url when
 *                        omitted; when given, it must agree with the URL.
 *   --old-ref <ref>      source project ref. Defaults to the ref in SUPABASE_URL
 *                        from server/.env, else xaxykjvqqhrodmseqleu.
 *   --env-file <path>    default: <repo>/server/.env (falls back to the main
 *                        checkout's copy when run from a git worktree).
 *   --psql-bin <dir>     directory holding psql. Default: PG_BIN_DIR / PGTOOLS_BIN
 *                        from the environment, else the vendored 17.11 build.
 *   --no-scan            skip the SQL's residual scan. Turns off the only check
 *                        that can prove the rewrite was complete, so the final
 *                        message says so instead of claiming success.
 *   --check-urls         after the run, HEAD a sample of the rewritten URLs to
 *                        see whether the objects exist in the new bucket.
 *                        Read-only; makes no database writes.
 *   --sample <n>         how many URLs per target --check-urls fetches (default 3).
 *   --confirm            actually commit the rewrite.
 *
 * Exit codes
 *   0  every check passed (dry run, or a confirmed run with a clean scan)
 *   1  bad usage / bad configuration / a check failed
 *   2  psql itself failed
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const SQL_FILE = path.join(HERE, '04-rewrite-urls.sql');

/** Where the Postgres 17.11 client tools were unpacked. Not on PATH. */
const DEFAULT_PG_BIN =
  'C:/Users/dalak/AppData/Local/Temp/claude/C--Users-dalak--gemini-antigravity-scratch-climbing-crm/831be2e5-05df-49e1-b84d-49a76a2e4bdd/scratchpad/pgtools/pgsql/bin';

/** The project being moved out of. Overridable; server/.env usually knows it. */
const FALLBACK_OLD_REF = 'xaxykjvqqhrodmseqleu';

const REF_PATTERN = /^[a-z0-9]{20}$/;

/** The three places an absolute storage URL is durably stored. See the .sql. */
const TARGETS = [
  { key: 'pricelist_image', label: 'kv_collections[pricelist].data->>image' },
  { key: 'form_template_cover', label: 'form_templates.cover_image' },
  { key: 'product_category_image', label: 'kv_collections[product_categories].data->>image' },
];

/**
 * The residual scan reports coarse locations. These are the ones the three
 * statements above are responsible for; anything else the scan turns up is a
 * place nothing in this file rewrites, and therefore a reason to stop.
 */
const COVERED_COLUMNS = new Set(['kv_collections.data', 'form_templates.cover_image']);
const COVERED_COLLECTIONS = new Set(['pricelist', 'product_categories']);

// ─── tiny helpers ───────────────────────────────────────────────────────────

function die(message, code = 1) {
  console.error(`\n[04-rewrite-urls] ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const flags = { confirm: false, scan: true, checkUrls: false, sample: 3 };
  const takesValue = new Set([
    '--target-url', '--new-ref', '--old-ref', '--env-file', '--psql-bin', '--sample',
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--confirm') { flags.confirm = true; continue; }
    if (arg === '--no-scan') { flags.scan = false; continue; }
    if (arg === '--check-urls') { flags.checkUrls = true; continue; }
    if (arg === '--help' || arg === '-h') { flags.help = true; continue; }
    if (takesValue.has(arg)) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) die(`${arg} needs a value`);
      flags[arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      i += 1;
      continue;
    }
    die(`unknown argument: ${arg}`);
  }
  const sample = Number(flags.sample);
  if (!Number.isInteger(sample) || sample < 1 || sample > 50) {
    die('--sample must be a whole number between 1 and 50');
  }
  flags.sample = sample;
  return flags;
}

/** Minimal .env reader — no dependency, and it never echoes what it read. */
function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * server/.env is gitignored, so a linked worktree does not have one. Fall back
 * to the main checkout's copy rather than making the operator remember a path.
 */
function envFileCandidates(explicit) {
  if (explicit) return [path.resolve(explicit)];
  const candidates = [path.join(REPO_ROOT, 'server', '.env')];
  const marker = `${path.sep}.claude${path.sep}worktrees${path.sep}`;
  const at = REPO_ROOT.indexOf(marker);
  if (at !== -1) candidates.push(path.join(REPO_ROOT.slice(0, at), 'server', '.env'));
  return candidates;
}

function refFromSupabaseUrl(value) {
  const match = /^https?:\/\/([a-z0-9]{20})\.supabase\.(?:co|in)/i.exec(String(value || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * A password with a literal '%' in it makes decodeURIComponent throw, and an
 * uncaught URIError here would look like a bug in this script rather than a
 * connection string that needs percent-encoding.
 */
function safeDecode(value, what) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    die(
      `the ${what} in the connection string is not valid percent-encoding.\n` +
      "  Characters like % : / ? # @ must be escaped (a literal '%' is '%25').\n" +
      '  Nothing was printed from it.'
    );
    return '';
  }
}

/** `postgres.<ref>` (pooler user) or `db.<ref>.supabase.co` (direct host). */
function refFromConnection(url) {
  const fromUser = /^postgres\.([a-z0-9]{20})$/i.exec(safeDecode(url.username, 'username'));
  if (fromUser) return fromUser[1].toLowerCase();
  const fromHost = /^db\.([a-z0-9]{20})\.supabase\.(?:co|in)$/i.exec(url.hostname || '');
  if (fromHost) return fromHost[1].toLowerCase();
  return '';
}

function parseConnection(raw) {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    die('--target-url is not a valid connection string. Expected postgresql://user:password@host:port/database');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    die(`--target-url has scheme "${url.protocol}"; expected postgresql://`);
  }
  if (!url.hostname) die('--target-url has no host');
  return {
    url,
    host: url.hostname,
    port: url.port || '5432',
    user: safeDecode(url.username, 'username'),
    password: safeDecode(url.password, 'password'),
    database: safeDecode((url.pathname || '/postgres').slice(1), 'database name') || 'postgres',
    sslmode: url.searchParams.get('sslmode') || 'require',
  };
}

/** Safe to print: host, port, user and database, never the password. */
function redact(conn) {
  return `postgresql://${conn.user}:***@${conn.host}:${conn.port}/${conn.database}?sslmode=${conn.sslmode}`;
}

function resolvePsql(dir) {
  const binDir = dir || process.env.PG_BIN_DIR || process.env.PGTOOLS_BIN || DEFAULT_PG_BIN;
  const exe = process.platform === 'win32' ? 'psql.exe' : 'psql';
  const full = path.join(binDir, exe);
  if (!fs.existsSync(full)) {
    die(
      `psql not found at ${full}\n` +
      '  Point --psql-bin (or PG_BIN_DIR) at the directory that holds psql.'
    );
  }
  return full;
}

// ─── psql plumbing ──────────────────────────────────────────────────────────

/**
 * The password goes in the child's environment, never in argv, so it cannot be
 * read out of the process list or a shell history.
 */
function psqlEnv(conn) {
  return {
    ...process.env,
    PGHOST: conn.host,
    PGPORT: conn.port,
    PGUSER: conn.user,
    PGPASSWORD: conn.password,
    PGDATABASE: conn.database,
    PGSSLMODE: conn.sslmode,
    PGCONNECT_TIMEOUT: '20',
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: '04-rewrite-urls',
    // psql localises its own messages ("Pager usage is off.", "(3 rows)"), and a
    // Hebrew locale rendered through the Windows console codepage turns the row
    // counts this script exists to report into mojibake. Force the C locale for
    // the child only; it changes nothing about the data.
    LC_ALL: 'C',
    LC_MESSAGES: 'C',
    LANG: 'C',
  };
}

function runPsql(psql, conn, { args = [], input = null, label }) {
  const result = spawnSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', ...args], {
    env: psqlEnv(conn),
    encoding: 'utf8',
    input: input ?? undefined,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) die(`could not run psql (${label}): ${result.error.message}`, 2);
  return {
    code: result.status,
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

/**
 * Pull the [[REWRITE|...]] lines out of psql's output. Extracted by regex, not
 * by column position, so psql's table borders and padding do not matter.
 */
function readMarkers(stdout) {
  const found = [];
  const re = /\[\[REWRITE\|(.*?)\]\]/g;
  let match;
  while ((match = re.exec(stdout)) !== null) found.push(match[1].split('|'));
  return found;
}

function markerMap(markers, kind) {
  const out = new Map();
  for (const parts of markers) {
    if (parts[0] === kind && parts.length >= 3) out.set(parts[1], Number(parts[2]));
  }
  return out;
}

/** One value per line, `label|count`, so the counts can be compared in JS. */
function countQuery() {
  return `
select 'pricelist_image', count(*)
  from kv_collections
 where collection = 'pricelist'
   and strpos(coalesce(data->>'image', ''), :'old_ref') > 0
union all
select 'form_template_cover', count(*)
  from form_templates
 where strpos(coalesce(cover_image, ''), :'old_ref') > 0
union all
select 'product_category_image', count(*)
  from kv_collections
 where collection = 'product_categories'
   and strpos(coalesce(data->>'image', ''), :'old_ref') > 0;
`;
}

function readCounts(psql, conn, oldRef, when) {
  const run = runPsql(psql, conn, {
    args: ['-A', '-F', '|', '-t', '-q', '-v', `old_ref=${oldRef}`],
    input: countQuery(),
    label: `${when} counts`,
  });
  if (run.code !== 0) {
    process.stderr.write(run.stderr);
    die(`counting rows on the old ref failed (${when}). See the psql error above.`, 2);
  }
  const counts = {};
  for (const line of run.stdout.split(/\r?\n/)) {
    const [key, value] = line.split('|');
    if (!key || value === undefined) continue;
    counts[key.trim()] = Number(value.trim());
  }
  for (const target of TARGETS) {
    if (!Number.isFinite(counts[target.key])) {
      die(`the ${when} count for ${target.label} came back unreadable — aborting rather than guessing.`, 2);
    }
  }
  return counts;
}

function printCounts(title, counts, previous = null) {
  const width = Math.max(...TARGETS.map((t) => t.label.length), 'TOTAL rows on the old ref'.length);
  console.log(`  ${title}`);
  for (const target of TARGETS) {
    const now = counts[target.key];
    const was = previous ? previous[target.key] : null;
    const delta = previous ? `   (was ${was}, ${now - was >= 0 ? '+' : ''}${now - was})` : '';
    console.log(`    ${target.label.padEnd(width)}  ${String(now).padStart(5)}${delta}`);
  }
  const total = TARGETS.reduce((sum, t) => sum + counts[t.key], 0);
  console.log(`    ${'TOTAL rows on the old ref'.padEnd(width)}  ${String(total).padStart(5)}`);
}

// ─── main ───────────────────────────────────────────────────────────────────

const flags = parseArgs(process.argv.slice(2));

if (flags.help) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

if (!fs.existsSync(SQL_FILE)) die(`missing ${SQL_FILE}`);

// config -------------------------------------------------------------------
let envPath = '';
let fileEnv = {};
for (const candidate of envFileCandidates(flags.envFile)) {
  if (fs.existsSync(candidate)) {
    envPath = candidate;
    fileEnv = loadEnvFile(candidate);
    break;
  }
}
if (flags.envFile && !envPath) die(`--env-file not found: ${flags.envFile}`);

const setting = (name) => process.env[name] || fileEnv[name] || '';

const targetUrlRaw = flags.targetUrl || setting('TARGET_DATABASE_URL');
if (!targetUrlRaw) {
  die(
    'no target connection string.\n' +
    '  Pass --target-url, or set TARGET_DATABASE_URL in the environment or server/.env.\n' +
    '  It must point at the NEW project, session-mode pooler, port 5432:\n' +
    '    postgresql://postgres.<newref>:<password>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres\n' +
    '  (db.<ref>.supabase.co is IPv6-only and will not connect from here.)'
  );
}

const conn = parseConnection(targetUrlRaw);

const oldRef = (flags.oldRef || refFromSupabaseUrl(setting('SUPABASE_URL')) || FALLBACK_OLD_REF).toLowerCase();
if (!REF_PATTERN.test(oldRef)) {
  die(`old ref "${oldRef}" is not a Supabase project ref (20 lowercase alphanumerics). Pass --old-ref.`);
}

const refInUrl = refFromConnection(conn.url);
const newRef = (flags.newRef || refInUrl).toLowerCase();
if (!REF_PATTERN.test(newRef)) {
  die(
    'could not determine the new project ref.\n' +
    `  The connection string's user is "${conn.user}" and host is "${conn.host}"; neither looks like\n` +
    '  postgres.<ref> or db.<ref>.supabase.co. Pass --new-ref explicitly.'
  );
}
if (refInUrl && flags.newRef && refInUrl !== newRef) {
  die(
    `--new-ref is ${newRef} but the connection string points at ${refInUrl}.\n` +
    '  Refusing to rewrite rows to a ref that is not the database being written to.'
  );
}
if (newRef === oldRef) {
  die(
    `the target connection points at ${newRef}, which is the OLD project.\n` +
    '  This script rewrites rows in the NEW project. Refusing to touch the source.'
  );
}

const psql = resolvePsql(flags.psqlBin);

// plan ---------------------------------------------------------------------
console.log('');
console.log('04-rewrite-urls — repoint absolute storage URLs at the new project');
console.log('─────────────────────────────────────────────────────────────────');
console.log(`  mode        : ${flags.confirm ? 'APPLY (will commit)' : 'DRY RUN (rolls back; pass --confirm to commit)'}`);
console.log(`  old ref     : ${oldRef}`);
console.log(`  new ref     : ${newRef}`);
console.log(`  target      : ${redact(conn)}`);
console.log(`  sql         : ${SQL_FILE}`);
console.log(`  psql        : ${psql}`);
console.log(`  env file    : ${envPath || '(none found — using process environment only)'}`);
console.log(`  residual scan: ${flags.scan ? 'on' : 'OFF — completeness will NOT be proven'}`);
console.log(`  url check   : ${flags.checkUrls ? `on (${flags.sample} per target)` : 'off (pass --check-urls)'}`);
console.log('');
console.log('  Rewrites (all guarded, all idempotent):');
console.log("    1. kv_collections WHERE collection='pricelist'           -> data->>'image'   [jsonb, not a column]");
console.log('    2. public.form_templates.cover_image                      [real text column]');
console.log("    3. kv_collections WHERE collection='product_categories'  -> data->>'image'   [jsonb, expected 0]");
console.log('');

// identity probe -----------------------------------------------------------
// Asks only for catalogue facts, so a database that is missing the tables still
// answers instead of failing to parse — the difference between "cannot connect"
// and "connected, but this is not a finished restore" matters at 2am.
const probe = runPsql(psql, conn, {
  args: ['-A', '-F', '|', '-t', '-q'],
  input:
    "select current_database(), current_user, coalesce(inet_server_addr()::text, 'via pooler'), " +
    "(to_regclass('public.kv_collections') is not null), " +
    "(to_regclass('public.form_templates') is not null);",
  label: 'identity probe',
});
if (probe.code !== 0) {
  process.stderr.write(probe.stderr);
  die('could not connect to the target database. See the psql error above.', 2);
}
const [db, user, addr, hasKv, hasFt] = probe.stdout.trim().split('|');
console.log('  Connected:');
console.log(`    database ${db}   user ${user}   server ${addr}`);

const missingTables = [];
if (hasKv !== 't') missingTables.push('public.kv_collections');
if (hasFt !== 't') missingTables.push('public.form_templates');
if (missingTables.length) {
  die(
    `connected fine, but ${missingTables.join(' and ')} ${missingTables.length > 1 ? 'are' : 'is'} missing.\n` +
    '  This is not a finished restore. All 76 operational collections — pricelist among\n' +
    '  them — live inside kv_collections. Restore the dump before rewriting URLs.'
  );
}

const rowProbe = runPsql(psql, conn, {
  args: ['-A', '-F', '|', '-t', '-q'],
  input: 'select (select count(*) from kv_collections), (select count(*) from form_templates);',
  label: 'row counts',
});
if (rowProbe.code !== 0) {
  process.stderr.write(rowProbe.stderr);
  die('could not read row counts from the target database. See the psql error above.', 2);
}
const [kvRows, ftRows] = rowProbe.stdout.trim().split('|');
console.log(`    kv_collections rows: ${kvRows}    form_templates rows: ${ftRows}`);
if (Number(kvRows) === 0) {
  die(
    'kv_collections is empty. The rewrite would report a tidy zero and change nothing,\n' +
    '  which is the most convincing way to fail. Restore the dump first.'
  );
}
console.log('');

// before -------------------------------------------------------------------
const before = readCounts(psql, conn, oldRef, 'BEFORE');
printCounts('BEFORE — rows still holding the old ref:', before);

const beforeTotal = TARGETS.reduce((sum, t) => sum + before[t.key], 0);
if (beforeTotal === 0) {
  console.log('');
  console.log('  Nothing to do: no row in the three targets holds the old ref.');
  console.log('  (Already rewritten, or this is not the migrated database.)');
}
console.log('');

// run the sql --------------------------------------------------------------
console.log(`  Running ${path.basename(SQL_FILE)} with apply=${flags.confirm ? 'on' : 'off'} ...`);
console.log('');
const sqlRun = runPsql(psql, conn, {
  args: [
    '-f', SQL_FILE,
    '-v', `old_ref=${oldRef}`,
    '-v', `new_ref=${newRef}`,
    '-v', `apply=${flags.confirm ? 'on' : 'off'}`,
    '-v', `scan=${flags.scan ? 'on' : 'off'}`,
  ],
  label: 'rewrite',
});
for (const line of sqlRun.stdout.split(/\r?\n/)) console.log(line ? `  | ${line}` : '  |');
if (sqlRun.stderr.trim()) {
  console.log('');
  console.log('  psql notices and errors:');
  for (const line of sqlRun.stderr.split(/\r?\n/)) if (line.trim()) console.log(`  ! ${line}`);
}

// ─── read what actually happened, instead of assuming ──────────────────────
const markers = readMarkers(sqlRun.stdout);
const resultMarker = markers.find((m) => m[0] === 'RESULT');
const outcome = resultMarker ? resultMarker[1] : '';
const updated = markerMap(markers, 'UPDATED');
const afterInTx = markerMap(markers, 'AFTER_IN_TX');
const newRefInTx = markerMap(markers, 'NEWREF');
const kvScan = markers.filter((m) => m[0] === 'KVSCAN');
const colScan = markers.filter((m) => m[0] === 'SCAN');
const scanRan = markers.some((m) => m[0] === 'SCAN_DONE');

if (sqlRun.code !== 0) {
  // The commit happens BEFORE the residual scan, so "psql failed" and "nothing
  // was written" are not the same statement. Saying the wrong one here sends
  // the operator to the rollback runbook for a migration that already landed.
  if (outcome === 'COMMITTED') {
    die(
      `psql exited ${sqlRun.code}, but the rewrite was ALREADY COMMITTED before it failed.\n` +
      '  The failure came from the residual scan that runs after the commit (a 2-minute\n' +
      '  statement_timeout is the usual cause). The database is written; do NOT roll back.\n' +
      '  Re-run this script — it is idempotent — to get a clean verification.',
      2
    );
  }
  die(
    `psql exited ${sqlRun.code} before the transaction reached commit or rollback.\n` +
    '  Nothing was changed: an aborted psql session rolls its open transaction back.\n' +
    '  Fix the error above and re-run.',
    2
  );
}

if (!outcome) {
  die(
    'the SQL finished without emitting a [[REWRITE|RESULT|...]] marker, so this script\n' +
    '  cannot tell whether it committed. Re-run; if it happens again, 04-rewrite-urls.sql\n' +
    '  and this wrapper are out of sync and must not be trusted to report the outcome.',
    2
  );
}
if (flags.confirm && outcome !== 'COMMITTED') {
  die(`--confirm was given but the SQL reported ${outcome}. Nothing was written.`);
}
if (!flags.confirm && outcome !== 'ROLLED_BACK') {
  die(
    `this was a dry run, but the SQL reported ${outcome}.\n` +
    '  Treat the target as MODIFIED and verify it before doing anything else.'
  );
}

// The in-transaction picture is the real dry-run result: it is what a commit
// would leave behind. Checking it here is the difference between a dry run and
// a wall of text.
const leftover = TARGETS.filter((t) => (afterInTx.get(t.key) ?? -1) !== 0);
if (afterInTx.size !== TARGETS.length) {
  die('the SQL did not report an in-transaction count for every target. Not trusting the result.', 2);
}
if (leftover.length) {
  console.log('');
  console.log('  The rewrite did NOT clear every target inside its own transaction:');
  for (const t of leftover) console.log(`    ${t.label}: ${afterInTx.get(t.key)} still on the old ref`);
  die('the three statements do not cover everything they were supposed to. Nothing committed.');
}

console.log('');
console.log('  Inside the transaction:');
{
  const width = Math.max(...TARGETS.map((t) => t.label.length));
  for (const t of TARGETS) {
    console.log(
      `    ${t.label.padEnd(width)}  rewrote ${String(updated.get(t.key) ?? 0).padStart(4)}` +
      `   old-ref left ${afterInTx.get(t.key)}   now on new ref ${newRefInTx.get(t.key) ?? '?'}`
    );
  }
}

// A rewrite that leaves zero rows on the old ref is also what an empty table
// looks like. The positive count is what tells the two apart.
const newRefTotal = TARGETS.reduce((sum, t) => sum + (newRefInTx.get(t.key) ?? 0), 0);
if (beforeTotal > 0 && newRefTotal === 0) {
  die(
    'no row holds the NEW ref after the rewrite, even though rows held the old one.\n' +
    '  That is not a completed rewrite, whatever the zero above suggests.'
  );
}

// ─── residual scan verdict ─────────────────────────────────────────────────
// Printing the scan and exiting 0 regardless would be the same as not running
// it. These are the checks that make the header's "that is the whole surface"
// claim mean something.
if (!flags.scan) {
  console.log('');
  console.log('  Residual scan was skipped (--no-scan). Completeness is UNVERIFIED:');
  console.log('  a photo that landed somewhere the three statements do not cover would');
  console.log('  not be reported by anything above.');
} else if (!scanRan) {
  die('the residual scan was requested but reported no result. Not claiming completeness.', 2);
} else {
  const uncoveredColumns = colScan.filter((m) => !COVERED_COLUMNS.has(`${m[1]}.${m[2]}`));
  const uncoveredCollections = kvScan.filter((m) => !COVERED_COLLECTIONS.has(m[1]));

  if (uncoveredColumns.length || uncoveredCollections.length) {
    console.log('');
    console.log('  The residual scan found the old ref in places nothing here rewrites:');
    for (const m of uncoveredColumns) console.log(`    column     ${m[1]}.${m[2]}  ${m[3]} row(s)`);
    for (const m of uncoveredCollections) console.log(`    collection ${m[1]}  ${m[2]} row(s)`);
    console.log('');
    console.log('  Add them to 04-rewrite-urls.sql before cutover, or they stay pointed at');
    console.log('  the old project after it is deleted.');
    die('residual scan found uncovered locations.');
  }

  if (flags.confirm) {
    if (colScan.length || kvScan.length) {
      console.log('');
      console.log('  Committed, but the old ref is still present after the commit:');
      for (const m of colScan) console.log(`    column     ${m[1]}.${m[2]}  ${m[3]} row(s)`);
      for (const m of kvScan) console.log(`    collection ${m[1]}  ${m[2]} row(s)`);
      die('the rewrite committed but did not finish. Re-run; if it repeats, investigate before cutover.');
    }
    console.log('');
    console.log('  Residual scan: clean. The old ref appears in no text, varchar, json or');
    console.log('  jsonb column of any base table in schema public.');
  } else {
    console.log('');
    console.log('  Residual scan: every hit is inside a location the rewrite covers');
    console.log('  (the counts still show the pre-rewrite state, because the dry run rolled back).');
  }
}

// after --------------------------------------------------------------------
console.log('');
const after = readCounts(psql, conn, oldRef, 'AFTER');
// The delta is only meaningful after a commit; in a dry run it is always zero
// and reads like a failure.
printCounts('AFTER — rows still holding the old ref:', after, flags.confirm ? before : null);

const afterTotal = TARGETS.reduce((sum, t) => sum + after[t.key], 0);
console.log('');

// ─── optional: do the rewritten URLs actually resolve? ─────────────────────

/**
 * One object, probed honestly.
 *
 * A dropped connection is not a 404, and reporting it as one would send the
 * operator to re-run the storage copy over data that is already fine. This host
 * reaches Supabase over a long link and a transient `fetch failed` is common
 * enough to have shown up in testing, so a network error is retried and, if it
 * persists, reported as UNVERIFIED rather than as a missing object.
 *
 * Some CDNs refuse HEAD; a 405/501 is answered with a one-byte ranged GET
 * instead of being counted as missing.
 */
async function probeObject(url, attempts = 3) {
  let lastError = '';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      let response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          signal: AbortSignal.timeout(15000),
        });
      }
      return { state: response.ok ? 'ok' : 'missing', detail: String(response.status) };
    } catch (error) {
      lastError = error?.message || String(error);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
    }
  }
  return { state: 'unverified', detail: `network error: ${lastError}` };
}

async function checkUrls() {
  const query = `
select * from (
  select 'pricelist' as src, data->>'image' as url from kv_collections
   where collection = 'pricelist' and strpos(coalesce(data->>'image',''), :'new_ref') > 0
   limit ${flags.sample}) a
union all
select * from (
  select 'form_templates', cover_image from form_templates
   where strpos(coalesce(cover_image,''), :'new_ref') > 0
   limit ${flags.sample}) b
union all
select * from (
  select 'product_categories', data->>'image' from kv_collections
   where collection = 'product_categories' and strpos(coalesce(data->>'image',''), :'new_ref') > 0
   limit ${flags.sample}) c;
`;
  const run = runPsql(psql, conn, {
    args: ['-A', '-F', '|', '-t', '-q', '-v', `new_ref=${newRef}`],
    input: query,
    label: 'url sample',
  });
  if (run.code !== 0) {
    process.stderr.write(run.stderr);
    console.log('  Could not read a URL sample; skipping the reachability check.');
    return true;
  }
  const rows = run.stdout.split(/\r?\n/)
    .map((line) => line.split('|'))
    .filter((parts) => parts.length >= 2 && parts[1].startsWith('http'));
  if (!rows.length) {
    console.log('  No rewritten URL to check.');
    return true;
  }
  console.log(`  Checking ${rows.length} rewritten URL(s) (read-only, retried on network error):`);
  let missing = 0;
  let unverified = 0;
  for (const [src, url] of rows) {
    const { state, detail } = await probeObject(url);
    if (state === 'missing') missing += 1;
    if (state === 'unverified') unverified += 1;
    console.log(`    [${detail}] ${src}  ${url}`);
  }
  if (missing) {
    console.log('');
    console.log(`  ${missing} of ${rows.length} returned a non-2xx status. The rows are correct; the`);
    console.log('  OBJECTS are missing from the new project. Run 03-copy-storage.mjs, and make');
    console.log("  sure 'product-images' exists and is PUBLIC — it has no CREATE-bucket SQL in");
    console.log('  the repo and was originally created by hand.');
    return false;
  }
  if (unverified) {
    console.log('');
    console.log(`  ${unverified} of ${rows.length} could not be reached after retries. That is a network`);
    console.log('  result, not a verdict on the objects — it proves nothing either way. Re-run');
    console.log('  --check-urls, or open one of the URLs above in a browser.');
  }
  if (missing === 0 && unverified === 0) {
    console.log('  All sampled URLs returned 2xx: the objects exist in the new project.');
  }
  // Only a real HTTP answer counts against the run. An unreachable host must not
  // fail a migration step whose database work is already verified.
  return true;
}

let urlsOk = true;
if (flags.checkUrls) {
  urlsOk = await checkUrls();
  console.log('');
}

// ─── verdict ───────────────────────────────────────────────────────────────
if (!flags.confirm) {
  console.log('  DRY RUN — the transaction was rolled back, so AFTER equals BEFORE by design.');
  console.log(`  A commit would rewrite ${TARGETS.reduce((s, t) => s + (updated.get(t.key) ?? 0), 0)} row(s) and leave 0 on the old ref.`);
  console.log('  Re-run with --confirm to write it.');
  console.log('');
  process.exit(urlsOk ? 0 : 1);
}

if (afterTotal > 0) {
  console.log(`  ${afterTotal} row(s) still hold the old ref after a committed run.`);
  console.log('  Check the residual scan above: something is writing this ref from a path');
  console.log('  the three targeted statements do not cover.');
  console.log('');
  process.exit(1);
}

console.log(`  Done. ${beforeTotal} row(s) rewritten from ${oldRef} to ${newRef}; 0 remain.`);
if (!flags.checkUrls) {
  console.log('  The rows are right. That is not the same as the images loading: a correct URL');
  console.log('  pointing at an object that was never copied is still a 404. Re-run with');
  console.log('  --check-urls, or confirm 03-copy-storage.mjs finished.');
}
console.log("  'product-images' has no CREATE-bucket SQL in the repo — it was made by hand,");
console.log('  and must exist as a PUBLIC bucket in the new project.');
console.log('');
process.exit(urlsOk ? 0 : 1);
