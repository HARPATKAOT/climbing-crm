#!/usr/bin/env node
/**
 * migration/03-copy-storage.mjs
 * ---------------------------------------------------------------------------
 * Copy the Supabase Storage buckets from the OLD project (ap-northeast-2) to
 * the NEW project (eu-central-1).
 *
 * A Postgres dump does NOT carry bucket objects. This script is the only thing
 * that moves the files themselves.
 *
 * Buckets (confirmed against server/supa.js and database/*.sql):
 *   product-images      public   — catalog photos, referenced by ABSOLUTE URLs
 *                                  in pricelist.image / form_templates.cover_image
 *                                  (created by hand in the dashboard: there is no
 *                                  CREATE-bucket SQL for it anywhere in the repo,
 *                                  so this script reads its real config from the
 *                                  Storage API instead of assuming one)
 *   client-documents    private  — health waivers / liability PDFs
 *                                  (database/20260721_client_documents_onboarding.sql)
 *   employee-documents  private  — HR documents
 *                                  (database/20260725_employee_documents_storage.sql)
 *
 * ORDER RELATIVE TO 02-dump / the restore
 *   02-dump.mjs writes 10-storage-buckets-data.sql, a data-only dump of
 *   storage.buckets. Either restore that file OR let this script create the
 *   buckets — not both. Restoring the file into a project where this script has
 *   already created the buckets fails on the primary key. Running this script
 *   after the restore is fine: it finds the buckets, reports any config drift
 *   and copies objects into them.
 *
 * SAFETY
 *   - Nothing is ever deleted, in either project.
 *   - Default mode is a DRY RUN: it enumerates, diffs and reports. Writing to
 *     the target project requires --confirm.
 *   - Refuses to run if the target ref equals the source ref, or if the target
 *     ref is the known OLD project ref (see OLD_PROJECT_REF below).
 *   - Never prints a secret value.
 *   - Object paths are printed only with --verbose, on a retry, or when an
 *     object fails. They contain customer and employee identifiers, so keep the
 *     console output out of tickets and chat logs.
 *
 * MEASURED THROUGHPUT
 *   198 objects / 50.6 MB pulled from the Seoul project at concurrency 6 took
 *   100 s (~500 KB/s), one transient failure auto-recovered by the retry. All
 *   three buckets together are 572 objects / ~116 MB, so budget 10-15 minutes
 *   for a real copy once upload time to Frankfurt is added.
 *
 * RESUMABLE
 *   Progress is kept in migration/state/storage-<bucket>.json. A re-run skips
 *   every object already recorded there, and additionally skips anything that
 *   already exists in the target with a matching byte size (so a run that died
 *   before the ledger was flushed still resumes correctly).
 *
 * WHAT "VERIFIED" MEANS HERE
 *   After copying, the target bucket is re-enumerated and every source object
 *   must be present with a byte-identical size. Content is NOT hashed — the
 *   storage API does not expose a checksum we can compare cheaply, so a file
 *   whose bytes changed but whose length did not would pass. Object counts and
 *   total bytes are reported for both sides; objects that exist only in the
 *   target are reported as a warning and never deleted, and do not by
 *   themselves fail the bucket.
 *
 * CONFIG (read from server/.env; real environment variables win)
 *   SUPABASE_URL                    source project URL
 *   SUPABASE_SERVICE_ROLE_KEY       source service_role key (SUPABASE_SERVICE_KEY also accepted)
 *   NEW_SUPABASE_URL                target project URL          <- operator adds these two
 *   NEW_SUPABASE_SERVICE_ROLE_KEY   target service_role key        before running
 *
 * USAGE
 *   node migration/03-copy-storage.mjs                      # dry run, all three buckets
 *   node migration/03-copy-storage.mjs --confirm            # actually copy
 *   node migration/03-copy-storage.mjs --inventory          # source-side count/bytes only (no target needed)
 *   node migration/03-copy-storage.mjs --verify-only        # compare source vs target, no writes
 *   node migration/03-copy-storage.mjs --bucket=product-images --confirm
 *   node migration/03-copy-storage.mjs --all-buckets --confirm
 *
 * FLAGS
 *   --confirm               perform writes (create buckets, upload objects)
 *   --inventory             enumerate the SOURCE only; no target credentials needed
 *   --verify-only           enumerate both sides and print pass/fail; no writes,
 *                           and the ledger is neither read nor written
 *   --bucket=a,b            limit to these buckets (repeatable)
 *   --all-buckets           every bucket that exists in the source project
 *   --concurrency=N         parallel object copies (default 6)
 *   --page-size=N           objects per list request (default 1000)
 *   --retries=N             attempts per object (default 4)
 *   --stream-threshold=N    bytes above which an object is streamed instead of
 *                           buffered. Default 0 = never stream. Both private
 *                           buckets cap objects at 10 MB, so buffering is safe
 *                           and avoids chunked-upload edge cases; streaming is
 *                           opt-in for a bucket that later holds huge files.
 *   --fix-bucket-config     if a target bucket exists with different settings,
 *                           update it to match the source (needs --confirm)
 *   --fresh-ledger          start a new ledger (the old one is renamed, never deleted)
 *   --env=PATH              explicit .env file
 *   --verbose               one line per object (prints customer file paths)
 *   --help
 *
 * Exit codes: 0 ok · 1 copy/verify failure · 2 configuration problem
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const STATE_DIR = path.join(HERE, 'state');

const DEFAULT_BUCKETS = ['product-images', 'client-documents', 'employee-documents'];
const FOLDER_PLACEHOLDER = '.emptyFolderPlaceholder';
const MAX_PREFIX_DEPTH = 24;
const MAX_PAGES_PER_PREFIX = 10000;

/**
 * The project being migrated away from. Used only as a guard: writing into this
 * ref with --confirm would upsert over live customer documents, so it is
 * refused as a target no matter which URL it arrives under.
 */
