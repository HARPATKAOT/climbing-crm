#!/usr/bin/env node
/**
 * 07-post-cutover-delta.mjs — READ-ONLY.
 *
 * Lists everything that was created in the NEW (Frankfurt) Supabase project
 * after the cutover moment. Run it BEFORE rolling back to Seoul: the old
 * project has none of these rows or files, and rolling back loses them.
 *
 * Safety properties (deliberate, do not remove):
 *   - Every statement runs inside `begin read only`. A write would be rejected
 *     by PostgreSQL itself, not by this script's good intentions.
 *   - Only `copy (select ...) to stdout` is ever sent. Any SQL that does not
 *     start with select/with is refused before it reaches the server.
 *   - No secret is ever printed. The connection password is handed to psql
 *     through the child process environment, never on a command line.
 *
 * Usage:
 *   node migration/scripts/07-post-cutover-delta.mjs --since=2026-08-20T21:00:00Z
 *   node migration/scripts/07-post-cutover-delta.mjs --since=... --out=migration/out/delta
 *
 * Options:
 *   --since=<ISO timestamp>  REQUIRED. The cutover moment (when the API first
 *                            pointed at the new project). Anything created at
 *                            or after this instant is "post-cutover".
 *   --out=<dir>              Also write one CSV per section into <dir>.
 *   --url-env=<NAME>         Env var holding the connection string of the
 *                            project to inspect. Default: DATABASE_URL.
 *   --env-file=<path>        Default: <repo>/server/.env
 *   --pgbin=<dir>            Directory holding psql. Default: PGBIN env var,
 *                            then the bundled tools path below.
 *   --files-limit=<n>        Max storage object names to print. Default 40.
 *                            (--out always writes the full list.)
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

const DEFAULT_PGBIN =
  'C:/Users/dalak/AppData/Local/Temp/claude/C--Users-dalak--gemini-antigravity-scratch-climbing-crm/831be2e5-05df-49e1-b84d-49a76a2e4bdd/scratchpad/pgtools/pgsql/bin';

/**
 * kv_collections rows the scheduler treats as "already sent" markers. Losing
 * one of these does not lose data — it makes the bot message a real customer
 * a second time.
 */
const SEND_MARKER_COLLECTIONS = [
  'automation_sends',
  'campaign_sends',
  'campaign_runs',
  'participation_reminders',
  'bot_followups',
  'bot_reply_claims',
  'whatsapp_logs',
];

// ─── args ───────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
    const value = eq === -1 ? 'true' : raw.slice(eq + 1);
    out[key] = value;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help === 'true' || args.h === 'true') {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

function die(message, hint) {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

if (!args.since) {
  die(
    '--since is required.',
    'Pass the cutover moment, e.g. --since=2026-08-20T21:00:00Z'
  );
}

const sinceDate = new Date(args.since);
if (Number.isNaN(sinceDate.getTime())) {
  die(`--since is not a valid timestamp: ${args.since}`, 'Use ISO 8601, e.g. 2026-08-20T21:00:00Z');
}
const SINCE = sinceDate.toISOString();

const filesLimit = Number(args['files-limit'] || 40);
const outDir = args.out ? path.resolve(process.cwd(), args.out) : null;

// ─── config ─────────────────────────────────────────────────────────────────

function loadEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const body = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const eq = body.indexOf('=');
    if (eq === -1) continue;
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) values[key] = value;
  }
  return values;
}

/**
 * `server/.env` is untracked, so it exists in the main checkout and usually NOT
 * in a linked worktree — and the migration kit is written inside a worktree.
 * Look in the worktree first, then in the checkout it was created from,
 * resolved from the gitdir pointer in `.git`. Same order as
 * migration/02-dump.mjs and migration/05-verify.mjs, so all three read one file.
 */
