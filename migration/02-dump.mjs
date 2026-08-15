#!/usr/bin/env node
/**
 * 02-dump.mjs — full pre-cutover backup of the OLD Supabase project.
 *
 * Part of the ap-northeast-2 (Seoul) -> eu-central-1 (Frankfurt) move. Supabase
 * cannot move a region in place: a NEW project is created and this dump is
 * restored into it. This script only READS. It never writes to the database,
 * never drops anything, and never touches the Supabase project itself.
 *
 *   node migration/02-dump.mjs [stamp] [options]
 *
 *   stamp                 subfolder under migration/dump/ (default: UTC timestamp)
 *   --dry-run             run the read-only preflight, print the plan, dump nothing
 *   --out <dir>           override migration/dump
 *   --env-file <path>     override the server/.env lookup
 *   --pg-bin <dir>        override PG_BIN
 *   --with-role-passwords include SCRAM password hashes in 00-roles.sql (off by default)
 *   --no-full             skip the 90-full.dump custom-format archive
 *   --no-ref-scan         skip the scan for rows holding the old project ref in a URL
 *   --allow-other-project connect even if the ref is not the expected old project
 *   --force               write into a stamp folder that already holds a backup
 *   --timeout-min <n>     per-pg_dump timeout in minutes (default 45)
 *   --help
 *
 * Re-running with a stamp that already exists is REFUSED without --force. Two
 * backups interleaved in one folder produce a manifest that describes neither,
 * and the older one is the thing you would have cut over on.
 *
 * ── WHAT IS CAPTURED, AND WHY IT IS SPLIT THIS WAY ──────────────────────────
 * A Postgres dump of `public` alone is NOT enough to bring this CRM back up:
 *
 *  - auth.users AND auth.identities live in the `auth` schema. Password hashes
 *    are portable, but without BOTH tables every staff login fails: GoTrue
 *    matches the login to a row in auth.identities, not just to auth.users.
 *  - storage.buckets carries the three bucket definitions ('product-images',
 *    'client-documents', 'employee-documents'). 'product-images' has no
 *    CREATE-bucket SQL anywhere in the repo — it was made by hand in the
 *    dashboard, so this dump is the only record of it.
 *  - storage.objects rows are METADATA ONLY. The bytes live in S3 behind the
 *    storage API and are NOT in any Postgres dump. Copying the objects is a
 *    separate step; the manifest records per-bucket object counts and total
 *    bytes so that step can be verified.
 *  - supabase_migrations.schema_migrations is what the Supabase CLI uses to
 *    decide which migrations still need to run. Lose it and the next `db push`
 *    replays everything.
 *  - Extensions, SECURITY DEFINER functions, triggers, RLS policies, grants and
 *    sequences all ride along inside the per-schema dumps, except CREATE
 *    EXTENSION itself, which pg_dump only emits for a whole-database dump. This
 *    script therefore generates 01-globals.sql from the catalog by hand.
 *
 * Restore ORDER matters and plain --data-only dumps do not solve it: pg_dump
 * sorts data by table name, not by foreign key. auth.identities would be
 * restored before auth.users and the FK would reject every row. Two artifacts
 * exist to sidestep that without needing superuser at restore time:
 *   02-public-complete.sql  schema + data + constraints in pg_dump's own order
 *                           (COPY runs before the FKs are created)
 *   07-auth-core-data.sql   auth.users first, then auth.identities, produced by
 *                           two pg_dump runs concatenated in that order
 * The separate schema-only / data-only files are kept for inspection and for a
 * restore that prefers to load the schema first.
 *
 * ── POOLER LIMITATIONS AND THE WORKAROUNDS USED HERE ────────────────────────
 * The direct host db.<ref>.supabase.co is IPv6-only and this network has no
 * IPv6, so everything goes through the SESSION-mode pooler
 * (aws-1-ap-northeast-2.pooler.supabase.com:5432, user postgres.<ref>).
 * That imposes five constraints, each handled below:
 *
 *  1. TRANSACTION mode (port 6543) would break pg_dump outright — it cannot
 *     hold a transaction across statements. The script REFUSES to run on 6543.
 *  2. The direct IPv6-only host would simply time out. The script REFUSES a
 *     db.<ref>.supabase.co host and says what to use instead.
 *  3. Parallel dump (-j) needs several connections sharing one snapshot and
 *     pins several pooler sessions at once against a 60-connection server.
 *     Not worth the flakiness for a database this size: every dump here is
 *     single-connection, run one after another.
 *  4. The `postgres` role has statement_timeout = 2min through the pooler.
 *     pg_dump sets its own statement_timeout = 0 per session, so dumps are
 *     safe, but the manifest's row counts are plain queries and would be
 *     killed on a big table — every counting session issues
 *     `SET statement_timeout = 0` first. Startup `options=-c ...` is NOT used;
 *     Supavisor is inconsistent about passing it through.
 *  5. A dozen separate pg_dump runs would mean a dozen different snapshots, so
 *     a registration arriving mid-backup could land in one file and not another.
 *     Fixed by exporting ONE snapshot: a psql session holds
 *     `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_export_snapshot();`
 *     open for the whole run, every pg_dump gets --snapshot=<id>, and the row
 *     counts run in a second session with SET TRANSACTION SNAPSHOT. Verified to
 *     work through this pooler.
 *
 *     Three details make that survivable over a ~13 minute intercontinental run:
 *       - The holder is poked with a SELECT between steps, never by a timer.
 *         execFileSync blocks the event loop for the whole of each pg_dump, so
 *         a setInterval heartbeat would never fire. (A run was observed losing
 *         the snapshot exactly that way.)
 *       - Losing it is not fatal. A dropped connection costs one retry, then the
 *         snapshot is dropped, the rest of the run continues without it, and
 *         manifest.consistency records mode "degraded" plus the step it died in.
 *       - The counts run FIRST, right after the export, because they are what
 *         the restore is verified against. Dumps take minutes; the numbers that
 *         prove the dump should not be the thing left until last.
 *
 *     If a count still cannot be taken, the run reports INCOMPLETE and exits
 *     non-zero: a backup whose contents cannot be verified is not a backup.
 *
 * ── "READ-ONLY" IS ENFORCED, NOT JUST PROMISED ─────────────────────────────
 * Every transaction this script opens for itself is BEGIN … REPEATABLE READ
 * READ ONLY, so the server rejects a write instead of a comment promising there
 * will not be one. pg_dump and pg_dumpall only read by construction. Nothing
 * here issues INSERT/UPDATE/DELETE/DDL, and nothing touches the Supabase
 * Management API. The only things written are files under the output folder.
 *
 * ── WHAT THE OLD-REF SCAN ACTUALLY COVERS ──────────────────────────────────
 * Every text, varchar, char, json and jsonb column of every ordinary table in
 * public, auth and storage is matched against the old project ref, and only
 * ROW COUNTS come back — never a value, because these columns include
 * auth.users.encrypted_password and customer PII. There is no column-name
 * heuristic: an earlier version only looked at columns named like %image%,
 * %url%, %doc%… which silently skipped every jsonb field outside
 * kv_collections (messages.meta, employees.data, health_declarations.
 * form_snapshot, finance_expenses.attachment_metadata, app_settings.value …)
 * while still reporting partial:false. What is still NOT covered, and is said
 * so in the manifest: bytea columns, and anything outside those three schemas.
 *
 * pg_dumpall --roles-only is used for roles, with --no-role-passwords, because
 * the hashes are a secret this backup does not need: the source project has no
 * custom roles at all, only Supabase's built-ins, which the new project creates
 * for itself. --with-role-passwords exists if that ever stops being true.
 *
 * The password is never passed on the command line — it goes to the child
 * processes through PGPASSWORD in their environment, so it cannot leak into a
 * process list or into this script's own output.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── Constants ──────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const DEFAULT_PG_BIN =
  'C:/Users/dalak/AppData/Local/Temp/claude/C--Users-dalak--gemini-antigravity-scratch-climbing-crm/831be2e5-05df-49e1-b84d-49a76a2e4bdd/scratchpad/pgtools/pgsql/bin';

/** The project being moved away from. Guards against dumping the wrong side. */
const EXPECTED_PROJECT_REF = 'xaxykjvqqhrodmseqleu';

/** Schemas that hold this application's data and must be dumped in full. */
const PRIMARY_SCHEMAS = ['public', 'auth', 'storage'];

/**
 * Schemas the Supabase platform rebuilds in a new project. Dumped schema-only,
 * as a reference for diffing the new project — never as a restore target.
 */
const MANAGED_SCHEMAS = [
  'graphql', 'graphql_public', 'realtime', 'vault', 'extensions',
  'pgbouncer', 'pgsodium', 'pgsodium_masks', 'net', '_analytics', '_realtime',
];

/** Non-system, non-managed schemas get a complete (schema + data) dump. */
const SYSTEM_SCHEMA_RE = /^(pg_|information_schema$)/;

/**
 * Column types the old-ref scan can match against. Deliberately NOT filtered by
 * column name: the 42 pricelist URLs live inside a jsonb document and a name
 * heuristic misses every jsonb field outside kv_collections.
 */
const SCANNABLE_TYPES = ['text', 'character varying', 'character', 'json', 'jsonb'];

/** Schemas the old-ref scan walks in full. */
const SCAN_SCHEMAS = ['public', 'auth', 'storage'];

/** psql field separator: a control character no CRM value contains. */
const SEP = '\u0001';

// ─── Small helpers ──────────────────────────────────────────────────────────

const log = (msg = '') => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stdout.write(`  !  ${msg}\n`);