const OLD_PROJECT_REF = 'xaxykjvqqhrodmseqleu';

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    confirm: false,
    inventory: false,
    verifyOnly: false,
    allBuckets: false,
    buckets: [],
    concurrency: 6,
    pageSize: 1000,
    retries: 4,
    streamThreshold: 0,
    fixBucketConfig: false,
    freshLedger: false,
    envFile: '',
    verbose: false,
    help: false,
  };
  for (const raw of argv) {
    const arg = String(raw);
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--confirm') opts.confirm = true;
    else if (arg === '--inventory') opts.inventory = true;
    else if (arg === '--verify-only') opts.verifyOnly = true;
    else if (arg === '--all-buckets') opts.allBuckets = true;
    else if (arg === '--fix-bucket-config') opts.fixBucketConfig = true;
    else if (arg === '--fresh-ledger') opts.freshLedger = true;
    else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg.startsWith('--bucket=')) {
      for (const name of arg.slice('--bucket='.length).split(',')) {
        const trimmed = name.trim();
        if (trimmed && !opts.buckets.includes(trimmed)) opts.buckets.push(trimmed);
      }
    } else if (arg.startsWith('--concurrency=')) opts.concurrency = boundedInt(arg, opts.concurrency, 1);
    else if (arg.startsWith('--page-size=')) opts.pageSize = boundedInt(arg, opts.pageSize, 1);
    else if (arg.startsWith('--retries=')) opts.retries = boundedInt(arg, opts.retries, 1);
    else if (arg.startsWith('--stream-threshold=')) opts.streamThreshold = boundedInt(arg, opts.streamThreshold, 0);
    else if (arg.startsWith('--env=')) opts.envFile = arg.slice('--env='.length).trim();
    else {
      console.error(`Unknown argument: ${arg}  (try --help)`);
      process.exit(2);
    }
  }
  return opts;
}

function boundedInt(arg, fallback, minimum) {
  const value = Number(arg.slice(arg.indexOf('=') + 1));
  if (!Number.isFinite(value) || value < minimum) return fallback;
  return Math.floor(value);
}

// ---------------------------------------------------------------------------
// .env loading (no dependencies — dotenv is not importable from this folder)
// ---------------------------------------------------------------------------

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** The main checkout's server/.env, when this file lives in a git worktree. */
function mainCheckoutEnvPath() {
  try {
    const gitPointer = path.join(REPO_ROOT, '.git');
    if (!fs.existsSync(gitPointer) || fs.statSync(gitPointer).isDirectory()) return '';
    const match = /gitdir:\s*(.+)/.exec(fs.readFileSync(gitPointer, 'utf8'));
    if (!match) return '';
    const gitDir = match[1].trim().replace(/\\/g, '/');
    const at = gitDir.indexOf('/.git/worktrees/');
    if (at === -1) return '';
    return path.join(gitDir.slice(0, at), 'server', '.env');
  } catch {
    return '';
  }
}