function resolveEnvFile(override) {
  const candidates = [];
  if (override) candidates.push(path.resolve(process.cwd(), override));
  if (process.env.ENV_FILE) candidates.push(path.resolve(process.env.ENV_FILE));
  candidates.push(path.join(REPO_ROOT, 'server', '.env'));

  const dotGit = path.join(REPO_ROOT, '.git');
  try {
    if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
      const pointer = /gitdir:\s*(.+)/.exec(fs.readFileSync(dotGit, 'utf8'));
      // <main>/.git/worktrees/<name> -> <main>
      if (pointer) {
        const mainRoot = path.resolve(pointer[1].trim(), '..', '..', '..');
        candidates.push(path.join(mainRoot, 'server', '.env'));
      }
    }
  } catch {
    /* a missing or odd .git is not fatal — the value may come from the process env */
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { file: candidate, candidates };
  }
  return { file: '', candidates };
}

const envLookup = resolveEnvFile(args['env-file']);
const envFile = envLookup.file;
const fileEnv = envFile ? loadEnvFile(envFile) : {};

const urlEnvName = args['url-env'] || 'DATABASE_URL';
const rawUrl = process.env[urlEnvName] || fileEnv[urlEnvName] || '';

if (!rawUrl) {
  die(
    `No connection string found in ${urlEnvName}.`,
    `Looked at the process environment and these files:\n    ${envLookup.candidates.join('\n    ')}\n` +
      '  Pass --url-env=<NAME> or --env-file=<path>.'
  );
}

let conn;
try {
  const url = new URL(rawUrl);
  conn = {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
    sslmode: url.searchParams.get('sslmode') || 'require',
  };
} catch {
  die(`${urlEnvName} is not a valid connection URL.`, 'Expected postgresql://user:password@host:port/database');
}

/** The Supabase project ref is public information; the password never is. */
function projectRefOf({ user, host }) {
  const fromUser = user.includes('.') ? user.slice(user.indexOf('.') + 1) : '';
  if (fromUser) return fromUser;
  const match = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(host);
  return match ? match[1] : '(unknown)';
}
const PROJECT_REF = projectRefOf(conn);

const pgbin = args.pgbin || process.env.PGBIN || DEFAULT_PGBIN;
const psqlPath = ['psql.exe', 'psql']
  .map((name) => path.join(pgbin, name))
  .find((candidate) => fs.existsSync(candidate));

if (!psqlPath) {
  die(
    `psql was not found in ${pgbin}`,
    'Pass --pgbin=<dir> or set the PGBIN environment variable to the directory holding psql.'
  );
}

const childEnv = {
  ...process.env,
  PGHOST: conn.host,
  PGPORT: conn.port,
  PGUSER: conn.user,
  PGPASSWORD: conn.password,
  PGDATABASE: conn.database,
  PGSSLMODE: conn.sslmode,
  PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '20',
  PGCLIENTENCODING: 'UTF8',
};

// ─── psql plumbing ──────────────────────────────────────────────────────────

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return { header: [], rows: [], objects: [] };
  const header = rows[0];
  const body = rows.slice(1);
  const objects = body.map((cells) =>
    Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']))
  );
  return { header, rows: body, objects };
}

let queriesRun = 0;

/**
 * Run one SELECT inside a read-only transaction and return parsed CSV.
 * `allowFailure` is for schemas the pooler role may not be granted (auth, storage).
 */
function query(label, sql, { allowFailure = false } = {}) {
  const clean = sql.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(clean)) {
    die(`Refusing to run a non-SELECT statement for "${label}".`);
  }
  const script = [
    'begin read only;',
    `copy (${clean}) to stdout with (format csv, header true);`,
    'commit;',
    '',
  ].join('\n');
  try {
    const stdout = execFileSync(psqlPath, ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
      input: script,
      env: childEnv,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    queriesRun += 1;
    return { ok: true, ...parseCsv(stdout) };
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim().split('\n')[0] || 'psql failed';
    if (allowFailure) return { ok: false, error: detail, header: [], rows: [], objects: [] };
    die(`Query "${label}" failed.`, detail);
    return { ok: false, header: [], rows: [], objects: [] };
  }
}

