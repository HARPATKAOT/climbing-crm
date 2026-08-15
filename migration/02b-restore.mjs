#!/usr/bin/env node
/**
 * 02b-restore.mjs — load a 02-dump.mjs backup into a NEW, EMPTY Supabase project.
 *
 * This replaces step 7 of the runbook, which was "do it by hand in psql". That
 * step is fifteen minutes of copy-pasting five commands in the right order,
 * during a window in which the CRM is down, and one of the five is known to
 * fail on its first three lines. Every property of that is an argument for a
 * script.
 *
 * WHAT IT WRITES: everything, into the target. That is the point. The guards
 * are therefore about WHICH database it is allowed to write to:
 *   - It refuses to run against the old project, matched on the ref in the URL.
 *   - It refuses to run against a target whose public schema already holds
 *     tables, unless --allow-nonempty is given.
 *   - It does nothing at all without --confirm.
 *
 * THE KNOWN CONFLICT: 02-public-complete.sql opens with CREATE SCHEMA public /
 * ALTER SCHEMA public OWNER TO / COMMENT ON SCHEMA public. A fresh Supabase
 * project already has that schema, owned by someone else, so under
 * ON_ERROR_STOP=1 the restore dies before creating a single table. Rather than
 * dropping ON_ERROR_STOP — which would also swallow the errors that matter —
 * this script rewrites those three statements out of a COPY of the file, after
 * verifying they are character-for-character what it expects. If the dump ever
 * changes shape, it aborts instead of guessing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

const DEFAULT_PG_BIN =
  'C:/Users/dalak/AppData/Local/Temp/claude/C--Users-dalak--gemini-antigravity-scratch-climbing-crm/831be2e5-05df-49e1-b84d-49a76a2e4bdd/scratchpad/pgtools/pgsql/bin';

const OLD_REF = 'xaxykjvqqhrodmseqleu';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CONFIRM = flag('confirm');
const ALLOW_NONEMPTY = flag('allow-nonempty');
const PG_BIN = opt('pg-bin', process.env.PG_BIN || DEFAULT_PG_BIN);
const ENV_FILE = opt('env-file', path.join(REPO, 'server', '.env'));
const DUMP_DIR = opt('dump', '');

const psql = path.join(PG_BIN, process.platform === 'win32' ? 'psql.exe' : 'psql');

// ── env ─────────────────────────────────────────────────────────────────────
function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const env = readEnv(ENV_FILE);
const TARGET = process.env.NEW_DATABASE_URL || env.NEW_DATABASE_URL || '';

// ── helpers ─────────────────────────────────────────────────────────────────
const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };
const say = (msg) => console.log(msg);

/** Host only — never the password. */
function describeTarget(url) {
  try {
    const u = new URL(url);
    return `${u.username.replace(/^postgres\./, 'postgres.…')}@${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(unparseable)';
  }
}

function runPsql(args, { input } = {}) {
  return spawnSync(psql, args, {
    encoding: 'utf8',
    input,
    maxBuffer: 1024 * 1024 * 512,
    env: { ...process.env, PGCLIENTENCODING: 'UTF8' },
  });
}

function query(sql) {
  const r = runPsql([TARGET, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  if (r.status !== 0) fail(`query failed: ${(r.stderr || '').trim()}`);
  return (r.stdout || '').trim();
}

// ── the three statements we are allowed to drop ─────────────────────────────
const SCHEMA_PREAMBLE = [
  'CREATE SCHEMA public;',
  'ALTER SCHEMA public OWNER TO pg_database_owner;',
  "COMMENT ON SCHEMA public IS 'standard public schema';",
];

/**
 * Return a path to a copy of `file` with the statements a managed Supabase
 * project refuses commented out, and a note of how many there were.
 *
 * Two classes, both verified against a real rehearsal rather than guessed:
 *
 *   1. The schema preamble. A fresh project already owns `public`, so
 *      CREATE SCHEMA / ALTER SCHEMA OWNER / COMMENT ON SCHEMA all fail. These
 *      three are matched character-for-character and the script aborts if the
 *      dump does not contain exactly one of each — if the shape changed, it has
 *      no business editing the file.
 *
 *   2. ALTER DEFAULT PRIVILEGES. These are owned by `supabase_admin` and
 *      `postgres`, and our pooler role may not change them. They govern the
 *      permissions of objects created in FUTURE, they are identical platform
 *      defaults on any new project, and every one of them sits after the data.
 *      Dropping them costs nothing; letting one abort the restore costs the
 *      whole restore, 34 seconds and 18MB in.
 *
 * Ordinary GRANTs are deliberately NOT in this list. Those decide whether
 * `anon` can read a table, which is the difference between a locked database
 * and an open one, and they must fail loudly if they fail at all.
 */
function prepareRestoreFile(file, outDir) {
  const src = fs.readFileSync(file, 'utf8');
  let out = src;

  for (const stmt of SCHEMA_PREAMBLE) {
    const hits = src.split(stmt).length - 1;
    if (hits !== 1) {
      fail(
        `expected exactly one occurrence of\n    ${stmt}\n` +
        `in ${path.basename(file)}, found ${hits}. The dump does not match what ` +
        `this script was written for — restore by hand and re-check the runbook.`
      );
    }
    out = out.replace(stmt, `-- [02b-restore] skipped, already present in a fresh project:\n-- ${stmt}`);
  }

  let defaultPrivileges = 0;
  out = out.replace(/^ALTER DEFAULT PRIVILEGES .*$/gm, (line) => {
    defaultPrivileges += 1;
    return `-- [02b-restore] skipped, platform-managed: ${line}`;
  });

  const dest = path.join(outDir, `${path.basename(file, '.sql')}.restore-ready.sql`);
  fs.writeFileSync(dest, out, 'utf8');
  return { dest, defaultPrivileges };
}

// ── main ────────────────────────────────────────────────────────────────────
say('');
say('  02b-restore — load a backup into a new Supabase project');
say('  ─────────────────────────────────────────────────────────');

if (!fs.existsSync(psql)) fail(`psql not found at ${psql}\n  pass --pg-bin <dir>`);
if (!DUMP_DIR) fail('pass --dump <folder>, e.g. --dump migration/dump/2026-08-15T0130');

const dumpDir = path.resolve(process.cwd(), DUMP_DIR);
if (!fs.existsSync(dumpDir)) fail(`no such dump folder: ${dumpDir}`);

const manifestPath = path.join(dumpDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail(`no manifest.json in ${dumpDir} — is this a 02-dump output?`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (!TARGET) {
  fail(
    'NEW_DATABASE_URL is not set.\n' +
    `  Add it to ${ENV_FILE} as the SESSION-mode pooler URI of the NEW project,\n` +
    '  or export it in the shell. It is never read from the old project vars.'
  );
}

// Guard 1 — never the old project.
if (TARGET.includes(OLD_REF)) {
  fail(
    `NEW_DATABASE_URL points at the OLD project (${OLD_REF}).\n` +
    '  This script only ever writes to the new one. Nothing was done.'
  );
}

say('');
say(`  dump      ${dumpDir}`);
say(`  taken at  ${manifest.finishedAt || 'unknown'}`);
say(`  target    ${describeTarget(TARGET)}`);
say(`  psql      ${psql}`);

const consistency = manifest.consistency?.mode || 'unknown';
say(`  snapshot  ${consistency}`);
if (consistency !== 'single-snapshot') {
  say('  ⚠ this dump was NOT taken in one consistent snapshot');
}

// Guard 2 — target must be empty.
say('');
say('  checking the target is empty …');
const existing = query(
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
);
say(`  public schema currently holds ${existing} table(s)`);
if (Number(existing) > 0 && !ALLOW_NONEMPTY) {
  fail(
    `the target already has ${existing} tables. Restoring on top of them will\n` +
    '  produce duplicate-key and already-exists errors and leave a half-state.\n' +
    '  Use a fresh project, or pass --allow-nonempty if you know why.'
  );
}

// The order comes from the manifest, which is written by 02-dump alongside the
// files — so the two can never drift apart.
// `strict: false` means "make sure these things exist, and tell me what didn't".
// 00-roles and 01-globals describe a managed platform: a fresh Supabase project
// already ships most of the extensions, and some database-level settings belong
// to Supabase and cannot be set by the role we connect as — the rehearsal died
// here on ALTER DATABASE ... SET app.settings.jwt_exp, which is the dashboard's
// JWT-expiry field wearing a SQL costume. Those are re-created by hand from
// 06-cutover.md, not restored. Schema and data stay strict: there, a statement
// that does not apply is data that will not be there.
const ORDER = [
  { file: '00-roles.sql', when: () => (manifest.roles?.custom || []).length > 0, note: 'custom roles', strict: false },
  { file: '01-globals.sql', when: () => true, note: 'extensions + settings', strict: false },
  { file: '02-public-complete.sql', when: () => true, note: 'public schema + data', neutralize: true, strict: true },
  { file: '07-auth-core-data.sql', when: () => true, note: 'auth.users + auth.identities', strict: true },
  { file: '10-storage-buckets-data.sql', when: () => true, note: 'storage bucket definitions', strict: true },
];

const planned = ORDER.filter((s) => fs.existsSync(path.join(dumpDir, s.file)) && s.when());
say('');
say('  restore order:');
for (const [i, s] of planned.entries()) {
  const size = (fs.statSync(path.join(dumpDir, s.file)).size / 1048576).toFixed(1);
  say(`    ${i + 1}. ${s.file.padEnd(28)} ${size.padStart(6)} MB   ${s.note}`);
}

if (!CONFIRM) {
  say('');
  say('  DRY RUN — nothing was written. Re-run with --confirm to restore.');
  say('');
  process.exit(0);
}

const workDir = path.join(dumpDir, '.restore-ready');
fs.mkdirSync(workDir, { recursive: true });

/** Non-fatal statements that did not apply — surfaced again in the summary. */
const skipped = [];

say('');
for (const [i, step] of planned.entries()) {
  const src = path.join(dumpDir, step.file);
  let toRun = src;
  if (step.neutralize) {
    const prepared = prepareRestoreFile(src, workDir);
    toRun = prepared.dest;
    say(`  · ${step.file}: commented out 3 schema-preamble statements` +
        ` and ${prepared.defaultPrivileges} ALTER DEFAULT PRIVILEGES`);
    skipped.push(
      `${step.file}: 3 schema-preamble + ${prepared.defaultPrivileges} default-privilege statements (platform-managed)`
    );
  }

  process.stdout.write(`  ${i + 1}/${planned.length} ${step.file} … `);
  const started = Date.now();
  const stopArg = step.strict ? ['-v', 'ON_ERROR_STOP=1'] : [];
  const r = runPsql([TARGET, ...stopArg, '-q', '-f', toRun]);
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  if (step.strict && r.status !== 0) {
    say('FAILED');
    say('');
    say((r.stderr || '').trim().split('\n').slice(-25).join('\n'));
    fail(
      `${step.file} failed after ${secs}s. The target is now half-restored —\n` +
      '  drop it and start from an empty project rather than re-running.'
    );
  }

  const errors = (r.stderr || '')
    .split('\n')
    .filter((l) => /^psql:.*ERROR:/.test(l))
    .map((l) => l.replace(/^psql:[^:]*:\d+:\s*/, ''));

  if (!step.strict && errors.length) {
    say(`ok with ${errors.length} skipped (${secs}s)`);
    for (const e of errors) say(`      skipped: ${e}`);
    skipped.push(...errors.map((e) => `${step.file}: ${e}`));
  } else {
    say(`ok (${secs}s)`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
say('');
say('  restored. counting what landed:');
const tables = query(
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
);
const users = query('select count(*) from auth.users');
const identities = query('select count(*) from auth.identities');
const buckets = query('select count(*) from storage.buckets');
const kv = query("select count(*) from public.kv_collections");

const expect = manifest.rowCounts || {};
const line = (label, got, want) => {
  const ok = want === undefined || String(got) === String(want);
  say(`    ${ok ? '✓' : '✗'} ${label.padEnd(28)} ${String(got).padStart(7)}${want !== undefined ? `   expected ${want}` : ''}`);
  return ok;
};

let allOk = true;
allOk = line('public tables', tables, expect.__publicTables) && allOk;
allOk = line('auth.users', users, expect['auth.users']) && allOk;
allOk = line('auth.identities', identities, expect['auth.identities']) && allOk;
allOk = line('storage.buckets', buckets, expect['storage.buckets']) && allOk;
allOk = line('kv_collections rows', kv, expect.kv_collections) && allOk;

if (skipped.length) {
  say('');
  say(`  ${skipped.length} statement(s) did not apply, all in the managed-platform files:`);
  for (const s of skipped) say(`    · ${s}`);
  say('  These are Supabase-owned settings. Re-create them by hand from');
  say('  06-cutover.md — they are not data and nothing is missing from the CRM.');
}

say('');
say('  NEXT: files are not in a database dump — run 03-copy-storage.mjs,');
say('  then 04-rewrite-urls.mjs, then 05-verify.mjs as the real gate.');
say('');

process.exit(allOk ? 0 : 2);