function loadEnv(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(path.resolve(explicitPath));
  else {
    if (process.env.MIGRATION_ENV_FILE) candidates.push(path.resolve(process.env.MIGRATION_ENV_FILE));
    candidates.push(path.join(REPO_ROOT, 'server', '.env'));
    const fromMain = mainCheckoutEnvPath();
    if (fromMain) candidates.push(fromMain);
  }
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const parsed = parseEnvFile(fs.readFileSync(candidate, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return candidate;
  }
  return '';
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1024;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(scaled >= 100 ? 0 : 1)} ${units[unit]}`;
}

function projectRef(url) {
  try {
    const host = new URL(url).hostname;
    const first = host.split('.')[0];
    return first || host;
  } catch {
    return '';
  }
}

/** Same rule as server/supa.js isServiceRoleKey — kept local to avoid importing the server. */
function looksLikeServiceRoleKey(value) {
  const key = String(value || '').trim();
  if (!key) return false;
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

/** Identity we are allowed to print: never the key itself. */
function keyFingerprint(key) {
  const value = String(key || '');
  if (!value) return 'missing';
  const kind = value.startsWith('sb_secret_') ? 'sb_secret' : value.split('.').length === 3 ? 'jwt' : 'unknown';
  return `present (${kind}, service_role: ${looksLikeServiceRoleKey(value) ? 'yes' : 'NO'})`;
}

function encodeObjectPath(objectPath) {
  return String(objectPath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function normalizeCacheControl(raw) {
  const text = String(raw || '');
  const match = /(\d+)/.exec(text);
  if (!match) return 'max-age=3600';
  return `max-age=${match[1]}`;
}

class StorageError extends Error {
  constructor(message, { status = 0, body = '', retryable = false } = {}) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

async function withRetry(label, attempts, fn) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      const fatal = error instanceof StorageError && !error.retryable;
      if (fatal || attempt === attempts) break;
      const wait = Math.min(15000, 400 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
      console.log(`      retry ${attempt + 1}/${attempts} for ${label} in ${wait}ms — ${error.message}`);
      await sleep(wait);
    }
  }
  throw lastError;
}

async function runPool(items, limit, worker) {
  const size = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

// ---------------------------------------------------------------------------
// Storage REST client (service-role)
// ---------------------------------------------------------------------------

class StorageProject {
  constructor(label, url, key) {
    this.label = label;
    this.url = String(url).replace(/\/+$/, '');
    this.key = key;
    this.ref = projectRef(this.url);
  }

  headers(extra = {}) {
    return {
      authorization: `Bearer ${this.key}`,
      apikey: this.key,
      ...extra,
    };
  }

  async request(pathname, { method = 'GET', headers = {}, body, duplex } = {}) {
    const target = `${this.url}${pathname}`;
    let response;
    try {
      response = await fetch(target, {
        method,
        headers: this.headers(headers),
        body,
        ...(duplex ? { duplex } : {}),
      });
    } catch (error) {
      throw new StorageError(`${this.label}: network error on ${method} ${pathname} — ${error.message}`, {
        retryable: true,
      });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw new StorageError(
        `${this.label}: ${method} ${pathname} failed with HTTP ${response.status}${text ? ` — ${text.slice(0, 300)}` : ''}`,
        { status: response.status, body: text, retryable }
      );
    }
    return response;
  }

  async json(pathname, init) {
    const response = await this.request(pathname, init);
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new StorageError(`${this.label}: ${pathname} returned a non-JSON body`, { body: text.slice(0, 200) });
    }
  }

  listBuckets() {
    return this.json('/storage/v1/bucket');
  }

  async getBucket(bucket) {
    try {
      return await this.json(`/storage/v1/bucket/${encodeURIComponent(bucket)}`);
    } catch (error) {
      if (error instanceof StorageError && error.status === 404) return null;
      // storage-api answers 400 "Bucket not found" on some versions
      if (error instanceof StorageError && /not found/i.test(error.body || error.message)) return null;
      throw error;
    }
  }

  createBucket(config) {
    return this.json('/storage/v1/bucket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: config.id,
        name: config.name || config.id,
        public: Boolean(config.public),
        file_size_limit: config.file_size_limit ?? null,
        allowed_mime_types: config.allowed_mime_types ?? null,
      }),
    });
  }

  updateBucket(bucket, config) {
    return this.json(`/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: bucket,
        public: Boolean(config.public),
        file_size_limit: config.file_size_limit ?? null,
        allowed_mime_types: config.allowed_mime_types ?? null,
      }),
    });
  }

  listPage(bucket, prefix, limit, offset) {
    return this.json(`/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
  }

  /**
   * Every object in the bucket, walking folders depth-first.
   * Supabase marks folder rows with `id: null`; real objects always carry an id.
   *
   * Paging stops on an EMPTY page, not on a short one. storage-api is free to
   * return fewer rows than the requested limit; treating a short page as the
   * end silently under-enumerates the bucket, and an under-enumerated source
   * then "verifies" against an equally short target and reports PASS.
   */
  async listObjects(bucket, { pageSize, retries }) {
    const files = [];
    const placeholders = [];
    const seen = new Set();
    const stack = [{ prefix: '', depth: 0 }];
    while (stack.length) {
      const { prefix, depth } = stack.pop();
      if (depth > MAX_PREFIX_DEPTH) {
        throw new StorageError(`${this.label}: folder nesting deeper than ${MAX_PREFIX_DEPTH} under "${prefix}"`);
      }
      let offset = 0;
      for (let pageIndex = 0; ; pageIndex += 1) {
        if (pageIndex >= MAX_PAGES_PER_PREFIX) {
          throw new StorageError(
            `${this.label}: more than ${MAX_PAGES_PER_PREFIX} pages under ${bucket}/${prefix} — aborting rather than looping`
          );
        }
        const page = await withRetry(`list ${bucket}/${prefix}@${offset}`, retries, () =>
          this.listPage(bucket, prefix, pageSize, offset)
        );
        if (!Array.isArray(page)) {
          throw new StorageError(`${this.label}: unexpected list response for ${bucket}/${prefix}`);
        }
        if (page.length === 0) break;
        let fresh = 0;
        for (const entry of page) {
          const name = entry?.name;
          if (!name) continue;
          const fullPath = `${prefix}${name}`;
          const isFolder = entry.id === null || entry.id === undefined;
          const key = `${isFolder ? 'd' : 'f'}:${fullPath}`;
          if (seen.has(key)) continue;
          seen.add(key);
          fresh += 1;
          if (isFolder) {
            stack.push({ prefix: `${fullPath}/`, depth: depth + 1 });
            continue;
          }
          const record = {
            path: fullPath,
            size: Number(entry.metadata?.size ?? 0),
            mimetype: String(entry.metadata?.mimetype || ''),
            cacheControl: String(entry.metadata?.cacheControl || ''),
            etag: String(entry.metadata?.eTag || ''),
          };
          if (name === FOLDER_PLACEHOLDER) placeholders.push(record);
          else files.push(record);
        }
        if (fresh === 0) {
          throw new StorageError(
            `${this.label}: listing ${bucket}/${prefix} stopped advancing at offset ${offset} — ` +
              'every row on the page had already been seen, which means the list endpoint ignored `offset`. ' +
              'Re-run with a larger --page-size, or copy this bucket with the Supabase CLI instead.'
          );
        }
        offset += page.length;
      }
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { files, placeholders };
  }

  download(bucket, objectPath) {
    return this.request(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`);
  }

  publicObjectUrl(bucket, objectPath) {
    return `${this.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
  }

  async upload(bucket, objectPath, { body, contentType, cacheControl, upsert, streamed }) {
    return this.request(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
      method: 'POST',
      headers: {
        'content-type': contentType || 'application/octet-stream',
        'cache-control': cacheControl || 'max-age=3600',
        'x-upsert': upsert ? 'true' : 'false',
      },
      body,
      duplex: streamed ? 'half' : undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// ledger
// ---------------------------------------------------------------------------

function ledgerPath(bucket) {
  return path.join(STATE_DIR, `storage-${bucket}.json`);
}

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const ignore = path.join(STATE_DIR, '.gitignore');
  if (!fs.existsSync(ignore)) {
    fs.writeFileSync(ignore, '# migration ledgers hold customer file paths — keep them out of git\n*.json\n!.gitignore\n');
  }
}

function emptyLedger(bucket, source, target) {
  return {
    bucket,
    sourceRef: source.ref,
    targetRef: target ? target.ref : '',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    objects: {},
  };
}

function loadLedger(bucket, source, target, { fresh }) {
  const file = ledgerPath(bucket);
  if (!fs.existsSync(file)) return emptyLedger(bucket, source, target);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new StorageError(`ledger ${file} is not valid JSON (${error.message}) — fix it or pass --fresh-ledger`);
  }
  const sameTarget = !target || !parsed.targetRef || parsed.targetRef === target.ref;
  if (!sameTarget) {
    if (!fresh) {
      throw new StorageError(
        `ledger ${file} was written for target project "${parsed.targetRef}" but the target is now "${target.ref}". ` +
          `Re-run with --fresh-ledger (the old ledger is renamed, never deleted).`
      );
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(STATE_DIR, `storage-${bucket}.${parsed.targetRef || 'unknown'}.${stamp}.json`);
    fs.renameSync(file, backup);
    console.log(`   previous ledger kept at ${backup}`);
    return emptyLedger(bucket, source, target);
  }
  if (fresh) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(STATE_DIR, `storage-${bucket}.${stamp}.json`);
    fs.renameSync(file, backup);
    console.log(`   previous ledger kept at ${backup}`);
    return emptyLedger(bucket, source, target);
  }
  parsed.objects = parsed.objects && typeof parsed.objects === 'object' ? parsed.objects : {};
  parsed.bucket = bucket;
  parsed.sourceRef = parsed.sourceRef || source.ref;
  parsed.targetRef = target ? target.ref : parsed.targetRef || '';
  return parsed;
}

function saveLedger(ledger) {
  ensureStateDir();
  ledger.updatedAt = new Date().toISOString();
  ledger.doneCount = Object.keys(ledger.objects).length;
  const file = ledgerPath(ledger.bucket);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// bucket config comparison
// ---------------------------------------------------------------------------

function mimeList(value) {
  if (!Array.isArray(value)) return null;
  return [...value].map(String).sort();
}

function describeBucketConfig(config) {
  const limit = config.file_size_limit ?? null;
  const mimes = mimeList(config.allowed_mime_types);
  return [
    config.public ? 'public' : 'private',
    limit === null ? 'no size limit' : `size limit ${formatBytes(limit)}`,
    mimes === null ? 'any mime type' : `${mimes.length} mime type(s): ${mimes.join(', ')}`,
  ].join(' · ');
}

/**
 * Objects a bucket with this config would reject even though they sit happily
 * in the source: the limits can be tightened after an upload, and storage-api
 * only enforces them on the way in. Better to hear about it before cutover.
 */
function objectsBlockedByBucketLimits(files, config) {
  const limit = config.file_size_limit ?? null;
  const mimes = mimeList(config.allowed_mime_types);
  const blocked = [];
  for (const file of files) {
    if (limit !== null && file.size > limit) {
      blocked.push(`${file.path} — ${formatBytes(file.size)} exceeds the ${formatBytes(limit)} bucket limit`);
      continue;
    }
    if (mimes && file.mimetype && !mimes.includes(file.mimetype)) {
      blocked.push(`${file.path} — mime type ${file.mimetype} is not in the bucket's allowed list`);
    }
  }
  return blocked;
}