function fail(msg) {
  process.stderr.write(`\nFATAL: ${msg}\n`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)}${units[unit]}`;
}

/**
 * Hash in 8MB chunks rather than readFileSync. public data is 19MB today, but a
 * whole-file read of a multi-GB dump throws AFTER every pg_dump has already
 * succeeded — losing the manifest, and with it the only record of what the
 * backup contains.
 */
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(8 * 1024 * 1024);
  const fd = fs.openSync(file, 'r');
  try {
    for (;;) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (read <= 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/**
 * A stable, non-reversible fingerprint of a secret, so the manifest can prove
 * which key was in force without ever holding the key. Used for the OLD
 * service_role key: signatureEvidence.js / otpService.js / mailingPreferences.js
 * fall through to it for their HMAC key, so after cutover the operator has to
 * show that EVIDENCE_SIGNING_SECRET on Render is that exact value — and this is
 * the only artifact that still remembers what it was.
 */
function secretFingerprint(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, 16);
}

/** Minimal .env reader — no dependency, and it must not evaluate anything. */
function parseEnvFile(file) {
  const out = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * server/.env is untracked, so it exists in the main checkout but usually not
 * in a worktree. Look in the worktree first, then in the checkout the worktree
 * was created from (resolved from the gitdir pointer in .git).
 */
function resolveEnvFile(override) {
  const candidates = [];
  if (override) candidates.push(path.resolve(override));
  if (process.env.ENV_FILE) candidates.push(path.resolve(process.env.ENV_FILE));
  candidates.push(path.join(REPO_ROOT, 'server', '.env'));

  const dotGit = path.join(REPO_ROOT, '.git');
  try {
    if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
      const pointer = /gitdir:\s*(.+)/.exec(fs.readFileSync(dotGit, 'utf8'));
      if (pointer) {
        // <main>/.git/worktrees/<name> -> <main>
        const mainRoot = path.resolve(pointer[1].trim(), '..', '..', '..');
        candidates.push(path.join(mainRoot, 'server', '.env'));
      }
    }
  } catch { /* a missing or odd .git is not fatal here */ }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  fail(
    `server/.env not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
    'Pass --env-file <path> to point at it.'
  );
  return '';
}

function resolvePgBin(override) {
  const dir = path.resolve(override || process.env.PG_BIN || DEFAULT_PG_BIN);
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const tools = {
    psql: path.join(dir, `psql${suffix}`),
    pgDump: path.join(dir, `pg_dump${suffix}`),
    pgDumpall: path.join(dir, `pg_dumpall${suffix}`),
    pgRestore: path.join(dir, `pg_restore${suffix}`),
  };
  for (const [name, file] of Object.entries(tools)) {
    if (!fs.existsSync(file)) {
      fail(
        `${name} not found at ${file}\n` +
        'Set PG_BIN (or --pg-bin) to the directory holding pg_dump/pg_dumpall/psql.'
      );
    }
  }
  return { dir, ...tools };
}

// ─── Connection ─────────────────────────────────────────────────────────────

function buildConnection(env, allowOtherProject) {
  const raw = (env.DATABASE_URL || '').trim();
  if (!raw) fail('DATABASE_URL is not set in server/.env');

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    fail(`DATABASE_URL is not a valid URL (${error.message})`);
  }

  const host = url.hostname;
  const port = url.port || '5432';
  const user = decodeURIComponent(url.username || '');
  const password = decodeURIComponent(url.password || '');
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres';

  if (/^db\..*\.supabase\.co$/i.test(host)) {
    fail(
      `DATABASE_URL points at the direct host ${host}, which is IPv6-only and\n` +
      'unreachable from this network. Use the SESSION-mode pooler instead:\n' +
      '  postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres'
    );
  }
  if (port === '6543') {
    fail(
      'DATABASE_URL uses port 6543 (transaction-mode pooler). pg_dump cannot work\n' +
      'there: it holds a transaction open across statements. Use port 5432 (session mode).'
    );
  }
  if (!password) fail('DATABASE_URL has no password.');

  const refFromUser = /^postgres\.([a-z0-9]+)$/i.exec(user);
  const projectRef = refFromUser ? refFromUser[1] : null;
  if (projectRef && projectRef !== EXPECTED_PROJECT_REF && !allowOtherProject) {
    fail(
      `DATABASE_URL points at project "${projectRef}", not the old project\n` +
      `"${EXPECTED_PROJECT_REF}". Refusing, so a backup of the NEW project cannot be\n` +
      'mistaken for the source. Pass --allow-other-project if this is deliberate.'
    );
  }

  const sslmode = url.searchParams.get('sslmode') || process.env.PGSSLMODE || 'require';

  // The password travels in the child environment, never in argv.
  const childEnv = {
    ...process.env,
    PGHOST: host,
    PGPORT: port,
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE: database,
    PGSSLMODE: sslmode,
    PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '30',
    // Hebrew data on a Windows host: force UTF-8 both ways or the dump is mojibake.
    PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: 'crm-migration-02-dump',
  };

  return { host, port, user, database, projectRef, sslmode, childEnv };
}

// ─── psql / pg_dump execution ───────────────────────────────────────────────