// ─── output ─────────────────────────────────────────────────────────────────

function table(header, rows) {
  if (!rows.length) {
    console.log('   (none)');
    return;
  }
  const widths = header.map((name, index) =>
    Math.max(String(name).length, ...rows.map((row) => String(row[index] ?? '').length))
  );
  const line = (cells) =>
    '   ' + cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join('  ');
  console.log(line(header));
  console.log('   ' + widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

const written = [];
function writeCsv(name, header, rows) {
  if (!outDir) return;
  fs.mkdirSync(outDir, { recursive: true });
  const escape = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [header.map(escape).join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
  const file = path.join(outDir, `${name}.csv`);
  fs.writeFileSync(file, `${csv}\n`, 'utf8');
  written.push(file);
}

function sqlTime(iso) {
  // SINCE is produced by Date#toISOString, so it can never contain a quote.
  return `'${iso}'::timestamptz`;
}

// ─── plan ───────────────────────────────────────────────────────────────────

console.log('');
console.log('  Post-cutover delta — READ ONLY');
console.log('  ══════════════════════════════════════════════════════════════');
console.log(`  project ref  : ${PROJECT_REF}`);
console.log(`  host         : ${conn.host}:${conn.port}  db=${conn.database}  sslmode=${conn.sslmode}`);
console.log(`  config from  : ${urlEnvName} (${process.env[urlEnvName] ? 'process env' : envFile || '(no .env found)'})`);
console.log(`  psql         : ${psqlPath}`);
console.log(`  cutover at   : ${SINCE}`);
console.log(`  csv output   : ${outDir || '(none — pass --out=<dir> to keep the evidence)'}`);
console.log('');
console.log('  About to run, each inside "begin read only":');
console.log('    1. connection identity and server clock');
console.log('    2. public tables — rows with created_at >= cutover');
console.log('    3. kv_collections — rows changed since cutover, per collection');
console.log('    4. scheduler "already sent" markers written since cutover');
console.log('    5. signature_evidence — events grouped by the key that sealed them');
console.log('    6. storage objects created since cutover, per bucket');
console.log('    7. absolute storage URLs, grouped by the project ref inside them');
console.log('    8. auth.users created since cutover');
console.log('');

// ─── 1. identity ────────────────────────────────────────────────────────────

const identity = query(
  'identity',
  `select current_database() as database,
          current_user as role,
          now() as server_time,
          ${sqlTime(SINCE)} as cutover_at,
          date_trunc('second', now() - ${sqlTime(SINCE)})::text as elapsed`
);
console.log('  1. Connection');
table(identity.header, identity.rows);
const elapsed = identity.objects[0]?.elapsed || '(unknown)';
console.log('');

// ─── 2. public tables ───────────────────────────────────────────────────────

const withCreatedAt = query(
  'tables with created_at',
  `select c.table_name
     from information_schema.columns c
     join information_schema.tables t
       on t.table_schema = c.table_schema
      and t.table_name = c.table_name
      and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name = 'created_at'
    order by 1`
).objects
  .map((row) => row.table_name)
  .filter((name) => /^[a-z0-9_]+$/i.test(name))
  // kv_collections also has a created_at column, but it is not a table anyone
  // re-enters by hand — it is the single table holding all 76 operational
  // collections, and section 3 breaks it down per collection. Counting it here
  // too would add every one of those rows a second time, inflating both the CSV
  // and the summary line the rollback decision is made from.
  .filter((name) => name !== 'kv_collections');

console.log(`  2. Real public tables with a created_at column: ${withCreatedAt.length}  (kv_collections is section 3)`);

let directRows = [];
if (withCreatedAt.length) {
  const union = withCreatedAt
    .map(
      (name) =>
        `select '${name}' as table_name,
                count(*) as rows_after,
                min(created_at)::text as first_row,
                max(created_at)::text as last_row
           from public.${name}
          where created_at::timestamptz >= ${sqlTime(SINCE)}`
    )
    .join('\n union all\n');
  // Tolerate failure: one unreadable table must not abort the run before the
  // scheduler markers, the seals and the storage list have been captured.
  const result = query(
    'public table counts',
    `select * from (\n${union}\n) t where rows_after > 0 order by rows_after desc`,
    { allowFailure: true }
  );
  if (!result.ok) {
    console.log(`   (could not read one or more public tables: ${result.error})`);
    console.log('    Later sections still ran. Rerun this section from the SQL editor if you need it.');
  } else {
    directRows = result.rows;
    table(result.header, result.rows);
    writeCsv('01-public-tables', result.header, result.rows);
  }
}
const directTotal = directRows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
console.log('');

// ─── 3. kv_collections ──────────────────────────────────────────────────────

const kv = query(
  'kv_collections delta',
  `select collection,
          count(*) as rows_after,
          min(updated_at)::text as first_change,
          max(updated_at)::text as last_change
     from public.kv_collections
    where updated_at::timestamptz >= ${sqlTime(SINCE)}
    group by 1
    order by 2 desc`
);
console.log('  3. kv_collections changed since cutover');
table(kv.header, kv.rows);
writeCsv('02-kv-collections', kv.header, kv.rows);
const kvTotal = kv.rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
console.log('');

// ─── 4. scheduler send markers ──────────────────────────────────────────────

const markerList = SEND_MARKER_COLLECTIONS.map((name) => `'${name}'`).join(', ');
const markers = query(
  'send markers',
  `select collection,
          count(*) as markers_after,
          min(updated_at)::text as first_marker,
          max(updated_at)::text as last_marker
     from public.kv_collections
    where collection in (${markerList})
      and updated_at::timestamptz >= ${sqlTime(SINCE)}
    group by 1
    order by 2 desc`
);
console.log('  4. Scheduler "already sent" markers written since cutover');
console.log('     Losing these does not lose data — it makes the bot message a real customer twice.');
console.log('     whatsapp_logs is the message journal, not a dedupe marker: it is the count of');
console.log('     messages that actually went out, which is the size of the re-send blast radius.');
table(markers.header, markers.rows);
writeCsv('03-send-markers', markers.header, markers.rows);
const markerTotal = markers.rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
console.log('');

// ─── 5. signature evidence ──────────────────────────────────────────────────

const seals = query(
  'signature evidence keys',
  `select coalesce(data->>'key_id', '(missing)') as key_id,
          coalesce(data->>'seal_strength', '(missing)') as seal_strength,
          count(*) as events,
          count(*) filter (where updated_at::timestamptz >= ${sqlTime(SINCE)}) as after_cutover,
          min(data->>'occurred_at') as first_event,
          max(data->>'occurred_at') as last_event
     from public.kv_collections
    where collection = 'signature_evidence'
    group by 1, 2
    order by 3 desc`
);
console.log('  5. signature_evidence, grouped by the HMAC key that sealed each event');
console.log('     key_id is what decides verification. seal_strength only records WHICH env var');
console.log('     supplied the secret, so it can change while the key stays byte-identical.');
console.log('     One key_id for the whole history = every seal verifies under one secret.');
console.log('     Two key_ids = one of the groups cannot be verified wherever the other one is set.');
table(seals.header, seals.rows);
writeCsv('04-signature-evidence-keys', seals.header, seals.rows);
const sealsAfter = seals.objects.reduce((sum, row) => sum + Number(row.after_cutover || 0), 0);

// Group rows are (key_id, seal_strength) pairs, not keys. Pinning
// EVIDENCE_SIGNING_SECRET to the value the fallback chain was ALREADY using
// derives the identical HMAC key: key_id does not move, only seal_strength
// flips derived_server_secret -> dedicated_secret. Counting group rows would
// report that as a key change and warn the operator off a rollback that is in
// fact safe — so count distinct key_id, and report the label change separately.
const sealGroups = seals.objects.filter((row) => Number(row.events) > 0);
const distinctKeys = new Set(sealGroups.map((row) => row.key_id)).size;
const distinctStrengths = new Set(sealGroups.map((row) => row.seal_strength)).size;

if (sealsAfter > 0) {
  const sealed = query(
    'signature evidence after cutover',
    `select id,
            data->>'document_type' as document_type,
            data->>'document_id' as document_id,
            data->>'signer_parent_id' as signer_parent_id,
            data->>'student_id' as student_id,
            data->>'occurred_at' as occurred_at,
            data->>'key_id' as key_id
       from public.kv_collections
      where collection = 'signature_evidence'
        and updated_at::timestamptz >= ${sqlTime(SINCE)}
      order by 6`
  );
  writeCsv('05-signature-evidence-rows', sealed.header, sealed.rows);
  console.log(`     ${sealed.rows.length} signed documents after cutover (full list in 05-signature-evidence-rows.csv).`);
}
console.log('');

// ─── 6. storage ─────────────────────────────────────────────────────────────

console.log('  6. Storage objects created since cutover');
const buckets = query(
  'storage buckets',
  `select o.bucket_id,
          count(*) as objects,
          coalesce(sum((o.metadata->>'size')::bigint), 0) as bytes,
          min(o.created_at)::text as first_upload,
          max(o.created_at)::text as last_upload
     from storage.objects o
    where o.created_at >= ${sqlTime(SINCE)}
    group by 1
    order by 2 desc`,
  { allowFailure: true }
);

let fileTotal = 0;
let byteTotal = 0;
if (!buckets.ok) {
  console.log(`   (storage.objects not readable with this role: ${buckets.error})`);
  console.log('    Fall back to the Supabase dashboard → Storage, or run this as the postgres role.');
} else {
  table(buckets.header, buckets.rows);
  fileTotal = buckets.rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
  byteTotal = buckets.rows.reduce((sum, row) => sum + Number(row[2] || 0), 0);
  writeCsv('06-storage-buckets', buckets.header, buckets.rows);

  if (fileTotal > 0) {
    const objects = query(
      'storage objects',
      `select bucket_id,
              name,
              created_at::text as created_at,
              coalesce((metadata->>'size')::bigint, 0) as bytes
         from storage.objects
        where created_at >= ${sqlTime(SINCE)}
        order by bucket_id, created_at`,
      { allowFailure: true }
    );
    if (objects.ok) {
      writeCsv('07-storage-objects', objects.header, objects.rows);
      console.log('');
      console.log(`     First ${Math.min(filesLimit, objects.rows.length)} of ${objects.rows.length}:`);
      table(objects.header, objects.rows.slice(0, filesLimit));
      if (objects.rows.length > filesLimit) {
        console.log(`   … ${objects.rows.length - filesLimit} more${outDir ? ' (full list in 07-storage-objects.csv)' : ' — rerun with --out=<dir>'}`);
      }
    }
  }
}
console.log('');

// ─── 7. absolute URLs ───────────────────────────────────────────────────────

const urls = query(
  'absolute storage urls',
  `select source, coalesce(project_ref, '(not a supabase url)') as project_ref, count(*) as rows
     from (
       select 'pricelist.image' as source,
              substring(data->>'image' from 'https://([a-z0-9]+)\\.supabase\\.co') as project_ref
         from public.kv_collections
        where collection = 'pricelist'
          and data->>'image' like 'http%'
       union all
       select 'form_templates.cover_image',
              substring(cover_image from 'https://([a-z0-9]+)\\.supabase\\.co')
         from public.form_templates
        where cover_image like 'http%'
       union all
       -- Third address field, same bucket and same writer as pricelist.image.
       -- It held zero old-ref rows at dump time, which is why the headline
       -- count is 43 — but a category photo uploaded after the cutover lands
       -- here, and it would be the one broken image nobody thought to check.
       -- migration/04-rewrite-urls.sql covers it for the same reason.
       select 'product_categories.image',
              substring(data->>'image' from 'https://([a-z0-9]+)\\.supabase\\.co')
         from public.kv_collections
        where collection = 'product_categories'
          and data->>'image' like 'http%'
     ) u
    group by 1, 2
    order by 1, 3 desc`,
  { allowFailure: true }
);
console.log('  7. Absolute storage URLs stored in rows, by the project ref inside the URL');
if (!urls.ok) {
  console.log(`   (could not read: ${urls.error})`);
} else {
  table(urls.header, urls.rows);
  writeCsv('08-absolute-urls', urls.header, urls.rows);
}
console.log('');

// ─── 8. auth ────────────────────────────────────────────────────────────────

const authUsers = query(
  'auth users',
  `select count(*) as users_total,
          count(*) filter (where created_at >= ${sqlTime(SINCE)}) as users_after_cutover,
          max(last_sign_in_at)::text as last_sign_in
     from auth.users`,
  { allowFailure: true }
);
console.log('  8. auth.users');
if (!authUsers.ok) {
  console.log(`   (auth schema not readable with this role: ${authUsers.error})`);
} else {
  table(authUsers.header, authUsers.rows);
  writeCsv('09-auth-users', authUsers.header, authUsers.rows);
}
console.log('');

// ─── summary ────────────────────────────────────────────────────────────────

const authAfter = Number(authUsers.objects[0]?.users_after_cutover || 0);

console.log('  Summary');
console.log('  ══════════════════════════════════════════════════════════════');
console.log(`  project inspected      : ${PROJECT_REF}`);
console.log(`  time since cutover     : ${elapsed}`);
console.log(`  rows in public tables  : ${directTotal} across ${directRows.length} tables`);
console.log(`  rows in kv_collections : ${kvTotal} across ${kv.rows.length} collections`);
console.log(`  scheduler send markers : ${markerTotal}`);
console.log(`  documents sealed       : ${sealsAfter}  (distinct signing keys in history: ${distinctKeys})`);
console.log(`  storage objects        : ${fileTotal}  (${byteTotal} bytes)`);
console.log(`  new staff logins       : ${authAfter}`);
console.log(`  queries run            : ${queriesRun}, all read-only`);
if (written.length) {
  console.log('');
  console.log('  Written:');
  for (const file of written) console.log(`    ${file}`);
} else {
  console.log('');
  console.log('  Nothing written to disk. Rerun with --out=<dir> before rolling back —');
  console.log('  after the rollback this list can no longer be produced from the live system.');
}
console.log('');

if (distinctKeys > 1) {
  console.log(`  ⚠ ${distinctKeys} distinct signing KEYS appear in signature_evidence (column key_id).`);
  console.log('    Only one secret can be live at a time, so at least one of these groups does not');
  console.log('    verify right now and will not verify after a rollback either — copying the rows');
  console.log('    back does not help. Decide which group must verify BEFORE the cutover: that');
  console.log('    choice fixes the value of EVIDENCE_SIGNING_SECRET, and it cannot be had both ways.');
  console.log('    Check the live answer per document with GET /api/signature-evidence?documentId=<id>');
  console.log('    and read seal_valid — this script reports grouping, not verification.');
  console.log('');
} else if (distinctStrengths > 1) {
  console.log('  ℹ One signing key, two seal_strength labels.');
  console.log('    This is the healthy shape: the secret was pinned into EVIDENCE_SIGNING_SECRET at');
  console.log('    its existing value, so the derived key never moved. Every seal still verifies,');
  console.log('    and it keeps verifying on both sides of a rollback.');
  console.log('');
}
if (markerTotal > 0) {
  console.log('  ⚠ Scheduler send markers exist after the cutover.');
  console.log('    Roll back with the scheduler off (RUN_SCHEDULED_JOBS=0 on Render), review this');
  console.log('    list, and only then turn it back on — otherwise those messages go out again.');
  console.log('');
}