function bucketConfigDifferences(source, target) {
  const diffs = [];
  if (Boolean(source.public) !== Boolean(target.public)) {
    diffs.push(`public: source=${Boolean(source.public)} target=${Boolean(target.public)}`);
  }
  const sourceLimit = source.file_size_limit ?? null;
  const targetLimit = target.file_size_limit ?? null;
  if (sourceLimit !== targetLimit) {
    diffs.push(`file_size_limit: source=${sourceLimit ?? 'null'} target=${targetLimit ?? 'null'}`);
  }
  const sourceMimes = mimeList(source.allowed_mime_types);
  const targetMimes = mimeList(target.allowed_mime_types);
  if (JSON.stringify(sourceMimes) !== JSON.stringify(targetMimes)) {
    diffs.push(
      `allowed_mime_types: source=${sourceMimes ? sourceMimes.join('|') : 'null'} target=${targetMimes ? targetMimes.join('|') : 'null'}`
    );
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// copy one object
// ---------------------------------------------------------------------------

async function copyObject(source, target, bucket, object, opts) {
  // A streamed attempt that fails must be retried buffered, whatever the HTTP
  // status was: a chunked upload rejected with a 4xx is exactly the case the
  // buffered path exists for, and 4xx is otherwise treated as fatal.
  let forceBuffer = false;
  return withRetry(`${bucket}/${object.path}`, opts.retries, async (attempt) => {
    const streamed =
      !forceBuffer && attempt === 1 && opts.streamThreshold > 0 && object.size > opts.streamThreshold;
    const response = await source.download(bucket, object.path);
    const contentType = object.mimetype || response.headers.get('content-type') || 'application/octet-stream';
    const cacheControl = normalizeCacheControl(object.cacheControl);
    let body;
    if (streamed) {
      const advertised = Number(response.headers.get('content-length'));
      if (object.size && Number.isFinite(advertised) && advertised > 0 && advertised !== object.size) {
        await response.body?.cancel().catch(() => {});
        throw new StorageError(
          `${bucket}/${object.path}: source served ${advertised} bytes but the listing says ${object.size}`,
          { retryable: true }
        );
      }
      body = response.body;
    } else {
      body = Buffer.from(await response.arrayBuffer());
      if (object.size && body.length !== object.size) {
        throw new StorageError(
          `${bucket}/${object.path}: downloaded ${body.length} bytes but the source listing says ${object.size}`,
          { retryable: true }
        );
      }
    }
    try {
      await target.upload(bucket, object.path, {
        body,
        contentType,
        cacheControl,
        upsert: Boolean(opts.upsert),
        streamed,
      });
    } catch (error) {
      if (streamed) {
        forceBuffer = true;
        if (response.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
        if (error instanceof StorageError) error.retryable = true;
      }
      throw error;
    }
    return { streamed, bytes: object.size };
  });
}

// ---------------------------------------------------------------------------
// public reachability probe (read-only, no auth header)
// ---------------------------------------------------------------------------

/**
 * pricelist.image and form_templates.cover_image are plain <img src> URLs into
 * the public bucket. A copied object that is not reachable WITHOUT a key means
 * broken catalog photos, and neither the object count nor the byte total would
 * show it.
 */
async function probePublicObject(project, bucket, objectPath) {
  const url = project.publicObjectUrl(bucket, objectPath);
  try {
    const response = await fetch(url, { headers: { range: 'bytes=0-0' } });
    await response.body?.cancel().catch(() => {});
    return { ok: response.status === 200 || response.status === 206, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// per-bucket work
// ---------------------------------------------------------------------------

async function handleBucket(bucket, source, target, opts) {
  const result = {
    bucket,
    status: 'PENDING',
    sourcePublic: false,
    targetPublic: null,
    sourceCount: 0,
    sourceBytes: 0,
    targetCount: 0,
    targetBytes: 0,
    copied: 0,
    copiedBytes: 0,
    skipped: 0,
    failed: 0,
    extra: 0,
    notes: [],
  };

  console.log('');
  console.log(`── bucket: ${bucket} ${'─'.repeat(Math.max(0, 56 - bucket.length))}`);

  const sourceConfig = await source.getBucket(bucket);
  if (!sourceConfig) {
    result.status = 'FAIL';
    result.notes.push('bucket does not exist in the source project');
    console.log(`   ERROR: bucket "${bucket}" does not exist in the source project.`);
    return result;
  }
  result.sourcePublic = Boolean(sourceConfig.public);
  console.log(`   source config : ${describeBucketConfig(sourceConfig)}`);

  // Load the ledger before doing any listing work: an incompatible ledger must
  // stop the bucket immediately, not after a full enumeration. --verify-only
  // and --inventory never touch it.
  const useLedger = !opts.inventory && !opts.verifyOnly;
  const ledger = useLedger ? loadLedger(bucket, source, target, { fresh: opts.freshLedger }) : null;
  if (ledger) {
    const known = Object.keys(ledger.objects).length;
    if (known) console.log(`   ledger        : ${known} object(s) already recorded as copied`);
  }

  console.log('   enumerating source objects...');
  const sourceList = await source.listObjects(bucket, { pageSize: opts.pageSize, retries: opts.retries });
  const sourceFiles = sourceList.files;
  const sourcePaths = new Set(sourceFiles.map((item) => item.path));
  result.sourceCount = sourceFiles.length;
  result.sourceBytes = sourceFiles.reduce((sum, item) => sum + item.size, 0);
  console.log(
    `   source        : ${result.sourceCount} object(s), ${formatBytes(result.sourceBytes)}` +
      (sourceList.placeholders.length
        ? ` (+${sourceList.placeholders.length} empty-folder placeholder(s), not copied)`
        : '')
  );

  const reportBlocked = (config, whose) => {
    const blocked = objectsBlockedByBucketLimits(sourceFiles, config);
    if (!blocked.length) return;
    result.notes.push(`${blocked.length} object(s) violate the ${whose} bucket limits and will be rejected on upload`);
    console.log(`   WARNING       : ${blocked.length} object(s) would be rejected by the ${whose} bucket config:`);
    for (const item of blocked.slice(0, 5)) console.log(`      ${item}`);
    if (blocked.length > 5) console.log(`      ...and ${blocked.length - 5} more`);
    console.log('      (raise file_size_limit / allowed_mime_types on the TARGET bucket to let them through)');
  };
  reportBlocked(sourceConfig, 'source');

  if (opts.inventory) {
    result.status = 'INVENTORY';
    return result;
  }

  // --- target bucket ------------------------------------------------------
  let targetConfig = await target.getBucket(bucket);
  if (!targetConfig) {
    console.log(`   target        : bucket "${bucket}" does not exist yet`);
    console.log(`   would create  : ${describeBucketConfig(sourceConfig)}`);
    if (!opts.confirm || opts.verifyOnly) {
      result.status = opts.verifyOnly ? 'FAIL' : 'DRY-RUN';
      result.notes.push('target bucket missing');
      if (!opts.verifyOnly) console.log('   DRY RUN: bucket not created (pass --confirm)');
      return result;
    }
    await withRetry(`create bucket ${bucket}`, opts.retries, () =>
      target.createBucket({
        id: bucket,
        name: sourceConfig.name || bucket,
        public: sourceConfig.public,
        file_size_limit: sourceConfig.file_size_limit ?? null,
        allowed_mime_types: sourceConfig.allowed_mime_types ?? null,
      })
    );
    targetConfig = await target.getBucket(bucket);
    console.log(`   created       : ${describeBucketConfig(targetConfig || sourceConfig)}`);
  } else {
    const diffs = bucketConfigDifferences(sourceConfig, targetConfig);
    if (diffs.length === 0) {
      console.log(`   target config : matches source (${describeBucketConfig(targetConfig)})`);
    } else {
      console.log(`   target config : DIFFERS from source — ${diffs.join(' | ')}`);
      if (opts.fixBucketConfig && opts.confirm && !opts.verifyOnly) {
        await withRetry(`update bucket ${bucket}`, opts.retries, () =>
          target.updateBucket(bucket, {
            public: sourceConfig.public,
            file_size_limit: sourceConfig.file_size_limit ?? null,
            allowed_mime_types: sourceConfig.allowed_mime_types ?? null,
          })
        );
        targetConfig = await target.getBucket(bucket);
        console.log(`   target config : updated to ${describeBucketConfig(targetConfig || sourceConfig)}`);
      } else {
        result.notes.push(`bucket config differs (${diffs.length} field(s))`);
        console.log('   (pass --fix-bucket-config --confirm to align it)');
      }
    }
    // The target's own limits are what will actually reject an upload.
    if (targetConfig && bucketConfigDifferences(sourceConfig, targetConfig).length) {
      reportBlocked(targetConfig, 'target');
    }
  }
  if (targetConfig) result.targetPublic = Boolean(targetConfig.public);

  console.log('   enumerating target objects...');
  const targetList = await target.listObjects(bucket, { pageSize: opts.pageSize, retries: opts.retries });
  const targetSizes = new Map(targetList.files.map((item) => [item.path, item.size]));
  console.log(
    `   target        : ${targetList.files.length} object(s), ` +
      `${formatBytes(targetList.files.reduce((sum, item) => sum + item.size, 0))}`
  );

  // --- diff ---------------------------------------------------------------
  const pending = [];
  for (const object of sourceFiles) {
    const inTarget = targetSizes.has(object.path) && targetSizes.get(object.path) === object.size;
    const ledgerEntry = ledger ? ledger.objects[object.path] : null;
    const inLedger = Boolean(ledgerEntry) && ledgerEntry.size === object.size;
    if (inTarget || inLedger) {
      result.skipped += 1;
      if (ledger && inTarget && !inLedger) {
        ledger.objects[object.path] = {
          size: object.size,
          etag: object.etag,
          copiedAt: new Date().toISOString(),
          verified: 'present-in-target',
        };
      }
      continue;
    }
    pending.push(object);
  }
  const pendingBytes = pending.reduce((sum, item) => sum + item.size, 0);
  console.log(
    `   to copy       : ${pending.length} object(s), ${formatBytes(pendingBytes)} ` +
      `(${result.skipped} already present/ledgered)`
  );

  if (opts.verifyOnly) {
    // fall through to verification without writing anything
  } else if (!opts.confirm) {
    result.status = 'DRY-RUN';
    console.log('   DRY RUN: nothing uploaded (pass --confirm)');
    return result;
  } else if (pending.length) {
    saveLedger(ledger);
    const started = Date.now();
    let done = 0;
    let lastFlush = Date.now();
    const failures = [];

    await runPool(pending, opts.concurrency, async (object) => {
      try {
        const outcome = await copyObject(source, target, bucket, object, {
          retries: opts.retries,
          streamThreshold: opts.streamThreshold,
          upsert: true,
        });
        result.copied += 1;
        result.copiedBytes += object.size;
        ledger.objects[object.path] = {
          size: object.size,
          etag: object.etag,
          mimetype: object.mimetype,
          copiedAt: new Date().toISOString(),
          mode: outcome.streamed ? 'stream' : 'buffer',
        };
        if (opts.verbose) {
          console.log(`      ok  ${object.path} (${formatBytes(object.size)}${outcome.streamed ? ', streamed' : ''})`);
        }
      } catch (error) {
        result.failed += 1;
        failures.push({ path: object.path, message: error.message });
        console.log(`      FAILED ${object.path} — ${error.message}`);
      }
      done += 1;
      if (!opts.verbose && (done % 25 === 0 || done === pending.length)) {
        console.log(`      progress ${done}/${pending.length}`);
      }
      if (Date.now() - lastFlush > 5000) {
        lastFlush = Date.now();
        saveLedger(ledger);
      }
    });

    saveLedger(ledger);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `   copied        : ${result.copied} object(s), ${formatBytes(result.copiedBytes)} in ${seconds}s` +
        (result.failed ? ` — ${result.failed} FAILED` : '')
    );
    if (failures.length) {
      result.notes.push(`${failures.length} object(s) failed to copy`);
    }
  } else {
    saveLedger(ledger);
    console.log('   copied        : nothing to do, target already holds every source object');
  }

  // --- verification -------------------------------------------------------
  console.log('   verifying...');
  const finalTarget = await target.listObjects(bucket, { pageSize: opts.pageSize, retries: opts.retries });
  const finalSizes = new Map(finalTarget.files.map((item) => [item.path, item.size]));
  result.targetCount = finalTarget.files.length;
  result.targetBytes = finalTarget.files.reduce((sum, item) => sum + item.size, 0);

  const missing = [];
  const wrongSize = [];
  for (const object of sourceFiles) {
    if (!finalSizes.has(object.path)) missing.push(object.path);
    else if (finalSizes.get(object.path) !== object.size) {
      wrongSize.push(`${object.path} (source ${object.size}B, target ${finalSizes.get(object.path)}B)`);
    }
  }
  const extra = finalTarget.files.filter((item) => !sourcePaths.has(item.path)).map((item) => item.path);
  result.extra = extra.length;

  // Every source object present at the right size is the bar. Extra objects in
  // the target are reported, never deleted, and do not fail the bucket — they
  // would otherwise make the count and byte totals disagree forever.
  let pass = missing.length === 0 && wrongSize.length === 0;

  if (missing.length) {
    result.notes.push(`${missing.length} missing in target`);
    console.log(`      ${missing.length} object(s) missing in the target`);
    if (opts.verbose) {
      for (const item of missing.slice(0, 10)) console.log(`      missing: ${item}`);
      if (missing.length > 10) console.log(`      ...and ${missing.length - 10} more`);
    } else {
      console.log('      (re-run with --verbose to list them; the paths hold customer identifiers)');
    }
  }
  if (wrongSize.length) {
    result.notes.push(`${wrongSize.length} size mismatch`);
    console.log(`      ${wrongSize.length} object(s) differ in size`);
    if (opts.verbose) {
      for (const item of wrongSize.slice(0, 10)) console.log(`      size mismatch: ${item}`);
      if (wrongSize.length > 10) console.log(`      ...and ${wrongSize.length - 10} more`);
    }
  }
  if (extra.length) {
    result.notes.push(`${extra.length} extra object(s) in target (left untouched, not a failure)`);
    console.log(`      ${extra.length} object(s) exist only in the target — left untouched`);
  }
  if (result.sourceCount !== result.targetCount || result.sourceBytes !== result.targetBytes) {
    console.log(
      `      totals differ: source ${result.sourceCount}/${formatBytes(result.sourceBytes)} vs ` +
        `target ${result.targetCount}/${formatBytes(result.targetBytes)}` +
        (extra.length ? ' (accounted for by the extra target objects above)' : '')
    );
  }

  // Public buckets: prove one object is readable with no key at all. Driven by
  // the SOURCE flag, so a target bucket that came out private fails here rather
  // than passing with a config-diff note nobody reads.
  if (pass && result.sourcePublic && sourceFiles.length) {
    const sample = sourceFiles[0];
    const probe = await probePublicObject(target, bucket, sample.path);
    if (probe.ok) {
      console.log(`   public read   : OK (unauthenticated GET returned HTTP ${probe.status})`);
    } else {
      pass = false;
      result.notes.push(
        `public read failed (HTTP ${probe.status}${probe.error ? `, ${probe.error}` : ''}) — <img src> URLs will 400`
      );
      console.log(
        `   public read   : FAILED — unauthenticated GET returned HTTP ${probe.status}${probe.error ? ` (${probe.error})` : ''}`
      );
    }
  }

  result.status = pass ? 'PASS' : 'FAIL';
  console.log(
    `   [${result.status}] ${bucket}: source ${result.sourceCount} obj / ${formatBytes(result.sourceBytes)} · ` +
      `target ${result.targetCount} obj / ${formatBytes(result.targetBytes)}`
  );
  return result;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function printHelp() {
  const text = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const header = text.slice(0, text.indexOf(' */') + 3);
  console.log(header.replace(/^\/\*\*?|^ \* ?|^ \*\/?/gm, ''));
}

function writeReport(results, source, target, opts) {
  // Counts and sizes only — no object paths, so this file is safe to paste into
  // the cutover log.
  const report = {
    script: '03-copy-storage',
    finishedAt: new Date().toISOString(),
    mode: opts.inventory ? 'inventory' : opts.verifyOnly ? 'verify-only' : opts.confirm ? 'copy' : 'dry-run',
    sourceRef: source.ref,
    targetRef: target ? target.ref : '',
    buckets: results.map((item) => ({
      bucket: item.bucket,
      status: item.status,
      sourcePublic: item.sourcePublic,
      targetPublic: item.targetPublic,
      sourceCount: item.sourceCount,
      sourceBytes: item.sourceBytes,
      targetCount: item.targetCount,
      targetBytes: item.targetBytes,
      copied: item.copied,
      skipped: item.skipped,
      failed: item.failed,
      extraInTarget: item.extra,
      notes: item.notes,
    })),
  };
  const file = path.join(STATE_DIR, 'storage-report.json');
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.confirm && opts.verifyOnly) {
    console.error('--confirm and --verify-only are mutually exclusive.');
    return 2;
  }
  if (opts.inventory && (opts.confirm || opts.verifyOnly)) {
    console.error('--inventory only reads the source project; drop --confirm / --verify-only.');
    return 2;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 20) {
    console.error(`Node 20+ required (found ${process.versions.node}).`);
    return 2;
  }

  console.log('== 03-copy-storage: copy Supabase Storage buckets to the new project ==');
  const envFile = loadEnv(opts.envFile);
  if (envFile) console.log(`config file   : ${envFile}`);
  else console.log('config file   : none found (relying on the process environment)');

  const sourceUrl = process.env.SUPABASE_URL || '';
  const sourceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!sourceUrl || !sourceKey) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source project). Add them to server/.env.');
    return 2;
  }
  const source = new StorageProject('source', sourceUrl, sourceKey);
  if (!looksLikeServiceRoleKey(sourceKey)) {
    console.error('SUPABASE_SERVICE_ROLE_KEY does not look like a service_role key — private buckets would list empty.');
    return 2;
  }

  let target = null;
  let targetKey = '';
  if (!opts.inventory) {
    const targetUrl = process.env.NEW_SUPABASE_URL || '';
    targetKey = process.env.NEW_SUPABASE_SERVICE_ROLE_KEY || process.env.NEW_SUPABASE_SERVICE_KEY || '';
    if (!targetUrl || !targetKey) {
      console.error('');
      console.error('Missing target project credentials.');
      console.error('Add these two lines to server/.env (values from the NEW Frankfurt project,');
      console.error('Supabase dashboard → Project Settings → API), then run again:');
      console.error('  NEW_SUPABASE_URL=https://<new-ref>.supabase.co');
      console.error('  NEW_SUPABASE_SERVICE_ROLE_KEY=<new service_role key>');
      console.error('(or run with --inventory to survey the source project only)');
      return 2;
    }
    target = new StorageProject('target', targetUrl, targetKey);
    if (!target.ref) {
      console.error(`Refusing to run: NEW_SUPABASE_URL is not a URL we can read a project ref from (${targetUrl}).`);
      return 2;
    }
    if (target.ref === source.ref) {
      console.error(`Refusing to run: NEW_SUPABASE_URL points at the same project ref as SUPABASE_URL (${source.ref}).`);
      return 2;
    }
    if (target.ref === OLD_PROJECT_REF) {
      console.error(
        `Refusing to run: the target ref is ${OLD_PROJECT_REF}, the project being migrated AWAY from. ` +
          'Copying into it would upsert over live customer documents.'
      );
      return 2;
    }
    if (!looksLikeServiceRoleKey(targetKey)) {
      console.error('NEW_SUPABASE_SERVICE_ROLE_KEY does not look like a service_role key — uploads would be denied by RLS.');
      return 2;
    }
  }

  if (source.ref !== OLD_PROJECT_REF) {
    console.log(`WARNING       : source ref is ${source.ref}, not the expected ${OLD_PROJECT_REF}. Check SUPABASE_URL.`);
  }
  console.log(`source        : ${source.url}  (ref ${source.ref}) · service key ${keyFingerprint(sourceKey)}`);
  if (target) {
    console.log(`target        : ${target.url}  (ref ${target.ref}) · service key ${keyFingerprint(targetKey)}`);
  }

  let buckets = opts.buckets.length ? opts.buckets : DEFAULT_BUCKETS;
  if (opts.allBuckets) {
    if (opts.buckets.length) console.log('note          : --all-buckets overrides --bucket=');
    const all = await source.listBuckets();
    buckets = (Array.isArray(all) ? all : []).map((b) => b.id || b.name).filter(Boolean);
    if (!buckets.length) {
      console.error('The source project reports no buckets at all — check the service_role key.');
      return 2;
    }
  }

  // Pre-flight: prove the target credentials work before enumerating 100k objects.
  if (target) {
    try {
      const targetBuckets = await target.listBuckets();
      console.log(
        `target preflight: ${Array.isArray(targetBuckets) ? targetBuckets.length : 0} bucket(s) already in the target project`
      );
    } catch (error) {
      console.error(`Target credentials rejected by the Storage API: ${error.message}`);
      return 2;
    }
  }

  const mode = opts.inventory
    ? 'INVENTORY (source only, no writes)'
    : opts.verifyOnly
      ? 'VERIFY ONLY (no writes, ledger untouched)'
      : opts.confirm
        ? 'COPY (writes to the target project)'
        : 'DRY RUN (no writes — pass --confirm to copy)';
  console.log(`mode          : ${mode}`);
  console.log(`buckets       : ${buckets.join(', ')}`);
  console.log(
    `settings      : concurrency ${opts.concurrency} · page size ${opts.pageSize} · retries ${opts.retries} · ` +
      (opts.streamThreshold > 0 ? `stream above ${formatBytes(opts.streamThreshold)}` : 'streaming off (all objects buffered)')
  );
  console.log('nothing is ever deleted, in either project.');

  ensureStateDir();

  const results = [];
  for (const bucket of buckets) {
    try {
      results.push(await handleBucket(bucket, source, target, opts));
    } catch (error) {
      console.log(`   ERROR on bucket ${bucket}: ${error.message}`);
      results.push({
        bucket,
        status: 'FAIL',
        sourcePublic: false,
        targetPublic: null,
        sourceCount: 0,
        sourceBytes: 0,
        targetCount: 0,
        targetBytes: 0,
        copied: 0,
        copiedBytes: 0,
        skipped: 0,
        failed: 0,
        extra: 0,
        notes: [error.message],
      });
    }
  }

  console.log('');
  console.log('== summary ==');
  let worst = 0;
  for (const item of results) {
    const line =
      `[${item.status}] ${item.bucket.padEnd(20)} ` +
      `source ${String(item.sourceCount).padStart(6)} obj / ${formatBytes(item.sourceBytes).padStart(9)}` +
      (opts.inventory
        ? ''
        : ` · target ${String(item.targetCount).padStart(6)} obj / ${formatBytes(item.targetBytes).padStart(9)}` +
          ` · copied ${item.copied} · skipped ${item.skipped}` +
          (item.failed ? ` · failed ${item.failed}` : ''));
    console.log(line);
    for (const note of item.notes) console.log(`         note: ${note}`);
    if (item.status === 'FAIL') worst = 1;
  }

  const reportFile = writeReport(results, source, target, opts);
  console.log(`report        : ${reportFile}`);

  if (opts.inventory) {
    console.log('');
    console.log('Inventory only. Re-run without --inventory (and with --confirm) to copy.');
  } else if (!opts.confirm && !opts.verifyOnly) {
    console.log('');
    console.log('DRY RUN complete — nothing was written to the target. Re-run with --confirm to copy.');
  } else if (worst === 0) {
    console.log('');
    console.log('All buckets verified: every source object is present in the target at the same byte size.');
    console.log('Sizes are compared, not content hashes — see the WHAT "VERIFIED" MEANS HERE note at the top of this file.');
    console.log(`Ledgers: ${STATE_DIR}`);
  }
  return worst;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('');
    console.error(`FATAL: ${error?.message || error}`);
    process.exitCode = 1;
  });