function runQuery(ctx, sql, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const stdout = execFileSync(
    ctx.tools.psql,
    ['-X', '-q', '-A', '-t', '-F', SEP, '-v', 'ON_ERROR_STOP=1'],
    {
      input: sql,
      env: ctx.conn.childEnv,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  return stdout
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.length > 0)
    .map((line) => line.split(SEP));
}

/** One scalar value, or null when the query returned nothing. */
function runScalar(ctx, sql, options) {
  const rows = runQuery(ctx, sql, options);
  return rows.length ? rows[0][0] : null;
}

/**
 * Wrap a read in the exported snapshot so counts match the dump exactly.
 * READ ONLY is not decoration: it makes the server refuse a write, which is what
 * turns this script's headline claim into something enforced rather than stated.
 */
function snapshotWrap(ctx, body) {
  const prelude = [
    'SET statement_timeout = 0;',
    'SET idle_in_transaction_session_timeout = 0;',
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
  ];
  if (ctx.snapshotId) prelude.push(`SET TRANSACTION SNAPSHOT '${ctx.snapshotId}';`);
  return `${prelude.join('\n')}\n${body}\nCOMMIT;\n`;
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const quoteLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** psql prints a boolean as t/f, but a boolean cast with ::text as true/false. */
const toBool = (value) => value === 't' || value === 'true';

/** Errors worth one retry: the link to Seoul dropped, not the data. */
const TRANSIENT_RE =
  /server closed the connection|terminating connection|connection reset|could not connect|SSL connection has been closed|snapshot .* does not exist|EOF detected/i;

/**
 * Give up on the shared snapshot and say so. Everything after this point still
 * gets dumped — just not from the same instant, and the manifest records that.
 */
function loseSnapshot(ctx, reason) {
  if (!ctx.snapshotId) return;
  ctx.snapshotLost = { reason, duringStep: ctx.currentStep || '(before the first artifact)' };
  ctx.snapshotId = null;
  warn(`shared snapshot lost during ${ctx.snapshotLost.duringStep}: ${reason}`);
  warn('continuing WITHOUT it — files from here on are each self-consistent but not from one instant');
}

/**
 * Keep the snapshot-holding session busy. Timers cannot do this: every pg_dump
 * below runs through execFileSync, which blocks the event loop for its whole
 * duration, so a setInterval heartbeat never fires. It has to be poked by hand
 * between steps instead.
 */
function pingSnapshot(ctx) {
  if (!ctx.holder || !ctx.snapshotId) return;
  if (ctx.holder.exitCode !== null || ctx.holder.signalCode !== null) {
    loseSnapshot(ctx, 'the holder session exited');
    return;
  }
  const { stdin } = ctx.holder;
  // A pipe to a child that has gone away raises EPIPE ASYNCHRONOUSLY, on the
  // stream — a try/catch here never sees it. Without the 'error' listener that
  // openSnapshot attaches, that is an unhandled 'error' event, which takes the
  // whole process down 10 minutes into a 13-minute backup. Check writability
  // first, and let the listener downgrade the snapshot if it fires anyway.
  if (!stdin || stdin.destroyed || !stdin.writable) {
    loseSnapshot(ctx, 'the holder session pipe is closed');
    return;
  }
  try {
    stdin.write('SELECT 1;\n');
  } catch (error) {
    loseSnapshot(ctx, `the holder session could not be pinged (${error.message})`);
  }
}

/** Confirm the snapshot is still usable; drop it if it is not. */
function ensureSnapshotAlive(ctx) {
  if (!ctx.snapshotId) return false;
  try {
    runQuery(
      ctx,
      `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET TRANSACTION SNAPSHOT '${ctx.snapshotId}';\nSELECT 1;\nCOMMIT;\n`,
      { timeoutMs: 60000 }
    );
    return true;
  } catch (error) {
    loseSnapshot(ctx, String(error.stderr || error.message).trim().split('\n')[0]);
    return false;
  }
}

/**
 * A read that belongs to the shared snapshot. If the snapshot has died the
 * query is retried once outside it, so a lost snapshot costs consistency —
 * never the number itself.
 */
function runSnapshotQuery(ctx, body, options) {
  pingSnapshot(ctx);
  try {
    return runQuery(ctx, snapshotWrap(ctx, body), options);
  } catch (error) {
    // Only the first 2KB: a failed multi-statement script echoes its own SQL
    // back, and a regex with .* over a megabyte of it overflows the stack.
    const message = String(error.stderr || error.message).slice(0, 2048);
    if (ctx.snapshotId && TRANSIENT_RE.test(message)) {
      loseSnapshot(ctx, message.trim().split('\n')[0]);
      // ctx.snapshotId is null now, so this second attempt runs unsnapshotted.
      return runQuery(ctx, snapshotWrap(ctx, body), options);
    }
    throw error;
  }
}

/** runSnapshotQuery, for a query that returns a single value. */
function runSnapshotScalar(ctx, body, options) {
  const rows = runSnapshotQuery(ctx, body, options);
  return rows.length ? rows[0][0] : null;
}

/**
 * Run one pg_dump / pg_dumpall and record the result. Never throws: a failed
 * artifact is reported in the manifest and decides the exit code at the end.
 */
// `snapshot` defaults off for pg_dumpall, which has no --snapshot flag (roles
// are catalog-level, so they do not need one).
function runDump(ctx, { file, tool = 'pg_dump', args, what, required = true, appendTo = null, snapshot = tool !== 'pg_dumpall' }) {
  const target = appendTo ? path.join(ctx.outDir, `.part-${file}`) : path.join(ctx.outDir, file);
  const binary = tool === 'pg_dumpall' ? ctx.tools.pgDumpall : ctx.tools.pgDump;
  ctx.currentStep = appendTo || file;

  log(`  -> ${file}: ${what}`);

  const entry = {
    name: appendTo || file,
    what,
    command: null,
    required,
    ok: false,
    bytes: 0,
    sha256: null,
    note: null,
  };

  // The snapshot flag is rebuilt per attempt: a retry after a dropped
  // connection must not keep asking for a snapshot that no longer exists.
  let failure = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    pingSnapshot(ctx);
    const snapshotArgs = snapshot && ctx.snapshotId ? [`--snapshot=${ctx.snapshotId}`] : [];
    const fullArgs = [...args, ...snapshotArgs, '-f', target];
    entry.command = `${tool} ${fullArgs.join(' ')}`;
    entry.snapshot = snapshotArgs.length ? ctx.snapshotId : null;
    log(`     ${tool} ${[...args, ...snapshotArgs].join(' ')}${attempt > 1 ? '   (retry)' : ''}`);

    const started = Date.now();
    try {
      execFileSync(binary, fullArgs, {
        env: ctx.conn.childEnv,
        timeout: ctx.timeoutMs,
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      });
      entry.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
      failure = null;
      break;
    } catch (error) {
      failure = String(error.stderr || error.message).slice(0, 4096).trim() || 'pg_dump failed';
      const firstLine = failure.split('\n').find((line) => line.trim()) || failure;
      if (attempt === 1 && TRANSIENT_RE.test(failure)) {
        warn(`${firstLine} — checking the snapshot and retrying once`);
        ensureSnapshotAlive(ctx);
        continue;
      }
      break;
    }
  }

  if (failure) {
    entry.note = failure.split('\n').filter((line) => line.trim()).slice(0, 3).join(' | ');
  } else {
    const stats = fs.statSync(target);
    entry.bytes = stats.size;
    if (stats.size === 0) {
      entry.note = 'the dump produced an empty file';
    } else if (target.endsWith('.sql') && !readTail(target, 4096).includes('dump complete')) {
      // pg_dump ends with "database dump complete", pg_dumpall with
      // "database cluster dump complete". Neither means a truncated file.
      entry.note = 'no "dump complete" marker — the file is truncated';
    } else {
      entry.ok = true;
    }
  }

  if (appendTo) {
    const finalPath = path.join(ctx.outDir, appendTo);
    if (entry.ok) {
      fs.appendFileSync(
        finalPath,
        `\n-- ─── from: ${tool} ${args.join(' ')}\n${fs.readFileSync(target, 'utf8')}`
      );
    }
    fs.rmSync(target, { force: true });
    const existing = ctx.files.find((f) => f.name === appendTo);
    if (existing) {
      existing.command += `  &&  ${entry.command}`;
      existing.ok = existing.ok && entry.ok;
      existing.note = existing.note || entry.note;
      log(entry.ok ? '     ok (appended)' : `     FAILED: ${entry.note}`);
      if (!entry.ok && required) ctx.hadRequiredFailure = true;
      return existing;
    }
    entry.command = `${entry.command}  (written to ${appendTo})`;
  }

  ctx.files.push(entry);
  log(entry.ok ? `     ok  ${formatBytes(entry.bytes)}  ${entry.seconds ?? '?'}s` : `     FAILED: ${entry.note}`);
  if (!entry.ok && required) ctx.hadRequiredFailure = true;
  return entry;
}

function readTail(file, bytes) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

// ─── Snapshot holder ────────────────────────────────────────────────────────

/**
 * Hold one REPEATABLE READ transaction open and export its snapshot, so every
 * pg_dump below sees the identical instant. Returns null if the pooler refuses.
 */
async function openSnapshot(ctx) {
  const holder = spawn(ctx.tools.psql, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    env: ctx.conn.childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  holder.stdout.setEncoding('utf8');
  holder.stderr.setEncoding('utf8');
  holder.stdout.on('data', (chunk) => { stdout += chunk; });
  holder.stderr.on('data', (chunk) => { stderr += chunk; });
  holder.on('error', (error) => { stderr += `\n${error.message}`; });
  // Mandatory, not defensive: every later write to this pipe (pingSnapshot,
  // closeSnapshot) can raise EPIPE asynchronously once psql is gone, and an
  // unhandled 'error' on a stream aborts the process. Downgrade instead.
  holder.stdin.on('error', (error) => {
    stderr += `\n${error.message}`;
    loseSnapshot(ctx, `the holder session pipe failed (${error.code || error.message})`);
  });

  holder.stdin.write([
    'SET statement_timeout = 0;',
    'SET idle_in_transaction_session_timeout = 0;',
    'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    "SELECT 'SNAPSHOT:' || pg_export_snapshot();",
    '',
  ].join('\n'));

  const snapshotId = await new Promise((resolve) => {
    const deadline = Date.now() + 45000;
    const timer = setInterval(() => {
      const match = /SNAPSHOT:(\S+)/.exec(stdout);
      if (match) {
        clearInterval(timer);
        resolve(match[1]);
      } else if (Date.now() > deadline || holder.exitCode !== null) {
        clearInterval(timer);
        resolve(null);
      }
    }, 200);
  });

  if (!snapshotId) {
    try { holder.kill(); } catch { /* already gone */ }
    warn(`snapshot export failed${stderr.trim() ? `: ${stderr.trim().split('\n')[0]}` : ''}`);
    return null;
  }

  // The session is kept warm by pingSnapshot() between steps, not by a timer:
  // execFileSync blocks the event loop for the whole of every pg_dump, so a
  // setInterval heartbeat would never fire and the holder would sit idle for
  // the entire run. (Observed: a 12-minute run lost the snapshot that way.)
  ctx.holder = holder;

  ctx.closeSnapshot = () => {
    try {
      if (holder.stdin && !holder.stdin.destroyed && holder.stdin.writable) {
        holder.stdin.write('COMMIT;\n\\q\n');
        holder.stdin.end();
      }
    } catch { /* already closed */ }
    try { holder.kill(); } catch { /* already gone */ }
    // Nothing is read from the holder after this. Detach the pipes so a lingering
    // psql cannot hold the event loop open past the summary.
    for (const stream of [holder.stdout, holder.stderr]) {
      try { stream?.destroy(); } catch { /* already gone */ }
    }
    try { holder.unref(); } catch { /* already gone */ }
  };

  return snapshotId;
}

// ─── Repo cross-check ───────────────────────────────────────────────────────

/**
 * Read DIRECT_TABLES / OPERATIONAL_TABLES out of server/supa.js by parsing, not
 * by importing: importing it constructs a Supabase client and logs.
 */
function readLogicalTables() {
  const file = path.join(REPO_ROOT, 'server', 'supa.js');
  if (!fs.existsSync(file)) return null;
  // Normalise CRLF first: a JS "." never matches \r, so on a CRLF file a
  // /\/\/.*$/ comment strip silently does nothing and the commented entries
  // (security_runtime, signature_evidence, …) drop out of the list.
  const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const grab = (name) => {
    const start = source.indexOf(`${name} = [`);
    if (start === -1) return null;
    const open = source.indexOf('[', start);
    const close = source.indexOf('];', open);
    if (close === -1) return null;
    return source
      .slice(open + 1, close)
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n')
      .split(',')
      .map((piece) => /^\s*['"]([^'"]+)['"]\s*$/.exec(piece.trim()))
      .filter(Boolean)
      .map((match) => match[1]);
  };
  const direct = grab('const DIRECT_TABLES');
  const operational = grab('export const OPERATIONAL_TABLES');
  if (!direct || !operational) return null;
  return { direct, operational };
}

// ─── Main ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = {
    stamp: null,
    dryRun: false,
    out: null,
    envFile: null,
    pgBin: null,
    withRolePasswords: false,
    full: true,
    refScan: true,
    allowOtherProject: false,
    force: false,
    timeoutMin: 45,
  };
  // A value that is missing, or that is itself a flag, used to be swallowed
  // silently: `--out --dry-run` set out=undefined AND lost the dry run.
  const valueFor = (flag, i) => {
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) fail(`${flag} needs a value`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help': case '-h': options.help = true; break;
      case '--dry-run': options.dryRun = true; break;
      case '--out': options.out = valueFor(arg, i); i += 1; break;
      case '--env-file': options.envFile = valueFor(arg, i); i += 1; break;
      case '--pg-bin': options.pgBin = valueFor(arg, i); i += 1; break;
      case '--with-role-passwords': options.withRolePasswords = true; break;
      case '--no-full': options.full = false; break;
      case '--no-ref-scan': options.refScan = false; break;
      case '--allow-other-project': options.allowOtherProject = true; break;
      case '--force': options.force = true; break;
      case '--timeout-min': options.timeoutMin = Number(valueFor(arg, i)); i += 1; break;
      default:
        if (arg.startsWith('-')) fail(`unknown option ${arg} (try --help)`);
        else if (options.stamp === null) options.stamp = arg;
        else fail(`unexpected argument ${arg}`);
    }
  }
  if (options.timeoutMin !== 45
      && (!Number.isFinite(options.timeoutMin) || options.timeoutMin <= 0)) {
    fail('--timeout-min must be a positive number of minutes');
  }
  return options;
}

function usage() {
  // Cut at the first section rule rather than at a line number: the header grows,
  // and a hardcoded slice quietly starts truncating the option list mid-way.
  const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const end = lines.findIndex((line) => line.includes('── WHAT IS CAPTURED'));
  log(
    lines
      .slice(1, end === -1 ? 30 : end)
      .map((line) => line.replace(/^ \* ?| ?\*\/$|^\/\*\*$/g, ''))
      .join('\n')
      .trimEnd()
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return 0; }

  const stamp = options.stamp
    || new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  if (!/^[A-Za-z0-9._-]+$/.test(stamp)) {
    fail(`bad stamp "${stamp}" — letters, digits, dot, dash and underscore only`);
  }

  const envFile = resolveEnvFile(options.envFile);
  const env = parseEnvFile(envFile);
  const tools = resolvePgBin(options.pgBin);
  const conn = buildConnection(env, options.allowOtherProject);

  const dumpRoot = path.resolve(options.out || path.join(HERE, 'dump'));
  const outDir = path.join(dumpRoot, stamp);

  const ctx = {
    tools,
    conn,
    outDir,
    files: [],
    hadRequiredFailure: false,
    snapshotId: null,
    closeSnapshot: null,
    timeoutMs: Math.max(1, Number(options.timeoutMin) || 45) * 60 * 1000,
  };

  const startedAt = new Date();
  log('');
  log('══ 02-dump — full backup of the OLD Supabase project ══════════════════');
  log('   READ-ONLY: this script never writes to the database.');
  log('');
  log(`   env file       ${envFile}`);
  log(`   pg tools       ${tools.dir}`);
  log(`   host           ${conn.host}:${conn.port}  (session-mode pooler)`);
  log(`   user           ${conn.user}`);
  log(`   database       ${conn.database}`);
  log(`   project ref    ${conn.projectRef || '(not derivable from the user name)'}`);
  log(`   output         ${outDir}`);
  log(`   mode           ${options.dryRun ? 'DRY RUN — nothing will be written' : 'full dump'}`);
  log('');

  // ── Preflight: everything below comes from the live catalog ───────────────
  log('── preflight ─────────────────────────────────────────────────────────');
  let serverVersion;
  try {
    serverVersion = runScalar(ctx, 'SELECT version();', { timeoutMs: 60000 });
  } catch (error) {
    fail(
      `cannot connect: ${String(error.stderr || error.message).trim().split('\n')[0]}\n` +
      'Check DATABASE_URL in server/.env and that the pooler host is reachable.'
    );
  }
  if (!serverVersion) {
    fail('SELECT version() came back empty — the pooler answered but the session is not usable.');
  }
  const clientVersion = execFileSync(tools.pgDump, ['--version'], { encoding: 'utf8' }).trim();
  log(`   server   ${serverVersion.replace(/ on .*/, '')}`);
  log(`   client   ${clientVersion}`);

  const schemaRows = runQuery(ctx, `
    SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner)
    FROM pg_namespace n
    WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
    ORDER BY 1;
  `);
  const schemas = schemaRows.map(([name, owner]) => ({ name, owner }));
  const schemaNames = schemas.map((s) => s.name);

  const extraSchemas = schemaNames.filter(
    (name) => !SYSTEM_SCHEMA_RE.test(name)
      && !PRIMARY_SCHEMAS.includes(name)
      && !MANAGED_SCHEMAS.includes(name)
  );
  const managedPresent = MANAGED_SCHEMAS.filter((name) => schemaNames.includes(name));
  const missingPrimary = PRIMARY_SCHEMAS.filter((name) => !schemaNames.includes(name));
  if (missingPrimary.length) fail(`schema(s) missing from the source: ${missingPrimary.join(', ')}`);

  log(`   schemas  primary: ${PRIMARY_SCHEMAS.join(', ')}`);
  log(`            extra (dumped in full): ${extraSchemas.join(', ') || '(none)'}`);
  log(`            managed (reference only): ${managedPresent.join(', ') || '(none)'}`);

  const extensions = runQuery(ctx, `
    SELECT e.extname, n.nspname, e.extversion
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    ORDER BY 1;
  `).map(([name, schema, version]) => ({ name, schema, version }));
  log(`   extensions  ${extensions.map((e) => `${e.name}@${e.version}`).join(', ')}`);

  const publications = runQuery(ctx, `
    SELECT p.pubname, p.puballtables::text,
           coalesce((SELECT count(*)::text FROM pg_publication_tables t WHERE t.pubname = p.pubname), '0')
    FROM pg_publication p ORDER BY 1;
  `).map(([name, allTables, tableCount]) => ({
    name, allTables: toBool(allTables), tableCount: Number(tableCount),
  }));

  const databaseSettings = runQuery(ctx, `
    SELECT d.datname, coalesce(r.rolname, ''), unnest(s.setconfig)
    FROM pg_db_role_setting s
    JOIN pg_database d ON d.oid = s.setdatabase
    LEFT JOIN pg_roles r ON r.oid = s.setrole
    ORDER BY 1, 2, 3;
  `).map(([database, role, setting]) => ({ database, role: role || null, setting }));

  const securityDefiners = runQuery(ctx, `
    SELECT n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef AND n.nspname NOT LIKE 'pg\\_%'
      AND n.nspname NOT IN ('information_schema', 'extensions', 'graphql', 'graphql_public',
                            'realtime', 'vault', 'auth', 'storage', 'pgbouncer')
    ORDER BY 1, 2;
  `).map(([schema, name, args]) => ({ schema, name, args }));
  log(`   SECURITY DEFINER functions outside the platform schemas: ${securityDefiners.length}`);
  for (const fn of securityDefiners) log(`            ${fn.schema}.${fn.name}(${fn.args})`);

  // RLS is load-bearing here in an unusual way: the tables have it enabled and
  // no policies at all, so the only thing that reads them is the service_role
  // key, which bypasses RLS. A restore that leaves RLS off would hand the anon
  // key the whole customer base, so the counts go in the manifest to be checked.
  const rlsRows = runQuery(ctx, `
    SELECT n.nspname,
           count(*) FILTER (WHERE c.relkind IN ('r','p')),
           count(*) FILTER (WHERE c.relrowsecurity),
           coalesce((SELECT count(*) FROM pg_policy p
                     JOIN pg_class pc ON pc.oid = p.polrelid
                     WHERE pc.relnamespace = n.oid), 0)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r','p')
      AND n.nspname = ANY (${quoteLiteral(`{${[...PRIMARY_SCHEMAS, ...extraSchemas].join(',')}}`)}::text[])
    GROUP BY n.nspname, n.oid ORDER BY 1;
  `);
  const rowLevelSecurity = rlsRows.map(([schema, tables, rlsEnabled, policies]) => ({
    schema, tables: Number(tables), rlsEnabled: Number(rlsEnabled), policies: Number(policies),
  }));
  for (const row of rowLevelSecurity) {
    log(`   RLS      ${row.schema}: ${row.rlsEnabled}/${row.tables} tables have RLS on, ${row.policies} policies`);
  }

  const roleRows = runQuery(ctx, `
    SELECT rolname, rolcanlogin::text, rolsuper::text FROM pg_roles
    WHERE rolname NOT LIKE 'pg\\_%' ORDER BY 1;
  `);
  const allRoles = roleRows.map(([name, canLogin, isSuper]) => ({
    name, canLogin: toBool(canLogin), superuser: toBool(isSuper),
  }));
  const SUPABASE_ROLE_RE = /^(anon|authenticated|authenticator|dashboard_user|pgbouncer|postgres|service_role|supabase_.*)$/;
  const customRoles = allRoles.filter((r) => !SUPABASE_ROLE_RE.test(r.name)).map((r) => r.name);
  log(`   roles    ${allRoles.length} total, ${customRoles.length} custom${customRoles.length ? `: ${customRoles.join(', ')}` : ' (all are Supabase built-ins)'}`);

  const tableRows = runQuery(ctx, `
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND c.relispartition = false
      AND n.nspname = ANY (${quoteLiteral(`{${[...PRIMARY_SCHEMAS, ...extraSchemas].join(',')}}`)}::text[])
    ORDER BY 1, 2;
  `);
  const tables = tableRows.map(([schema, name]) => ({ schema, name }));
  log(`   tables   ${tables.length} across ${[...PRIMARY_SCHEMAS, ...extraSchemas].join(', ')}`);
  log('');

  if (options.dryRun) {
    log('── plan (dry run — nothing written) ──────────────────────────────────');
    for (const line of plannedArtifacts(extraSchemas, managedPresent, options)) log(`   ${line}`);
    log('');
    log(`   would write to ${outDir}`);
    log('   Re-run without --dry-run to produce the backup.');
    log('');
    return 0;
  }

  // ── Output directory ──────────────────────────────────────────────────────
  // Writing a second backup into a folder that already holds one is destructive:
  // the files that happen to have the same names are replaced, the ones that do
  // not are left behind, and the fresh manifest describes the mixture as if it
  // were one consistent snapshot. Refuse unless the operator says otherwise.
  if (fs.existsSync(outDir)) {
    const existing = fs.readdirSync(outDir);
    if (existing.length && !options.force) {
      fail(
        `${outDir} already holds ${existing.length} file(s).\n` +
        'Re-running into it would overwrite some and keep others, and manifest.json\n' +
        'would describe the mixture as a single snapshot. Use a different stamp, or\n' +
        'pass --force if replacing that backup is what you mean to do.'
      );
    }
    if (existing.length) warn(`--force: overwriting the ${existing.length} file(s) already in ${outDir}`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // Dumps hold customer PII, staff identities and signed evidence. Never commit.
  const gitignorePath = path.join(dumpRoot, '.gitignore');
  const gitignoreBody =
    '# Database dumps hold customer PII and auth identities. Never commit them.\n*\n!.gitignore\n';
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, gitignoreBody);
  } else if (fs.readFileSync(gitignorePath, 'utf8') !== gitignoreBody) {
    // Do not clobber a .gitignore somebody else wrote — --out can point anywhere.
    const text = fs.readFileSync(gitignorePath, 'utf8');
    if (!/^\*$/m.test(text)) {
      warn(`${gitignorePath} exists and does not ignore everything — check that these dumps cannot be committed`);
    }
  }

  // ── One snapshot for the whole backup ─────────────────────────────────────
  log('── snapshot ──────────────────────────────────────────────────────────');
  log('   exporting one REPEATABLE READ snapshot so every file below shows the');
  log('   same instant (a booking arriving mid-dump cannot land in one file only)');
  ctx.snapshotId = await openSnapshot(ctx);
  const snapshotExported = Boolean(ctx.snapshotId);
  log(snapshotExported ? '   ok — snapshot held for the whole run' : '   !! export failed; falling back to per-file snapshots');
  log('');

  try {
    // ── What the database holds, read first ─────────────────────────────────
    // Counting before dumping keeps the manifest close to the snapshot instant:
    // the dumps take minutes and the counts are what the restore is checked
    // against, so they must not be the thing that gets stale or lost.
    log('── row counts (live database, inside the shared snapshot) ─────────────');
    const rowCounts = countTables(ctx, tables);
    const totalRows = Object.values(rowCounts)
      .filter((value) => typeof value === 'number')
      .reduce((sum, value) => sum + value, 0);
    const uncounted = Object.entries(rowCounts).filter(([, value]) => value === null).map(([key]) => key);
    log(`   ${Object.keys(rowCounts).length} tables, ${totalRows.toLocaleString('en-US')} rows total`);
    if (uncounted.length) {
      warn(`could not count: ${uncounted.join(', ')} — the restore cannot be verified against these`);
      ctx.hadRequiredFailure = true;
    }

    const kvCollections = countKvCollections(ctx, tables);
    if (kvCollections) {
      const kvTotal = Object.values(kvCollections).reduce((sum, value) => sum + value, 0);
      log(`   kv_collections holds ${Object.keys(kvCollections).length} collections, ${kvTotal.toLocaleString('en-US')} rows`);
    } else if (tables.some((t) => t.schema === 'public' && t.name === 'kv_collections')) {
      ctx.hadRequiredFailure = true;
    }

    const logical = crossCheckLogicalTables(readLogicalTables(), rowCounts, kvCollections);
    if (logical) {
      log(`   repo expects ${logical.expectedTotal} logical tables ` +
          `(${logical.expectedDirect} real + ${logical.expectedOperational} kv collections)`);
      if (logical.missingDirect.length) {
        warn(`direct tables in supa.js but NOT in the database: ${logical.missingDirect.join(', ')}`);
      }
      if (logical.emptyOperational.length) {
        log(`   ${logical.emptyOperational.length} kv collections are empty (normal for unused features): ` +
            `${logical.emptyOperational.slice(0, 6).join(', ')}${logical.emptyOperational.length > 6 ? ', …' : ''}`);
      }
      if (logical.unexpectedCollections.length) {
        warn(`kv collections not listed in supa.js: ${logical.unexpectedCollections.join(', ')}`);
      }
    }

    const storageInventory = inventoryStorage(ctx);
    if (storageInventory) {
      log('');
      log('── storage buckets (object bytes are NOT in this dump) ────────────────');
      for (const bucket of storageInventory.buckets) {
        log(`   ${bucket.name.padEnd(20)} ${bucket.public ? 'public ' : 'private'}  ` +
            `${String(bucket.objects).padStart(5)} objects  ${formatBytes(bucket.bytes)}`);
      }
    } else {
      ctx.hadRequiredFailure = true;
    }

    let legacyRefUrls = null;
    if (options.refScan) {
      log('');
      log('── rows carrying the old project ref in a URL ─────────────────────────');
      legacyRefUrls = scanLegacyRefs(ctx, tables, conn.projectRef || EXPECTED_PROJECT_REF);
      for (const hit of legacyRefUrls.hits) log(`   ${hit.location.padEnd(46)} ${hit.rows}`);
      log(`   total ${legacyRefUrls.total} rows — absolute storage URLs, they never self-heal`);
      if (legacyRefUrls.partial) {
        warn('the scan was incomplete — do not treat this list as the whole set');
        ctx.hadRequiredFailure = true;
      }
    }
    log('');

    // ── Roles ───────────────────────────────────────────────────────────────
    log('── artifacts ─────────────────────────────────────────────────────────');
    runDump(ctx, {
      file: '00-roles.sql',
      tool: 'pg_dumpall',
      args: ['--roles-only', ...(options.withRolePasswords ? [] : ['--no-role-passwords'])],
      what: `cluster roles, memberships and role settings${options.withRolePasswords ? ' (WITH password hashes)' : ' (no password hashes)'}`,
    });

    // ── Globals pg_dump will not emit for a per-schema dump ─────────────────
    writeGlobals(ctx, { extensions, databaseSettings, publications, conn });

    // ── public ──────────────────────────────────────────────────────────────
    runDump(ctx, {
      file: '02-public-complete.sql',
      args: ['--schema=public'],
      what: 'public: schema + data + constraints, indexes, triggers, RLS policies, grants (PRIMARY restore artifact)',
    });
    runDump(ctx, {
      file: '03-public-schema.sql',
      args: ['--schema=public', '--schema-only'],
      what: 'public: DDL only, for review and diffing',
    });
    runDump(ctx, {
      file: '04-public-data.sql',
      args: ['--schema=public', '--data-only'],
      what: 'public: COPY data only (restore needs FKs deferred — prefer 02)',
    });

    // ── auth ────────────────────────────────────────────────────────────────
    runDump(ctx, {
      file: '05-auth-schema.sql',
      args: ['--schema=auth', '--schema-only'],
      what: 'auth: DDL, reference only (the new project builds its own auth schema)',
    });
    runDump(ctx, {
      file: '06-auth-data.sql',
      args: ['--schema=auth', '--data-only'],
      what: 'auth: every row, full fidelity (includes GoTrue internal tables)',
    });

    // FK-safe: users first, then identities. pg_dump sorts data by name, which
    // would put identities first and every row would be rejected by the FK.
    const corePath = path.join(outDir, '07-auth-core-data.sql');
    fs.writeFileSync(corePath, [
      '-- auth.users then auth.identities, in that order.',
      '-- Both are required: password hashes live on auth.users, but GoTrue matches',
      '-- a login through auth.identities. Restore this file, not 06, into the new project.',
      '',
    ].join('\n'));
    runDump(ctx, {
      file: '07a-auth-users.sql',
      appendTo: '07-auth-core-data.sql',
      args: ['--data-only', '--table=auth.users'],
      what: 'auth.users (PRIMARY auth restore artifact, part 1)',
    });
    runDump(ctx, {
      file: '07b-auth-identities.sql',
      appendTo: '07-auth-core-data.sql',
      args: ['--data-only', '--table=auth.identities'],
      what: 'auth.identities (PRIMARY auth restore artifact, part 2)',
    });

    // ── storage ─────────────────────────────────────────────────────────────
    runDump(ctx, {
      file: '08-storage-schema.sql',
      args: ['--schema=storage', '--schema-only'],
      what: 'storage: DDL, reference only',
    });
    runDump(ctx, {
      file: '09-storage-data.sql',
      args: ['--schema=storage', '--data-only'],
      what: 'storage: buckets + object METADATA rows (the bytes are not in any dump)',
    });
    runDump(ctx, {
      file: '10-storage-buckets-data.sql',
      args: ['--data-only', '--table=storage.buckets'],
      what: "storage.buckets alone — the only record of 'product-images', which has no CREATE-bucket SQL in the repo",
    });

    // ── extra schemas (supabase_migrations, cron, supabase_functions, …) ────
    for (const schema of extraSchemas) {
      runDump(ctx, {
        file: `11-extra-${schema}-complete.sql`,
        args: [`--schema=${schema}`],
        what: `${schema}: schema + data`,
      });
    }

    // ── managed schemas, reference only ─────────────────────────────────────
    for (const schema of managedPresent) {
      runDump(ctx, {
        file: `12-managed-${schema}-schema.sql`,
        args: [`--schema=${schema}`, '--schema-only'],
        what: `${schema}: DDL reference (platform-owned; do not restore)`,
        required: false,
      });
    }

    // ── one restorable archive of everything that matters ───────────────────
    if (options.full) {
      const fullSchemas = [...PRIMARY_SCHEMAS, ...extraSchemas].map((s) => `--schema=${s}`);
      const entry = runDump(ctx, {
        file: '90-full.dump',
        args: ['--format=custom', '--compress=9', ...fullSchemas],
        what: 'custom-format archive of public + auth + storage + extras (pg_restore --section=... for selective restore)',
      });
      if (entry.ok) {
        try {
          const listing = execFileSync(ctx.tools.pgRestore, ['-l', path.join(outDir, '90-full.dump')], {
            encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60 * 1000,
          });
          entry.archiveEntries = listing.split('\n').filter((l) => l && !l.startsWith(';')).length;
          log(`     archive readable by pg_restore -l: ${entry.archiveEntries} entries`);
        } catch (error) {
          entry.ok = false;
          entry.note = `pg_restore -l could not read the archive: ${String(error.stderr || error.message).split('\n')[0]}`;
          ctx.hadRequiredFailure = true;
          log(`     FAILED: ${entry.note}`);
        }
      }
    }
    log('');

    // ── Manifest ────────────────────────────────────────────────────────────
    for (const entry of ctx.files) {
      const file = path.join(outDir, entry.name);
      if (fs.existsSync(file)) {
        entry.bytes = fs.statSync(file).size;
        entry.sha256 = sha256File(file);
      }
    }

    const finishedAt = new Date();
    const manifest = {
      tool: 'migration/02-dump.mjs',
      manifestVersion: 1,
      stamp,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds: Number(((finishedAt - startedAt) / 1000).toFixed(1)),
      source: {
        projectRef: conn.projectRef,
        host: conn.host,
        port: Number(conn.port),
        user: conn.user,
        database: conn.database,
        connection: 'session-mode pooler (port 5432); the direct host is IPv6-only',
        serverVersion,
        clientVersion,
      },
      consistency: buildConsistency(ctx, snapshotExported),
      schemas: { all: schemas, primary: PRIMARY_SCHEMAS, extra: extraSchemas, managedReferenceOnly: managedPresent },
      extensions,
      publications,
      databaseSettings,
      securityDefinerFunctions: securityDefiners,
      rowLevelSecurity: {
        bySchema: rowLevelSecurity,
        note: 'Tables here have RLS enabled with no policies: only the service_role key, which bypasses RLS, can read them. After the restore these numbers must match, or the anon key reads the whole customer base.',
      },
      signingKey: signingKeyRecord(env),
      roles: {
        total: allRoles.length,
        custom: customRoles,
        passwordHashesCaptured: options.withRolePasswords,
        note: customRoles.length
          ? 'custom roles exist — recreate them in the new project before restoring grants'
          : 'no custom roles; the new project creates every role in 00-roles.sql for itself',
      },
      files: ctx.files,
      rowCounts,
      totalRows,
      kvCollections,
      logicalTables: logical,
      storage: storageInventory,
      legacyRefUrls,
      restoreNotes: restoreNotes(conn.projectRef || EXPECTED_PROJECT_REF),
    };

    const manifestPath = path.join(outDir, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    // ── Summary ─────────────────────────────────────────────────────────────
    log('');
    log('── files written ─────────────────────────────────────────────────────');
    let totalBytes = 0;
    for (const entry of ctx.files) {
      totalBytes += entry.bytes || 0;
      log(`   ${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name.padEnd(38)} ${formatBytes(entry.bytes).padStart(8)}` +
          `${entry.ok ? '' : `   ${entry.note}`}`);
    }
    log(`        ${'manifest.json'.padEnd(38)} ${formatBytes(fs.statSync(manifestPath).size).padStart(8)}`);
    log('');
    log(`   ${outDir}`);
    log(`   ${ctx.files.length + 1} files, ${formatBytes(totalBytes)}, ${manifest.durationSeconds}s, ` +
        `${totalRows.toLocaleString('en-US')} rows accounted for`);
    log(`   consistency: ${manifest.consistency.mode}`);
    log('');

    // The one thing that breaks silently after cutover, so it is said out loud
    // and not left sitting in a JSON field nobody opens.
    if (manifest.signingKey.modulesKeyedOnServiceRoleKey.length) {
      log('── before cutover ────────────────────────────────────────────────────');
      log(`   ${manifest.signingKey.modulesKeyedOnServiceRoleKey.length} module(s) currently sign with the service_role key:`);
      for (const file of manifest.signingKey.modulesKeyedOnServiceRoleKey) log(`      ${file}`);
      log('   Set OTP_TOKEN_SECRET on Render to the OLD service_role key before');
      log('   cutover. EVIDENCE_SIGNING_SECRET alone covers only signatureEvidence.js,');
      log('   and leaves every unsubscribe link (TTL 365d) and OTP token broken.');
      log(`   Old key fingerprint (sha256, 16 hex): ${manifest.signingKey.fingerprints.SUPABASE_SERVICE_ROLE_KEY}`);
      log('');
    }

    if (ctx.hadRequiredFailure) {
      log('   RESULT: INCOMPLETE — a required artifact or a verification count failed.');
      log('   Do NOT cut over on this backup. Re-run it.');
      log('');
      return 2;
    }
    log('   RESULT: complete. Next: verify manifest.json against the restore.');
    log('   Reminder — object bytes in the three storage buckets are NOT in these');
    log('   files and still have to be copied.');
    log('');
    return 0;
  } finally {
    if (ctx.closeSnapshot) ctx.closeSnapshot();
  }
}

// ─── Manifest builders ──────────────────────────────────────────────────────

/**
 * Which key is signing the HMAC seals today, recorded as a fingerprint.
 *
 * Three modules derive an HMAC key from the environment, and their fallback
 * chains are NOT the same — this was checked in the source, because the
 * difference decides whether one Render variable is enough:
 *
 *   server/signatureEvidence.js:6   EVIDENCE_SIGNING_SECRET || OTP_TOKEN_SECRET
 *                                   || SUPABASE_SERVICE_ROLE_KEY || META_WA_ACCESS_TOKEN
 *   server/otpService.js:41         OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY
 *                                   || META_WA_ACCESS_TOKEN
 *   server/mailingPreferences.js:9  OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY
 *                                   || META_WA_ACCESS_TOKEN
 *
 * otpService and mailingPreferences never look at EVIDENCE_SIGNING_SECRET. With
 * neither dedicated secret set — which is the case today — all three keys ARE
 * the service_role key, and the new project issues a different one. Setting only
 * EVIDENCE_SIGNING_SECRET therefore rescues the signature_evidence seals
 * (minors' health declarations, liability waivers) and leaves every
 * mailing-preference / unsubscribe link (365-day TTL) and every in-flight OTP
 * token still broken. OTP_TOKEN_SECRET is the one that covers all three.
 *
 * Nothing logs an error when this goes wrong: a bad HMAC is indistinguishable
 * from a forged one, so the link simply says invalid.
 *
 * Recorded here as sha256(key) truncated to 16 hex characters — never the key —
 * so that after cutover the operator can prove the value they set on Render is
 * the one that was actually in force. The key itself lives only in server/.env
 * and the old project's dashboard; once that project is deleted this
 * fingerprint is the only thing left that can check it.
 */
function signingKeyRecord(env) {
  const names = [
    'EVIDENCE_SIGNING_SECRET',
    'OTP_TOKEN_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'META_WA_ACCESS_TOKEN',
  ];
  const firstSet = (chain) => chain.find((name) => env[name]) || null;
  const modules = {
    'server/signatureEvidence.js': ['EVIDENCE_SIGNING_SECRET', 'OTP_TOKEN_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'META_WA_ACCESS_TOKEN'],
    'server/otpService.js': ['OTP_TOKEN_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'META_WA_ACCESS_TOKEN'],
    'server/mailingPreferences.js': ['OTP_TOKEN_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'META_WA_ACCESS_TOKEN'],
  };
  const activeBySource = Object.fromEntries(
    Object.entries(modules).map(([file, chain]) => [file, firstSet(chain)])
  );
  const onServiceRoleKey = Object.entries(activeBySource)
    .filter(([, source]) => source === 'SUPABASE_SERVICE_ROLE_KEY')
    .map(([file]) => file);

  return {
    fingerprints: Object.fromEntries(
      names.map((name) => [name, env[name] ? secretFingerprint(env[name]) : null])
    ),
    fingerprintAlgorithm: 'sha256(utf8 value), first 16 hex characters. Not reversible, and no key value is stored anywhere in this backup.',
    activeBySource,
    modulesKeyedOnServiceRoleKey: onServiceRoleKey,
    action: onServiceRoleKey.length
      ? 'BEFORE cutover, set OTP_TOKEN_SECRET on Render to the OLD service_role key — not EVIDENCE_SIGNING_SECRET alone, which only signatureEvidence.js reads. Then check that sha256 of what you set matches fingerprints.SUPABASE_SERVICE_ROLE_KEY below. Setting both is fine and is what a later split into two real secrets would look like.'
      : 'Dedicated secrets are set, so the new project\'s service_role key does not affect these seals. Carry the same values to the new Render environment unchanged.',
    consequenceIfSkipped: 'Every historical signature_evidence seal fails to verify, and every mailing-preference / unsubscribe link already sent (TTL 365 days) reads as invalid. Silent: a wrong HMAC looks exactly like a forged one.',
    note: 'Read from server/.env at dump time. Chains verified against the three files listed above.',
  };
}

/** What the files in this folder can and cannot be assumed to share. */
function buildConsistency(ctx, snapshotExported) {
  if (!snapshotExported) {
    return {
      mode: 'per-file-snapshots',
      snapshotExported: false,
      note: 'The shared snapshot could not be exported, so every file and every count has its own instant. Rows written mid-run may appear in some files and not others. Re-run during a quiet window if that matters.',
    };
  }
  if (ctx.snapshotLost) {
    return {
      mode: 'degraded',
      snapshotExported: true,
      lost: ctx.snapshotLost,
      note: `The shared snapshot was lost during ${ctx.snapshotLost.duringStep} (${ctx.snapshotLost.reason}). Everything up to that point shares one instant; the files after it do not. The row counts were taken before the dumps, so they belong to the original snapshot.`,
    };
  }
  return {
    mode: 'single-snapshot',
    snapshotExported: true,
    note: 'One REPEATABLE READ snapshot covered the whole run: every pg_dump used --snapshot and every count read the same instant, so the manifest numbers describe exactly the data in these files.',
  };
}

function plannedArtifacts(extraSchemas, managedPresent, options) {
  const lines = [
    '00-roles.sql                 pg_dumpall --roles-only' + (options.withRolePasswords ? '' : ' --no-role-passwords'),
    '01-globals.sql               extensions, database settings, publications (generated from the catalog)',
    '02-public-complete.sql       pg_dump --schema=public                      [PRIMARY]',
    '03-public-schema.sql         pg_dump --schema=public --schema-only',
    '04-public-data.sql           pg_dump --schema=public --data-only',
    '05-auth-schema.sql           pg_dump --schema=auth --schema-only',
    '06-auth-data.sql             pg_dump --schema=auth --data-only',
    '07-auth-core-data.sql        auth.users then auth.identities              [PRIMARY]',
    '08-storage-schema.sql        pg_dump --schema=storage --schema-only',
    '09-storage-data.sql          pg_dump --schema=storage --data-only',
    '10-storage-buckets-data.sql  pg_dump --data-only --table=storage.buckets  [PRIMARY]',
  ];
  for (const schema of extraSchemas) lines.push(`${`11-extra-${schema}-complete.sql`.padEnd(28)} pg_dump --schema=${schema}`);
  for (const schema of managedPresent) lines.push(`${`12-managed-${schema}-schema.sql`.padEnd(28)} reference only (platform-owned)`);
  if (options.full) lines.push('90-full.dump                 pg_dump --format=custom (public + auth + storage + extras)');
  lines.push('manifest.json                file sizes, sha256, live row counts, storage inventory');
  return lines;
}

function writeGlobals(ctx, { extensions, databaseSettings, publications, conn }) {
  const file = '01-globals.sql';
  log(`  -> ${file}: extensions, database settings and publications (pg_dump omits these for a per-schema dump)`);
  const lines = [
    '-- 01-globals.sql — generated from the source catalog by migration/02-dump.mjs.',
    '-- pg_dump only emits CREATE EXTENSION for a whole-database dump, and this backup',
    '-- is taken per schema, so these statements are reconstructed here.',
    `-- Source project: ${conn.projectRef || 'unknown'} (${conn.host})`,
    '',
    '-- ── Extensions ────────────────────────────────────────────────────────────',
    '-- A new Supabase project ships most of these already; IF NOT EXISTS keeps this idempotent.',
  ];
  for (const ext of extensions) {
    if (ext.name === 'plpgsql') {
      lines.push(`-- plpgsql ${ext.version} is built in — nothing to create.`);
      continue;
    }
    lines.push(`CREATE EXTENSION IF NOT EXISTS ${quoteIdent(ext.name)} WITH SCHEMA ${quoteIdent(ext.schema)};  -- was ${ext.version}`);
  }
  lines.push('', '-- ── Database-level settings ───────────────────────────────────────────────');
  if (!databaseSettings.length) lines.push('-- (none)');
  for (const setting of databaseSettings) {
    const eq = setting.setting.indexOf('=');
    const name = setting.setting.slice(0, eq);
    const value = setting.setting.slice(eq + 1);
    const target = setting.role ? `ROLE ${quoteIdent(setting.role)} IN DATABASE ${quoteIdent(setting.database)}` : `DATABASE ${quoteIdent(setting.database)}`;
    // search_path and DateStyle are list-valued GUCs. pg_dumpall deliberately
    // emits them unquoted; wrapping "public, extensions" in quotes creates one
    // schema literally named "public, extensions" and the search path is broken
    // in a way nothing errors on. Same rule here.
    const listValued = /^(search_path|datestyle)$/i.test(name.trim());
    lines.push(`ALTER ${target} SET ${name} TO ${listValued ? value : quoteLiteral(value)};`);
  }
  lines.push('', '-- ── Publications ──────────────────────────────────────────────────────────');
  if (!publications.length) lines.push('-- (none)');
  for (const pub of publications) {
    lines.push(
      `-- ${pub.name}: ${pub.allTables ? 'FOR ALL TABLES' : `${pub.tableCount} table(s)`}. ` +
      'A new Supabase project creates supabase_realtime for itself; recreate any other publication by hand.'
    );
  }
  lines.push('');
  fs.writeFileSync(path.join(ctx.outDir, file), lines.join('\n'));
  const bytes = fs.statSync(path.join(ctx.outDir, file)).size;
  ctx.files.push({
    name: file,
    what: 'extensions, database settings and publications, generated from the source catalog',
    command: '(generated by 02-dump.mjs from pg_extension / pg_db_role_setting / pg_publication)',
    required: true,
    ok: true,
    bytes,
    sha256: null,
    note: null,
  });
  log(`     ok  ${formatBytes(bytes)}`);
}

/**
 * Exact count(*) per table, in chunks, falling back to per-table on error.
 *
 * A count that could not be taken must come out as null, never as 0. These
 * numbers are the only thing the restore is checked against, and "0 rows" is a
 * number a restore can match perfectly while having lost the whole table.
 */
function countTables(ctx, tables) {
  const counts = {};
  const toCount = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const chunkSize = 20;
  for (let i = 0; i < tables.length; i += chunkSize) {
    const chunk = tables.slice(i, i + chunkSize);
    const body = chunk
      .map((t) => `SELECT ${quoteLiteral(`${t.schema}.${t.name}`)} AS k, count(*) AS n FROM ${quoteIdent(t.schema)}.${quoteIdent(t.name)}`)
      .join('\nUNION ALL\n');
    let counted = null;
    try {
      counted = new Map(
        runSnapshotQuery(ctx, `${body};`, { timeoutMs: ctx.timeoutMs })
          .map(([key, value]) => [key, toCount(value)])
      );
      // A chunk that "succeeded" but came back short would otherwise leave those
      // tables with no key at all, and nothing downstream would notice.
      const missing = chunk.filter((t) => !counted.has(`${t.schema}.${t.name}`));
      if (missing.length) {
        warn(`count chunk returned no row for ${missing.map((t) => `${t.schema}.${t.name}`).join(', ')} — retrying one by one`);
        counted = null;
      }
    } catch {
      counted = null;
    }

    if (counted) {
      for (const [key, value] of counted) counts[key] = value;
      continue;
    }

    for (const t of chunk) {
      const key = `${t.schema}.${t.name}`;
      try {
        const value = runSnapshotScalar(
          ctx,
          `SELECT count(*) FROM ${quoteIdent(t.schema)}.${quoteIdent(t.name)};`,
          { timeoutMs: ctx.timeoutMs }
        );
        counts[key] = toCount(value);
        if (counts[key] === null) warn(`count of ${key} came back empty — recorded as "not counted", not as 0`);
      } catch (error) {
        counts[key] = null;
        warn(`could not count ${key}: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
      }
    }
  }
  return counts;
}

/** The operational collections live as rows inside public.kv_collections. */
function countKvCollections(ctx, tables) {
  if (!tables.some((t) => t.schema === 'public' && t.name === 'kv_collections')) return null;
  try {
    const rows = runSnapshotQuery(
      ctx,
      ('SELECT collection, count(*) FROM public.kv_collections GROUP BY 1 ORDER BY 1;'),
      { timeoutMs: ctx.timeoutMs }
    );
    return Object.fromEntries(rows.map(([collection, count]) => [collection, Number(count)]));
  } catch (error) {
    warn(`kv_collections breakdown failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    return null;
  }
}

function crossCheckLogicalTables(lists, rowCounts, kvCollections) {
  if (!lists) return null;
  const present = new Set(Object.keys(rowCounts).filter((k) => k.startsWith('public.')).map((k) => k.slice(7)));
  const collections = kvCollections || {};
  return {
    expectedDirect: lists.direct.length,
    expectedOperational: lists.operational.length,
    expectedTotal: lists.direct.length + lists.operational.length,
    missingDirect: lists.direct.filter((t) => !present.has(t)),
    emptyOperational: lists.operational.filter((t) => !collections[t]),
    unexpectedCollections: Object.keys(collections).filter((c) => !lists.operational.includes(c)),
    note: 'server/db.js initDb hydrates every one of these on boot and, under runtimeSafety (NODE_ENV=production or any RENDER* variable), the process exits if any fails — so a table missing after the restore crash-loops Render rather than serving degraded. Note that some names are BOTH a real table and a kv collection (public.employees and public.payments exist and are empty; the live rows are in kv_collections), so a zero row count on those is normal.',
  };
}

function inventoryStorage(ctx) {
  try {
    // metadata->>'size' is free-form jsonb. An unguarded ::bigint raises
    // "invalid input syntax for type bigint" on a single odd row and takes the
    // whole inventory down, which then marks the entire backup INCOMPLETE. A
    // missing size is counted separately instead of silently summing to less.
    const sizeExpr = "CASE WHEN o.metadata->>'size' ~ '^[0-9]+$' THEN (o.metadata->>'size')::bigint END";
    const rows = runSnapshotQuery(
      ctx,
      (`
        SELECT b.id, b.name, b.public::text,
               count(o.id)::text,
               coalesce(sum(${sizeExpr}), 0)::text,
               count(o.id) FILTER (WHERE ${sizeExpr} IS NULL)::text
        FROM storage.buckets b
        LEFT JOIN storage.objects o ON o.bucket_id = b.id
        GROUP BY b.id, b.name, b.public
        ORDER BY b.name;
      `),
      { timeoutMs: ctx.timeoutMs }
    );
    const buckets = rows.map(([id, name, isPublic, objects, bytes, unsized]) => ({
      id,
      name,
      public: toBool(isPublic),
      objects: Number(objects),
      bytes: Number(bytes),
      objectsWithoutSize: Number(unsized),
    }));
    const unsized = buckets.reduce((sum, b) => sum + b.objectsWithoutSize, 0);
    if (unsized) warn(`${unsized} storage object(s) have no numeric metadata.size — the byte totals below exclude them`);
    return {
      buckets,
      totalObjects: buckets.reduce((sum, b) => sum + b.objects, 0),
      totalBytes: buckets.reduce((sum, b) => sum + b.bytes, 0),
      objectsWithoutSize: unsized,
      note: 'storage.objects rows are metadata only. The file bytes live behind the storage API and are not in any Postgres dump — copy them bucket by bucket and check these counts and sizes afterwards. bytes sums metadata.size and skips any object whose size is not a plain integer; objectsWithoutSize is how many were skipped.',
    };
  } catch (error) {
    warn(`storage inventory failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    return null;
  }
}

/**
 * Absolute storage URLs holding the old project ref. They never self-heal:
 * storeImageValue in server/productImages.js:53 hands back anything that is
 * already a URL, unchanged, on every save.
 *
 * Every text/varchar/char/json/jsonb column of every ordinary table in public,
 * auth and storage is checked. There is deliberately NO column-name heuristic:
 * the 42 pricelist URLs live inside kv_collections.data (jsonb), and a name
 * filter also skips messages.meta, employees.data, app_settings.value,
 * health_declarations.form_snapshot, finance_expenses.attachment_metadata and
 * every other jsonb document that could be holding one — while still reporting
 * partial:false, which reads as "this is the whole set".
 *
 * Only counts leave the database. These columns include
 * auth.users.encrypted_password and the entire customer base.
 */
function scanLegacyRefs(ctx, tables, ref) {
  const hits = [];
  const pattern = `%${ref}%`;
  let partial = false;

  // kv_collections first, broken down per collection: the whole table is one
  // physical table, so a bare per-column count would say "kv_collections.data:
  // 42" and leave the operator to guess which of the 77 collections to rewrite.
  const hasKv = tables.some((t) => t.schema === 'public' && t.name === 'kv_collections');
  if (hasKv) {
    try {
      const rows = runSnapshotQuery(
        ctx,
        `SELECT collection, count(*) FROM public.kv_collections WHERE data::text LIKE ${quoteLiteral(pattern)} GROUP BY 1 ORDER BY 1;`,
        { timeoutMs: ctx.timeoutMs }
      );
      for (const [collection, count] of rows) {
        hits.push({
          location: `kv_collections/${collection} (json)`,
          schema: 'public',
          table: 'kv_collections',
          column: 'data',
          collection,
          rows: Number(count),
        });
      }
    } catch (error) {
      partial = true;
      warn(`kv_collections ref scan failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
    }
  }

  let columns = [];
  try {
    columns = runQuery(ctx, `
      SELECT c.table_schema, c.table_name, c.column_name, c.data_type
      FROM information_schema.columns c
      JOIN pg_class k ON k.relname = c.table_name
      JOIN pg_namespace n ON n.oid = k.relnamespace AND n.nspname = c.table_schema
      WHERE c.table_schema = ANY (${quoteLiteral(`{${SCAN_SCHEMAS.join(',')}}`)}::text[])
        AND k.relkind IN ('r','p') AND k.relispartition = false
        AND c.data_type = ANY (${quoteLiteral(`{${SCANNABLE_TYPES.map((t) => `"${t}"`).join(',')}}`)}::text[])
        -- counted per collection just above; scanning it again double-counts
        AND NOT (c.table_schema = 'public' AND c.table_name = 'kv_collections' AND c.column_name = 'data')
      ORDER BY 1,2,3;
    `);
  } catch (error) {
    partial = true;
    warn(`column discovery failed: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
  }
  log(`   scanning ${columns.length} text/json columns across ${SCAN_SCHEMAS.join(', ')}`);

  // json/jsonb needs an explicit ::text; a bare LIKE on jsonb does not typecheck.
  const matchExpr = ([, , column, dataType]) => (
    dataType === 'json' || dataType === 'jsonb'
      ? `${quoteIdent(column)}::text LIKE ${quoteLiteral(pattern)}`
      : `${quoteIdent(column)} LIKE ${quoteLiteral(pattern)}`
  );

  const scanChunk = (chunk) => {
    const body = chunk
      .map((col) => {
        const [schema, table, column] = col;
        return `SELECT ${quoteLiteral(`${schema}.${table}.${column}`)} AS k, count(*) AS n `
          + `FROM ${quoteIdent(schema)}.${quoteIdent(table)} WHERE ${matchExpr(col)}`;
      })
      .join('\nUNION ALL\n');
    const rows = runSnapshotQuery(ctx, `${body};`, { timeoutMs: ctx.timeoutMs });
    const byKey = new Map(rows.map(([key, count]) => [key, Number(count)]));
    // Stage the whole chunk before publishing any of it. Pushing as we go and
    // then throwing halfway would leave the earlier columns in `hits`, and the
    // per-column retry below would add them a second time — an inflated total
    // that looks like real extra rows to rewrite.
    const staged = [];
    for (const [schema, table, column] of chunk) {
      const key = `${schema}.${table}.${column}`;
      if (!byKey.has(key)) throw new Error(`no count came back for ${key}`);
      const count = byKey.get(key);
      if (count > 0) {
        staged.push({ location: key, schema, table, column, collection: null, rows: count });
      }
    }
    hits.push(...staged);
  };

  for (let i = 0; i < columns.length; i += 20) {
    const chunk = columns.slice(i, i + 20);
    try {
      scanChunk(chunk);
    } catch (chunkError) {
      // One bad column (a dropped table, a permission) must not blank out the
      // other 19 and quietly leave them out of "the whole set".
      warn(`ref scan chunk failed (${String(chunkError.stderr || chunkError.message).trim().split('\n')[0]}) — retrying its columns one at a time`);
      for (const col of chunk) {
        try {
          scanChunk([col]);
        } catch (error) {
          partial = true;
          warn(`could not scan ${col[0]}.${col[1]}.${col[2]}: ${String(error.stderr || error.message).trim().split('\n')[0]}`);
        }
      }
    }
  }

  if (!hasKv) {
    partial = true;
    warn('public.kv_collections is missing — the per-collection breakdown could not be taken');
  }

  hits.sort((a, b) => b.rows - a.rows);
  return {
    ref,
    total: hits.reduce((sum, hit) => sum + hit.rows, 0),
    partial,
    columnsScanned: columns.length,
    hits,
    note: 'Rows holding an absolute https://<ref>.supabase.co/storage/... URL. storeImageValue (server/productImages.js:53) returns anything that is already a URL unchanged, so these keep pointing at the old project until they are rewritten after the restore. Counts are rows, not URLs: one row can hold several.',
    scope: `Every text, varchar, char, json and jsonb column of every ordinary table in ${SCAN_SCHEMAS.join(', ')}, plus a per-collection breakdown of public.kv_collections.data. NOT scanned: bytea columns, and any schema outside those three. partial:true means at least one column could not be read, and the hit list is then incomplete.`,
  };
}

function restoreNotes(ref) {
  return [
    'Restore order: 00-roles.sql (only if roles.custom is non-empty) -> 01-globals.sql -> 02-public-complete.sql -> 07-auth-core-data.sql -> 10-storage-buckets-data.sql.',
    'Restore 02-public-complete.sql, not 03 + 04: pg_dump orders data before foreign keys inside a complete dump, while a bare --data-only file is sorted by table name and its FKs will reject rows.',
    'EXPECT 02-public-complete.sql TO FAIL ON ITS FIRST THREE STATEMENTS. It opens with CREATE SCHEMA public; ALTER SCHEMA public OWNER TO pg_database_owner; COMMENT ON SCHEMA public — all three conflict with the schema a fresh Supabase project already has. Under psql -v ON_ERROR_STOP=1 the restore aborts there, before a single table is created. Either run it WITHOUT ON_ERROR_STOP and read the error list afterwards (only those three may fail), or strip that leading block first. Do not "fix" it by dropping the public schema.',
    'Do NOT restore 05-auth-schema.sql or 08-storage-schema.sql. The new project builds both schemas itself, at whatever GoTrue and storage-api version it ships; they are here for diffing.',
    'auth.users without auth.identities means every staff login fails even though the password hashes arrived intact. 07-auth-core-data.sql carries both, in that order.',
    'The bytes inside product-images, client-documents and employee-documents are NOT in this backup. Copy the objects through the storage API and check them against manifest.storage.',
    `Rewrite the ${ref} storage URLs listed in manifest.legacyRefUrls after the restore, or the catalog photos keep loading from the old project. Check manifest.legacyRefUrls.partial is false first — true means the hit list is incomplete and rewriting it does not finish the job.`,
    'Before cutover, set OTP_TOKEN_SECRET on Render to the OLD service_role key — see manifest.signingKey. EVIDENCE_SIGNING_SECRET alone is NOT enough: only signatureEvidence.js reads it, while otpService.js and mailingPreferences.js go straight to OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY. A new project regenerates that key, which silently invalidates every historical signature seal, every in-flight OTP and every unsubscribe link already sent (TTL 365 days). manifest.signingKey.fingerprints lets you prove the value you set is the right one after the old project is gone.',
    'Scheduler "already sent" markers live in kv_collections. If this dump is older than the cutover, the WhatsApp bot re-messages real customers after the restore. Re-run this script inside the cutover window.',
    'psql 17.11 wraps its output in \\restrict / \\unrestrict. Restore with the same psql from PG_BIN; an older psql chokes on those meta-commands.',
    'After the restore, check manifest.rowLevelSecurity: every public table has RLS enabled and no policies, so the app can only reach them through the service_role key. A table that comes back with RLS off is readable by anyone holding the anon key, which is shipped in the client bundle.',
  ];
}

// ─── Entry point ────────────────────────────────────────────────────────────

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  process.stderr.write(`\nFATAL: ${error?.stack || error}\n`);
  exitCode = 1;
}

// A bare process.exit() discards whatever is still buffered in stdout, and on
// Windows stdout is only synchronous for a console — redirect this run to a log
// file (which is what you do with a 13-minute backup) and the tail of the
// summary, including the RESULT line, is simply gone. Flush, then exit; still
// exit explicitly, so a psql that refuses to die cannot hang the run.
process.exitCode = exitCode;
if (process.stdout.writableLength === 0) {
  process.exit(exitCode);
} else {
  process.stdout.write('', () => process.exit(exitCode));
}
