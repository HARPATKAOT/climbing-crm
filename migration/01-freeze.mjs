#!/usr/bin/env node
/**
 * migration/01-freeze.mjs — PRE-CUTOVER FREEZE (step 1 of the Supabase region move)
 *
 * WHY THIS EXISTS
 *   The Supabase project moves ap-northeast-2 (Seoul) -> eu-central-1 (Frankfurt).
 *   Supabase cannot move a region in place, so a NEW project is created and the
 *   old one is restored into it. Anything written to the OLD project after the
 *   dump is taken is lost at cutover. This script stops every writer.
 *
 * WHAT ACTUALLY WRITES TO THE OLD PROJECT (verified in this repo, not guessed)
 *   1. The Render web service `climbing-crm-api`. Every CRM write goes through
 *      it: the Vercel client only uses Supabase for auth (client/src/authClient.js
 *      is the single createClient call in the whole client), all data flows
 *      through the API.
 *   2. The API's own in-process schedulers. server/index.js starts them inside
 *      app.listen() when scheduledJobsEnabled() is true (server/runtimeSafety.js
 *      -> NODE_ENV=production, or any RENDER_ variable set): WhatsApp bot follow-ups, the
 *      abandoned-reply sweep, registration lifecycle sends, participation and
 *      health-expiry reminders, shift reminders, the daily attendance ensure,
 *      the pending-message retry and the keep-alive self-ping. Suspending the
 *      web service kills all of them in one move — there is no separate worker.
 *   3. Inbound webhooks that Meta / iCount / Google push at the API:
 *      POST /api/whatsapp/webhook, POST /api/instagram/webhook,
 *      POST /api/icount/webhook, and the CRON_SECRET-guarded sync-due routes
 *      plus /api/attendance/ensure-today.
 *   4. Render cron jobs declared in render.yaml. They do not write directly —
 *      each one just POSTs to the API over HTTP — so a suspended web service
 *      already neutralises them. We suspend them anyway to avoid a cutover
 *      window full of red cron failures, and we find their ids by NAME through
 *      the Render API. We never guess an id.
 *      NOTE, observed live: none of the three currently exists as a Render
 *      service. render.yaml declares them but the blueprint was never applied
 *      for the cron entries, so those jobs run ONLY as in-process timers inside
 *      the web service. The script reports each as NOT FOUND rather than
 *      inventing an id, and suspending the web service is what stops them.
 *   5. THE ONE THIS SCRIPT CANNOT SUSPEND: a LOCAL server on the operator's own
 *      machine. ecosystem.config.cjs defines a pm2 app `crm-api` that runs
 *      server/index.js from server/.env — the same SUPABASE_URL and the same
 *      service_role key as production. NODE_ENV=development there, so
 *      scheduledJobsEnabled() (server/runtimeSafety.js) is false and its timers
 *      stay off, but every route it serves still writes to the OLD project.
 *      Render has no authority over it. This script PROBES localhost and
 *      refuses to declare a freeze while it answers; stopping it is a manual
 *      step (`pm2 stop crm-api`, or `pm2 delete crm-api`).
 *
 * WHAT DOES NOT NEED FREEZING (checked, not assumed)
 *   - The Vercel client. client/src/authClient.js holds the only createClient()
 *     call in the whole client and it is used for auth alone; no client code
 *     touches Supabase data or storage directly. With the API down the client
 *     cannot write.
 *   - Supabase-side schedulers. There is no supabase/functions directory and no
 *     pg_cron reference anywhere in the repo.
 *
 * THE "ALREADY SENT" HAZARD THIS PREVENTS
 *   The scheduler's durable "already sent" markers live in kv_collections. If the
 *   API keeps running and keeps writing markers after the dump is taken, those
 *   markers are lost at cutover and the WhatsApp bot re-messages real customers
 *   on the new project. Freeze first, dump second. Always.
 *
 * SAFETY
 *   - Without --confirm this prints the plan and changes NOTHING.
 *   - It never deletes anything, never touches Supabase, never touches Vercel.
 *   - It never prints a secret value. It DOES read secret values into memory:
 *     the Render env-var API returns them, and they are used only to compute
 *     booleans and one-way digests. Nothing derived is reversible.
 *   - Everything it suspends is recorded to migration/state/01-freeze.json so
 *     that migration/01-unfreeze.mjs can perform the exact inverse.
 *
 * WHAT "VERIFIED" MEANS HERE, EXACTLY
 *   A quiet health endpoint alone is NOT proof: the operator's own laptop
 *   losing DNS for ten seconds looks identical to a suspended service, and
 *   declaring a freeze that never happened is how the dump ends up stale. This
 *   script calls a freeze verified only when ALL of these hold:
 *     a. every targeted Render service reports suspended='suspended' when
 *        re-read from the Render API after the suspend call;
 *     b. the public health URL stops answering twice in a row;
 *     c. the health URL was observed ANSWERING at least once (before or during
 *        this run), so we know the probe path itself works;
 *     d. no local server answers on localhost.
 *   If (c) cannot be established the run still reports the freeze, but marks it
 *   `probePathUnproven` and says so out loud.
 *
 * USAGE
 *   node migration/01-freeze.mjs                 # plan only, no changes
 *   node migration/01-freeze.mjs --confirm       # actually suspend + verify
 *
 * FLAGS
 *   --confirm             Perform the suspends. Without it: plan only.
 *   --env-file <path>     Explicit .env (default: server/.env, see resolveEnvFile).
 *   --service-id <id>     Render web service id (default: RENDER_SERVICE_ID, else
 *                         the id inside RENDER_DEPLOY_HOOK, else lookup by name).
 *   --health-url <url>    Override the health endpoint that proves the freeze.
 *   --timeout-sec <n>     How long to wait for the API to stop answering (default 300).
 *   --poll-sec <n>        Seconds between health probes (default 5).
 *   --local-port <n>      Port to probe for a local server (default PORT from .env, else 5000).
 *   --skip-local-check    Do not probe localhost. You are asserting no local server runs.
 *                         NOTE: this is the only condition that hard-blocks a
 *                         freeze, so passing it removes the last automatic guard.
 *   --abort-sec <n>       Countdown before the suspend; Ctrl+C aborts (default 10).
 *   --yes                 Skip the countdown. For genuinely unattended runs only.
 *   --force               Proceed even if a previous freeze was never unfrozen.
 *                         Unresumed entries are carried into the new state file so
 *                         01-unfreeze can still resume them.
 *   --skip-crons          Do not touch cron jobs (web service only).
 *   --allow-unpinned-signing-key
 *                         Freeze even though the cutover would move the HMAC
 *                         signing key. Read the signing-key section first.
 *   --help
 *
 * THE SIGNING-KEY GATE, AND WHAT IT DOES *NOT* CLAIM
 *   server/signatureEvidence.js, server/otpService.js and
 *   server/mailingPreferences.js all derive their HMAC key from the same chain:
 *     EVIDENCE_SIGNING_SECRET || OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY
 *     || META_WA_ACCESS_TOKEN
 *   This script blocks the freeze on exactly one condition: the service_role key
 *   is what wins that chain, because then the new project's regenerated key
 *   silently invalidates every seal and unsubscribe link. Anything else winning
 *   the chain is untouched by a region move, so it does not block — even when the
 *   value looks wrong. A key that does not match the service_role key may well
 *   mean older seals stopped verifying at some earlier point, but that is a
 *   pre-existing condition this migration neither causes nor repairs, and
 *   stopping a cutover at 2am over it would be the wrong call. It is reported
 *   loudly and left as a decision for daylight.
 *
 * EXIT CODES
 *   0 plan printed, or freeze completed and verified
 *   1 configuration / precondition error (nothing was changed)
 *   2 at least one suspend call failed
 *   3 suspends succeeded but the freeze could not be verified
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ── Constants pinned by the operation brief ─────────────────────────────────
/**
 * Last-resort service id. It is NOT guessed: it is the id embedded in the
 * RENDER_DEPLOY_HOOK found in server/.env. resolveServiceId() prefers the live
 * environment over this constant, and the name check below is what actually
 * authorises any action — an id alone never is.
 */
const FALLBACK_API_SERVICE_ID = 'srv-d9bnidbtqb8s73d1mb2g';
const API_SERVICE_NAME = 'climbing-crm-api';
const RENDER_API = 'https://api.render.com/v1';
const FALLBACK_API_ORIGIN = 'https://climbing-crm-api.onrender.com';
const HEALTH_PATH = '/api/health';
const OLD_PROJECT_REF = 'xaxykjvqqhrodmseqleu';
const DEFAULT_LOCAL_PORT = 5000; // server/index.js:698 — process.env.PORT || 5000

/** Declared in render.yaml. Looked up by name at runtime — ids are never guessed. */
const EXPECTED_CRONS = [
  {
    name: 'climbing-crm-finance-sync',
    schedule: '*/15 * * * *',
    calls: 'POST /api/finance/sync-scheduled (iCount finance sync, every 15 min)',
  },
  {
    name: 'climbing-crm-attendance-ensure',
    schedule: '0 3 * * *',
    calls: 'POST /api/attendance/ensure-today (daily 03:00 UTC = 06:00 Asia/Jerusalem)',
  },
  {
    name: 'climbing-crm-contacts-sync',
    schedule: '*/30 * * * *',
    calls: 'POST /api/google-contacts/sync-due (every 30 min)',
  },
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const STATE_DIR = path.join(HERE, 'state');
const STATE_FILE = path.join(STATE_DIR, '01-freeze.json');
const HISTORY_DIR = path.join(STATE_DIR, 'history');

// ── Tiny CLI parser ─────────────────────────────────────────────────────────
/**
 * Boolean flags are declared, not inferred. Inferring them from "is the next
 * token another --flag?" means `--confirm somefile` silently swallows the next
 * token and `--confirm` never registers — on a script whose whole safety model
 * is that flag, that is not an acceptable failure mode.
 */
const BOOLEAN_FLAGS = new Set([
  'confirm', 'force', 'skip-crons', 'skip-local-check',
  'allow-unpinned-signing-key', 'yes', 'help', 'h',
]);
const VALUE_OPTS = new Set([
  'env-file', 'service-id', 'health-url', 'timeout-sec', 'poll-sec', 'local-port',
  'abort-sec',
]);

function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      unknown.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq > -1 ? arg.slice(2, eq) : arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags.add(key);
      continue;
    }
    if (!VALUE_OPTS.has(key)) {
      unknown.push(arg);
      continue;
    }
    if (eq > -1) {
      opts[key] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      unknown.push(`${arg} (missing value)`);
      continue;
    }
    opts[key] = next;
    i += 1;
  }
  return { flags, opts, unknown };
}

// ── .env loading (no npm dependency; process.env always wins, like dotenv) ──
/**
 * The worktree checkout does not carry server/.env — only server/.env.example.
 * The real file lives in the main checkout, so a worktree resolves it through
 * its own .git pointer file instead of failing.
 */
function resolveEnvFile(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (process.env.MIGRATION_ENV_FILE) candidates.push(path.resolve(process.env.MIGRATION_ENV_FILE));
  candidates.push(path.join(REPO_ROOT, 'server', '.env'));

  const gitPointer = path.join(REPO_ROOT, '.git');
  try {
    if (fs.statSync(gitPointer).isFile()) {
      const raw = fs.readFileSync(gitPointer, 'utf8').trim();
      const match = raw.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        const gitDir = match[1].trim().replace(/\\/g, '/');
        // .../<mainRoot>/.git/worktrees/<name>  ->  <mainRoot>
        const wt = gitDir.match(/^(.*)\/\.git\/worktrees\/[^/]+\/?$/);
        if (wt) candidates.push(path.join(wt[1], 'server', '.env'));
      }
    }
  } catch {
    /* no .git pointer — fine */
  }

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function loadEnvFile(file) {
  const loaded = [];
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.replace(/^export\s+/, '').match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}

// ── Render API client (read + suspend only; nothing here can delete) ────────
function makeRenderClient(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  async function request(method, urlPath, { attempts = 3 } = {}) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const res = await fetch(`${RENDER_API}${urlPath}`, { method, headers });
        const text = await res.text();
        let json = null;
        if (text) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
        if (res.status === 429 || res.status >= 500) {
          lastError = new Error(`Render API ${method} ${urlPath} -> HTTP ${res.status}`);
          if (attempt < attempts) {
            await sleep(1500 * attempt);
            continue;
          }
        }
        return { ok: res.ok, status: res.status, json, text: text.slice(0, 400) };
      } catch (err) {
        lastError = err;
        if (attempt < attempts) await sleep(1500 * attempt);
      }
    }
    throw lastError || new Error(`Render API ${method} ${urlPath} failed`);
  }

  return {
    get: (p) => request('GET', p),
    post: (p) => request('POST', p),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Presence-only inspection of the live service environment.
 * The response body carries secret VALUES. They are used here to compute
 * booleans and a one-way fingerprint, and are never printed, logged or stored.
 *
 * BLIND SPOT, STATED: this endpoint returns only variables set ON the service.
 * Variables injected from a linked environment group are NOT in this list, so a
 * key that looks unset here may in fact be set. We therefore also ask which env
 * groups are linked, and downgrade every conclusion below if there are any.
 */
async function inspectEnv(render, serviceId) {
  const res = await render.get(`/services/${serviceId}/env-vars?limit=100`);
  if (!res.ok) return { available: false, reason: `HTTP ${res.status}` };
  const rows = Array.isArray(res.json) ? res.json : [];
  const map = new Map();
  for (const row of rows) {
    const item = row.envVar || row;
    if (item && item.key) map.set(item.key, item.value);
  }
  let envGroups = [];
  let envGroupsKnown = false;
  try {
    const groupRes = await render.get(`/services/${serviceId}/env-groups`);
    if (groupRes.ok) {
      envGroupsKnown = true;
      const groupRows = Array.isArray(groupRes.json) ? groupRes.json : [];
      envGroups = groupRows
        .map((row) => row.envGroup || row)
        .map((group) => (group && group.name) || (group && group.id))
        .filter(Boolean);
    }
  } catch {
    /* env-group visibility is a bonus, not a requirement */
  }
  return { available: true, map, envGroups, envGroupsKnown };
}

/**
 * Mirrors evidenceKey() in server/signatureEvidence.js — and the identical
 * chains in server/otpService.js and server/mailingPreferences.js:
 *   EVIDENCE_SIGNING_SECRET || OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY || META_WA_ACCESS_TOKEN
 * Whatever wins that chain IS the HMAC key behind every signature_evidence seal
 * (minors' health declarations, liability waivers) and every mailing-preference
 * / unsubscribe link. If its value changes, all of them stop verifying —
 * silently, with no error anywhere.
 *
 * The fingerprint is a one-way digest recorded so that a later migration step,
 * or 01-unfreeze, can PROVE the key did not change across the cutover without
 * anyone ever handling the secret itself.
 */
function signingKeyReport(map) {
  const chain = [
    'EVIDENCE_SIGNING_SECRET',
    'OTP_TOKEN_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'META_WA_ACCESS_TOKEN',
  ];
  const present = chain.filter((key) => Boolean(map.get(key)));
  const winner = present[0] || null;
  const value = winner ? String(map.get(winner)) : '';
  const serviceRole = String(map.get('SUPABASE_SERVICE_ROLE_KEY') || '');
  const digest = (input) => createHash('sha256')
    .update(`crm-migration-fingerprint.v1|${input}`)
    .digest('hex')
    .slice(0, 16);
  return {
    chain: chain.map((key) => ({ key, set: Boolean(map.get(key)) })),
    effectiveSource: winner,
    // server/signatureEvidence.js:14 reports 'dedicated_secret' only when
    // EVIDENCE_SIGNING_SECRET itself is what won.
    strength: winner === 'EVIDENCE_SIGNING_SECRET' ? 'dedicated_secret'
      : winner ? 'derived_server_secret' : 'process_ephemeral',
    fingerprint: value ? digest(value) : null,
    // Recorded separately so that AFTER the cutover a step can prove the value
    // sitting in EVIDENCE_SIGNING_SECRET is the OLD service_role key: the new
    // project's regenerated key cannot produce this digest.
    serviceRoleFingerprint: serviceRole ? digest(serviceRole) : null,
    // Does the winning value happen to be the same string as another variable
    // the migration is about to change? Booleans only — no values compared aloud.
    sameAsServiceRoleKey: Boolean(value) && Boolean(serviceRole) && value === serviceRole,
    sameAsMetaToken: Boolean(value) && Boolean(map.get('META_WA_ACCESS_TOKEN')) && value === String(map.get('META_WA_ACCESS_TOKEN')),
  };
}

/**
 * Two questions get asked about the signing key, and conflating them produces a
 * script that either blocks the cutover for no reason or waves through the one
 * failure it exists to catch. They are kept apart deliberately:
 *
 *   movesWithCutover — will repointing SUPABASE_SERVICE_ROLE_KEY at the new
 *       project change the HMAC key? This, and only this, gates the freeze. It
 *       is true exactly when the service_role key is what wins the chain.
 *
 *   matchesServiceRoleKey — is the key in force the same string as the current
 *       service_role key? Interesting because seals made before any dedicated
 *       secret was introduced were made with the service_role key. A mismatch
 *       is a real, serious, PRE-EXISTING condition — but the region move neither
 *       causes it nor can repair it, so it must not stop the freeze at 2am.
 *
 * blocksFreeze=true is overridable with --allow-unpinned-signing-key.
 */
function signingKeyVerdict(report, { pointsAtOldProject, envGroups, envGroupsKnown }) {
  if (!report) {
    return {
      blocksFreeze: true,
      code: 'unknown',
      headline: 'the signing key could not be inspected, so the cutover risk is unknown',
    };
  }
  if (envGroups && envGroups.length) {
    return {
      blocksFreeze: true,
      code: 'env_groups_linked',
      headline: `env group(s) ${envGroups.join(', ')} are linked, so this reading may be incomplete`,
    };
  }
  const groupCaveat = envGroupsKnown ? null : 'env groups could not be listed, so a secret defined in a group would be invisible here';

  switch (report.effectiveSource) {
    case 'SUPABASE_SERVICE_ROLE_KEY':
      // The one case the whole migration is built around.
      return {
        blocksFreeze: true,
        code: 'unpinned_service_role',
        headline: 'no dedicated secret: the HMAC key IS the service_role key, which the new project regenerates',
        groupCaveat,
      };
    case 'EVIDENCE_SIGNING_SECRET':
      if (report.sameAsServiceRoleKey) {
        return {
          blocksFreeze: false,
          code: 'pinned_to_old_service_role',
          headline: 'pinned to its own variable, holding the same string as the old service_role key',
          groupCaveat,
        };
      }
      return {
        blocksFreeze: false,
        code: 'pinned_to_other_value',
        headline: 'pinned to its own variable, holding a string that is NOT the current service_role key',
        pointsAtOldProject,
        groupCaveat,
      };
    case 'OTP_TOKEN_SECRET':
    case 'META_WA_ACCESS_TOKEN':
      return {
        blocksFreeze: false,
        code: 'unpinned_other',
        headline: `the HMAC key rides on ${report.effectiveSource} — the cutover will not move it, but nothing pins it either`,
        groupCaveat,
      };
    default:
      return {
        blocksFreeze: false,
        code: 'ephemeral',
        headline: 'none of the four variables is set: the key is random per process, so no seal has ever survived a restart',
        groupCaveat,
      };
  }
}

/**
 * Resolves the Render web service id without ever guessing one.
 * Order: --service-id, RENDER_SERVICE_ID, the id embedded in RENDER_DEPLOY_HOOK
 * (server/.env has one), then a name lookup, then the pinned fallback constant.
 * The deploy hook carries a key in its query string and is never printed.
 */
function resolveServiceId(explicit) {
  if (explicit) return { id: explicit.trim(), source: '--service-id' };
  const fromEnv = (process.env.RENDER_SERVICE_ID || '').trim();
  if (fromEnv) return { id: fromEnv, source: 'RENDER_SERVICE_ID' };
  const hook = String(process.env.RENDER_DEPLOY_HOOK || '');
  const match = hook.match(/\/deploy\/(srv-[a-z0-9]+)/i);
  if (match) return { id: match[1], source: 'RENDER_DEPLOY_HOOK (id only; the key in it is never read out)' };
  return { id: null, source: null };
}

async function listAllServices(render) {
  const services = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const res = await render.get(`/services?${qs.toString()}`);
    if (!res.ok) throw new Error(`Could not list Render services: HTTP ${res.status} ${res.text}`);
    const rows = Array.isArray(res.json) ? res.json : [];
    if (rows.length === 0) break;
    for (const row of rows) services.push(row.service || row);
    cursor = rows[rows.length - 1]?.cursor || null;
    if (!cursor || rows.length < 100) break;
  }
  return services;
}

function describeService(service) {
  return {
    id: service.id,
    name: service.name,
    type: service.type,
    suspended: service.suspended || 'unknown',
    suspenders: Array.isArray(service.suspenders) ? service.suspenders : [],
    url: service.serviceDetails?.url || null,
    region: service.serviceDetails?.region || null,
    plan: service.serviceDetails?.plan || null,
    schedule: service.serviceDetails?.schedule || null,
    lastSuccessfulRunAt: service.serviceDetails?.lastSuccessfulRunAt || null,
  };
}

// ── Health probing ──────────────────────────────────────────────────────────
/** Answering = HTTP 2xx AND a body that parses to { status: 'UP' } (server/index.js:774). */
async function probeHealth(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* Render's suspended page is HTML */ }
    return {
      answering: res.ok && body?.status === 'UP',
      status: res.status,
      detail: body?.status ? `status=${body.status}` : `non-JSON body (${text.trim().slice(0, 60) || 'empty'})`,
    };
  } catch (err) {
    return { answering: false, status: 0, detail: `no response (${err.name === 'AbortError' ? 'timeout' : err.message})` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The writer Render cannot touch.
 *
 * ecosystem.config.cjs runs a pm2 app named `crm-api` from server/index.js with
 * cwd=server, so it loads server/.env — the same SUPABASE_URL and the same
 * service_role key as production. Suspending the Render service does nothing to
 * it. Its NODE_ENV is development, so scheduledJobsEnabled() is false and it
 * runs no timers, but every route it serves still writes to the OLD project,
 * and pm2 is configured with autorestart + max_restarts 50.
 *
 * Probed on both loopback names because Node 20+ resolves `localhost` to ::1
 * first and a server bound to 0.0.0.0 will not answer there.
 */
async function probeLocalApi(port) {
  const results = [];
  for (const host of ['127.0.0.1', '[::1]']) {
    const url = `http://${host}:${port}${HEALTH_PATH}`;
    // eslint-disable-next-line no-await-in-loop
    const probe = await probeHealth(url, 3000);
    results.push({ url, ...probe });
    if (probe.answering) return { running: true, url, probes: results };
  }
  return { running: false, url: null, probes: results };
}

// ── State file ──────────────────────────────────────────────────────────────
function readStateFile() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function rotateStateFile() {
  if (!fs.existsSync(STATE_FILE)) return null;
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(HISTORY_DIR, `01-freeze-${stamp}.json`);
  fs.renameSync(STATE_FILE, target);
  return target;
}

function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ── Output helpers ──────────────────────────────────────────────────────────
const line = (char = '─') => console.log(char.repeat(78));
function section(title) {
  console.log('');
  line();
  console.log(title);
  line();
}

function usage() {
  console.log(`
migration/01-freeze.mjs — stop every writer before the Supabase region move.

  node migration/01-freeze.mjs                 plan only, changes nothing
  node migration/01-freeze.mjs --confirm       suspend the API + crons, verify

  --confirm            perform the suspends (required for any change)
  --env-file <path>    explicit .env file (default: server/.env)
  --service-id <id>    Render web service id (default: RENDER_SERVICE_ID, else the
                       id inside RENDER_DEPLOY_HOOK, else lookup by name)
  --health-url <url>   health endpoint used to prove the freeze
  --timeout-sec <n>    wait for the API to go quiet (default 300)
  --poll-sec <n>       seconds between health probes (default 5)
  --local-port <n>     port to probe for a local server (default PORT, else 5000)
  --skip-local-check   do not probe localhost for a local server
  --abort-sec <n>      countdown before the suspend, Ctrl+C to abort (default 10)
  --yes                skip the countdown (unattended runs)
  --force              proceed even if a previous freeze was never unfrozen
  --skip-crons         web service only, leave cron jobs alone
  --allow-unpinned-signing-key
                       freeze even though EVIDENCE_SIGNING_SECRET is not verifiably
                       pinned to the OLD service_role key
  --help               this text

Inverse: node migration/01-unfreeze.mjs --confirm
`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const { flags, opts, unknown } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || flags.has('h')) {
    usage();
    return 0;
  }
  if (unknown.length) {
    console.error(`ERROR: unrecognised argument(s): ${unknown.join(' ')}`);
    console.error('  Nothing was changed. Run with --help for the accepted flags.');
    return 1;
  }

  const confirm = flags.has('confirm');
  const skipCrons = flags.has('skip-crons');
  const skipLocalCheck = flags.has('skip-local-check');
  const allowUnpinnedKey = flags.has('allow-unpinned-signing-key');
  const skipCountdown = flags.has('yes');
  const force = flags.has('force');
  const timeoutSec = Number(opts['timeout-sec'] || 300);
  const pollSec = Number(opts['poll-sec'] || 5);
  const abortSec = Number(opts['abort-sec'] || 10);
  if (!Number.isFinite(abortSec) || abortSec < 0) {
    console.error('ERROR: --abort-sec must be zero or a positive number');
    return 1;
  }
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    console.error('ERROR: --timeout-sec must be a positive number');
    return 1;
  }
  if (!Number.isFinite(pollSec) || pollSec <= 0) {
    console.error('ERROR: --poll-sec must be a positive number');
    return 1;
  }

  section('STEP 1 — PRE-CUTOVER FREEZE (Supabase ap-northeast-2 -> eu-central-1)');
  console.log(confirm
    ? 'MODE: --confirm — this run WILL suspend Render services.'
    : 'MODE: plan only — nothing will be changed. Add --confirm to act.');

  // 1. Configuration
  const envFile = resolveEnvFile(opts['env-file']);
  if (!envFile) {
    console.error('');
    console.error('ERROR: could not find server/.env.');
    console.error('  Looked next to this repo and, for a git worktree, in the main checkout.');
    console.error('  Pass one explicitly:  --env-file <path-to-server/.env>');
    return 1;
  }
  const loadedKeys = loadEnvFile(envFile);
  console.log(`Config file: ${envFile}`);
  console.log(`Loaded ${loadedKeys.length} variable name(s) from it (values are never printed).`);

  const apiKey = (process.env.RENDER_API_KEY || '').trim();
  if (!apiKey) {
    console.error('');
    console.error(`ERROR: RENDER_API_KEY is not set (checked process.env and ${envFile}).`);
    return 1;
  }
  const render = makeRenderClient(apiKey);

  // 2. Report what is currently running
  section('WHAT IS RUNNING RIGHT NOW');
  const resolved = resolveServiceId(opts['service-id']);
  let apiServiceId = resolved.id;
  let idSource = resolved.source;
  let apiRes = null;

  if (apiServiceId) {
    console.log(`Service id ${apiServiceId} (from ${idSource}). Asking the Render API ...`);
    apiRes = await render.get(`/services/${apiServiceId}`);
    if (!apiRes.ok) {
      console.log(`  HTTP ${apiRes.status} for that id — falling back to a lookup by name.`);
      apiRes = null;
    }
  }

  // Name lookup is the fallback, never the guess. An id that does not resolve,
  // or no id at all, must not stop the operation on the day of the cutover.
  if (!apiRes) {
    console.log(`Looking up the web service by name "${API_SERVICE_NAME}" ...`);
    const all = await listAllServices(render);
    const match = all.find((service) => service.name === API_SERVICE_NAME && service.type === 'web_service');
    if (!match) {
      console.error('');
      console.error(`ERROR: no web service named "${API_SERVICE_NAME}" is visible to this RENDER_API_KEY.`);
      console.error('  Nothing was changed. Check the key\'s workspace, or pass --service-id.');
      return 1;
    }
    apiServiceId = match.id;
    idSource = 'lookup by name';
    apiRes = { ok: true, status: 200, json: match, text: '' };
  }

  const apiService = describeService(apiRes.json.service || apiRes.json);
  if (apiService.name !== API_SERVICE_NAME) {
    console.error('');
    console.error(`ERROR: refusing to act. Service ${apiServiceId} is named "${apiService.name}",`);
    console.error(`  but this script only ever suspends "${API_SERVICE_NAME}".`);
    return 1;
  }
  if (apiService.type !== 'web_service') {
    console.error('');
    console.error(`ERROR: refusing to act. Service ${apiServiceId} has type "${apiService.type}", not web_service.`);
    return 1;
  }
  if (apiServiceId !== FALLBACK_API_SERVICE_ID) {
    console.log(`  NOTE: this id differs from the one recorded in this script (${FALLBACK_API_SERVICE_ID}).`);
    console.log('  The live environment wins, but confirm it is the service you mean.');
  }

  console.log('');
  console.log(`  WEB SERVICE  ${apiService.name}`);
  console.log(`    id         ${apiService.id}`);
  console.log(`    type       ${apiService.type}   plan=${apiService.plan || 'n/a'}   region=${apiService.region || 'n/a'}`);
  console.log(`    url        ${apiService.url || FALLBACK_API_ORIGIN}`);
  console.log(`    suspended  ${apiService.suspended}${apiService.suspenders.length ? ` (by: ${apiService.suspenders.join(', ')})` : ''}`);

  const healthUrl = opts['health-url']
    || `${(apiService.url || FALLBACK_API_ORIGIN).replace(/\/$/, '')}${HEALTH_PATH}`;
  console.log(`    health     ${healthUrl}`);

  const livePre = await probeHealth(healthUrl);
  console.log(`    live check ${livePre.answering ? 'ANSWERING' : 'not answering'} (HTTP ${livePre.status}, ${livePre.detail})`);

  // ── The signing-key tripwire ──────────────────────────────────────────────
  // Recorded now, while the OLD project is still live, so a later step can prove
  // the HMAC key survived the cutover unchanged.
  console.log('');
  console.log('  SIGNING KEY BEHIND EVERY SEAL AND UNSUBSCRIBE LINK');
  let signingKey = null;
  let keyVerdict = { blocksFreeze: true, code: 'unknown', headline: 'not inspected' };
  const envInfo = await inspectEnv(render, apiServiceId);
  if (!envInfo.available) {
    console.log(`    Could not read the service environment (${envInfo.reason}).`);
    console.log('    Check EVIDENCE_SIGNING_SECRET by hand in the Render dashboard before cutover.');
  } else {
    signingKey = signingKeyReport(envInfo.map);
    const supabaseUrl = String(envInfo.map.get('SUPABASE_URL') || '');
    const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
    signingKey.supabaseProjectRef = refMatch ? refMatch[1] : null;
    signingKey.capturedAt = new Date().toISOString();
    signingKey.envGroups = envInfo.envGroups || [];
    const pointsAtOldProject = signingKey.supabaseProjectRef === OLD_PROJECT_REF;
    keyVerdict = signingKeyVerdict(signingKey, {
      pointsAtOldProject,
      envGroups: envInfo.envGroups,
      envGroupsKnown: envInfo.envGroupsKnown,
    });
    signingKey.verdict = keyVerdict;

    for (const step of signingKey.chain) {
      console.log(`    ${step.set ? 'set ' : 'unset'}  ${step.key}${step.key === signingKey.effectiveSource ? '   <-- this one is the live HMAC key' : ''}`);
    }
    console.log(`    strength    ${signingKey.strength}`);
    console.log(`    fingerprint ${signingKey.fingerprint || '(no key — process-ephemeral)'}  (one-way digest; the secret itself is never read out)`);
    console.log(`    svc-role fp ${signingKey.serviceRoleFingerprint || '(not set)'}  (digest of SUPABASE_SERVICE_ROLE_KEY, for the post-cutover check)`);
    console.log(`    supabase    project ref ${signingKey.supabaseProjectRef || '(unknown)'}${pointsAtOldProject ? ' — the OLD Seoul project, as expected before cutover' : ''}`);
    if (envInfo.envGroupsKnown) {
      console.log(`    env groups  ${envInfo.envGroups.length ? envInfo.envGroups.join(', ') : 'none linked'}`);
    } else {
      console.log('    env groups  could not be listed — see the caveat below');
    }
    console.log('');
    console.log(`    DOES THE CUTOVER MOVE THIS KEY? ${keyVerdict.blocksFreeze ? 'YES — THAT BLOCKS THE FREEZE' : 'No.'}`);
    console.log(`    ${keyVerdict.headline}`);
    console.log('');

    switch (keyVerdict.code) {
      case 'pinned_to_old_service_role':
        console.log('    EVIDENCE_SIGNING_SECRET is set AND holds the same string as');
        console.log('    SUPABASE_SERVICE_ROLE_KEY, which is the key the seals were made with.');
        console.log('    Repointing SUPABASE_SERVICE_ROLE_KEY at the new project therefore does not');
        console.log('    move the HMAC key.');
        console.log('    DURING THIS MIGRATION: DO NOT EDIT EVIDENCE_SIGNING_SECRET. Not to a new');
        console.log('    random value, not to the NEW project\'s service_role key. Leave it alone.');
        break;
      case 'pinned_to_other_value':
        console.log('    THE MIGRATION IS SAFE FOR THIS KEY: it lives in its own variable, so');
        console.log('    repointing SUPABASE_SERVICE_ROLE_KEY does not disturb it. Leave');
        console.log('    EVIDENCE_SIGNING_SECRET untouched throughout and every seal made under it');
        console.log('    keeps verifying.');
        console.log('');
        console.log('    SEPARATELY, AND NOT CAUSED BY THIS MIGRATION: its value is not the current');
        console.log('    service_role key. Seals are verified with whatever key is in force when');
        console.log('    they are checked, so any seal created BEFORE this variable was introduced');
        console.log('    was made with a different key and no longer verifies. That would be older');
        console.log('    health declarations, liability waivers and unsubscribe links.');
        console.log('    This script cannot tell you when the variable was introduced or how many');
        console.log('    rows predate it. Worth answering — but it is not a cutover blocker, and');
        console.log('    the region move neither causes nor repairs it.');
        break;
      case 'unpinned_service_role':
        console.log('    *** THIS BLOCKS THE FREEZE ***: no dedicated signing secret is set, so the');
        console.log('    HMAC key IS the service_role key. The new project regenerates that key,');
        console.log('    which would silently invalidate every historical seal and unsubscribe link.');
        console.log('    BEFORE CUTOVER, in the Render dashboard:');
        console.log('      1. copy the CURRENT value of SUPABASE_SERVICE_ROLE_KEY;');
        console.log('      2. create EVIDENCE_SIGNING_SECRET with that exact value;');
        console.log(`      3. re-run this script — the fingerprint must still read ${signingKey.fingerprint}`);
        console.log('         and this line must stop saying the cutover moves the key.');
        console.log('    Do this while the OLD key is still live. After the cutover it is gone.');
        break;
      case 'unpinned_other':
        console.log(`    The key comes from ${signingKey.effectiveSource}, which the region move does`);
        console.log('    not touch — so the cutover itself is safe. But nothing pins it: rotating');
        console.log('    that token silently breaks every seal. Copy its current value into');
        console.log('    EVIDENCE_SIGNING_SECRET, then re-run and confirm the fingerprint is');
        console.log(`    still ${signingKey.fingerprint}.`);
        break;
      case 'ephemeral':
        console.log('    None of the four variables is set. The server falls back to a random');
        console.log('    per-process key, so seals already do not survive a restart. The cutover');
        console.log('    takes nothing away here — but nothing ever verified in the first place,');
        console.log('    which is its own problem worth raising after the move.');
        break;
      case 'env_groups_linked':
        console.log('    *** THIS BLOCKS THE FREEZE ***: an environment GROUP is linked to this');
        console.log('    service. The Render env-vars endpoint returns only variables set directly');
        console.log('    on the service, so a signing secret defined in the group is invisible here');
        console.log('    and every reading above may be wrong. Open the group in the dashboard,');
        console.log('    check the four variables by hand, then re-run with');
        console.log('    --allow-unpinned-signing-key once you know what is actually in force.');
        break;
      default:
        break;
    }
    if (keyVerdict.groupCaveat) {
      console.log('');
      console.log(`    CAVEAT: ${keyVerdict.groupCaveat}.`);
      console.log('    The readings above cover only variables set directly on the service.');
    }
    if (signingKey.sameAsMetaToken) {
      console.log('');
      console.log('    NOTE: the live HMAC key is the same string as META_WA_ACCESS_TOKEN. That is');
      console.log('    not a migration problem, but it means a future WhatsApp token rotation would');
      console.log('    break every seal. Give the signing secret its own independent value once the');
      console.log('    move is done, and treat it as permanent from then on.');
    }
  }

  // ── The writer Render has no authority over ───────────────────────────────
  console.log('');
  console.log('  LOCAL SERVER ON THIS MACHINE (Render cannot suspend it)');
  const localPort = Number(opts['local-port'] || process.env.PORT || DEFAULT_LOCAL_PORT);
  let localApi = { checked: false, running: false, port: localPort, url: null, probes: [] };
  if (skipLocalCheck) {
    console.log('    --skip-local-check given. You are asserting no local server is running.');
    console.log('    If pm2 has `crm-api` up, it writes to the OLD project through this whole');
    console.log('    window and the dump goes stale without any sign of it.');
  } else if (!Number.isFinite(localPort) || localPort <= 0) {
    console.error('ERROR: --local-port must be a positive number');
    return 1;
  } else {
    const probe = await probeLocalApi(localPort);
    localApi = { checked: true, ...probe, port: localPort };
    if (probe.running) {
      console.log(`    ANSWERING at ${probe.url}`);
      console.log('    ecosystem.config.cjs runs this as the pm2 app `crm-api`, from server/.env —');
      console.log('    the same Supabase project as production. It has no schedulers');
      console.log('    (NODE_ENV=development, so scheduledJobsEnabled() is false), but every route');
      console.log('    it serves still writes to the OLD project, and pm2 restarts it on its own.');
      console.log('    STOP IT BEFORE FREEZING:   pm2 stop crm-api');
      console.log('    (`pm2 stop` is enough; autorestart will not resurrect a stopped app.)');
    } else {
      console.log(`    nothing answering on port ${localPort} (127.0.0.1 and ::1 both checked).`);
    }
  }

  // Cron jobs — found by name, never guessed.
  let allServices = [];
  const cronFindings = [];
  if (!skipCrons) {
    console.log('');
    console.log('Listing every Render service in this workspace to match cron jobs by name ...');
    allServices = await listAllServices(render);
    console.log(`  ${allServices.length} service(s) visible to this API key.`);
    for (const expected of EXPECTED_CRONS) {
      // Name AND type. A web service that happened to share a cron's name must
      // never be suspended by the cron branch of this script.
      const found = allServices.find((service) => service.name === expected.name
        && service.type === 'cron_job');
      cronFindings.push({ expected, service: found ? describeService(found) : null });
    }
    console.log('');
    for (const finding of cronFindings) {
      const { expected, service } = finding;
      if (!service) {
        console.log(`  CRON  ${expected.name}`);
        console.log('    NOT FOUND on Render. It is declared in render.yaml but no such service');
        console.log('    exists in this workspace, so there is nothing to suspend.');
        console.log(`    (declared: ${expected.schedule} — ${expected.calls})`);
      } else {
        console.log(`  CRON  ${service.name}`);
        console.log(`    id         ${service.id}`);
        console.log(`    type       ${service.type}   schedule=${service.schedule || expected.schedule}`);
        console.log(`    suspended  ${service.suspended}${service.suspenders.length ? ` (by: ${service.suspenders.join(', ')})` : ''}`);
        console.log(`    calls      ${expected.calls}`);
      }
      console.log('');
    }
    const strays = allServices.filter((service) => service.type === 'cron_job'
      && !EXPECTED_CRONS.some((expected) => expected.name === service.name));
    if (strays.length) {
      console.log('  NOTE: other cron jobs exist in this workspace and are NOT touched by this script:');
      for (const stray of strays) console.log(`    - ${stray.name} (${stray.id})`);
      console.log('');
    }
  } else {
    console.log('');
    console.log('  --skip-crons given: cron jobs are not inspected and not suspended.');
  }

  // 3. The plan
  section('PLAN');
  const targets = [
    { kind: 'web', service: apiService, why: 'stops every route AND every in-process scheduler' },
  ];
  for (const finding of cronFindings) {
    if (finding.service) {
      targets.push({ kind: 'cron', service: finding.service, why: finding.expected.calls });
    }
  }

  let n = 0;
  for (const target of targets) {
    n += 1;
    const already = target.service.suspended === 'suspended';
    console.log(`  ${n}. ${already ? 'SKIP (already suspended)' : 'SUSPEND'}  ${target.service.name}  [${target.service.id}]`);
    console.log(`       ${target.why}`);
    if (already) {
      console.log('       It was already suspended before this run, so 01-unfreeze will NOT resume it.');
    }
  }
  n += 1;
  console.log(`  ${n}. VERIFY  re-read each service from the Render API until it reports`);
  console.log(`       suspended, AND poll ${healthUrl}`);
  console.log(`       every ${pollSec}s for up to ${timeoutSec}s until it goes quiet twice in a row.`);
  if (localApi.running) {
    n += 1;
    console.log(`  ${n}. NOT DONE BY THIS SCRIPT: stop the local server at ${localApi.url}`);
    console.log('       Render has no authority over it. Run `pm2 stop crm-api` yourself.');
  }

  console.log('');
  console.log('CONSEQUENCES, STATED PLAINLY:');
  console.log('  - Every CRM write through Render stops. The Vercel client holds only one');
  console.log('    createClient (client/src/authClient.js) and uses it for auth alone, so with');
  console.log('    the API down no browser can reach the old project\'s data tables.');
  console.log('  - Every in-process scheduler stops with the process: WhatsApp bot follow-ups,');
  console.log('    the abandoned-reply sweep, registration lifecycle sends, participation and');
  console.log('    health-expiry reminders, shift reminders, the daily attendance ensure and');
  console.log('    the pending-message retry. This is what protects the "already sent" markers');
  console.log('    in kv_collections from drifting after the dump is taken.');
  console.log('  - Meta webhook deliveries to /api/whatsapp/webhook will fail while frozen.');
  console.log('    Meta does retry failed webhook deliveries for a period, so inbound messages');
  console.log('    are LIKELY to arrive after the resume — but that is Meta\'s behaviour, not a');
  console.log('    guarantee this repo controls, and it is not verifiable from here. Keep the');
  console.log('    window short and check the inbox against WhatsApp itself afterwards.');
  console.log('  - iCount webhooks (POST /api/icount/webhook) will also fail during the window.');
  console.log('    Do not rely on redelivery there at all: reconcile through the finance sync');
  console.log('    after the move.');
  console.log('  - Staff logins still hit Supabase auth on the OLD project and will still work.');
  console.log('    That only touches the auth schema (last_sign_in_at); no CRM data changes.');
  console.log('    Tell staff to stay logged out during the window anyway — the app is useless');
  console.log('    without the API.');
  console.log('  - The public site and forms return errors while frozen. Freeze outside opening hours.');
  console.log('  - This script does NOT stop: a local pm2 `crm-api`, anything you run by hand');
  console.log('    from server/scripts/, psql sessions you have open, or direct dashboard edits');
  console.log('    in Supabase. Those stay your responsibility for the whole window.');

  if (!confirm) {
    console.log('');
    line('=');
    console.log('PLAN ONLY — NOTHING WAS CHANGED.');
    console.log('To perform the freeze:   node migration/01-freeze.mjs --confirm');
    line('=');
    return 0;
  }

  // 3b. Pre-suspend gates. Both refuse BEFORE anything is changed.
  if (localApi.running) {
    console.error('');
    line('=');
    console.error(`ERROR: a local server is answering at ${localApi.url}.`);
    console.error('  Suspending Render would leave it as a live writer to the OLD project for the');
    console.error('  entire cutover window, and every row it writes after the dump is lost.');
    console.error('');
    console.error('  Stop it, then re-run:');
    console.error('      pm2 stop crm-api');
    console.error('');
    console.error('  If that port belongs to something unrelated, re-run with --skip-local-check.');
    line('=');
    return 1;
  }

  if (keyVerdict.blocksFreeze && !allowUnpinnedKey) {
    console.error('');
    line('=');
    console.error(`ERROR: the cutover would move the HMAC signing key — ${keyVerdict.headline}.`);
    console.error('');
    console.error('  Freezing is the last moment the OLD key is still live and readable. Fix it');
    console.error('  now, in the Render dashboard, following the instructions printed above, then');
    console.error('  re-run this script and confirm the key no longer moves with the cutover.');
    console.error('');
    console.error('  Nothing was changed by this run.');
    console.error('');
    console.error('  To freeze anyway — accepting that historical health declarations, liability');
    console.error('  waivers and unsubscribe links may stop verifying with no error anywhere:');
    console.error('      node migration/01-freeze.mjs --confirm --allow-unpinned-signing-key');
    line('=');
    return 1;
  }
  if (keyVerdict.blocksFreeze && allowUnpinnedKey) {
    console.log('');
    console.log(`OVERRIDE: --allow-unpinned-signing-key given. Proceeding despite: ${keyVerdict.headline}.`);
  }

  // 4. Guard against clobbering an unresumed freeze
  const previous = readStateFile();
  let carriedForward = [];
  if (previous && !previous.resumedAt) {
    const stillSuspended = (previous.services || []).filter((s) => s.suspendOk && s.restoreOnUnfreeze);
    if (stillSuspended.length && !force) {
      console.error('');
      console.error('ERROR: migration/state/01-freeze.json records a freeze that was never unfrozen:');
      for (const s of stillSuspended) console.error(`  - ${s.name} (${s.id}) suspended at ${s.suspendedAt}`);
      console.error('');
      console.error('  Run the inverse first:  node migration/01-unfreeze.mjs --confirm');
      console.error('  Or, if that state is stale, re-run this with --force (the old file is');
      console.error('  archived under migration/state/history/, never deleted, and any service it');
      console.error('  still holds suspended is carried into the new state so 01-unfreeze can');
      console.error('  still resume it).');
      return 1;
    }
    if (stillSuspended.length && force) {
      // Archiving alone would strand these: 01-unfreeze reads only the current
      // state file, so a service suspended by the previous run would have no
      // record anywhere that anything is expected to resume it.
      carriedForward = stillSuspended;
    }
  }
  // 4b. Last chance to abort.
  //
  // Everything above this line is read-only. Everything below takes the CRM
  // offline. The gates that precede it only catch conditions the script can
  // detect; they cannot catch "wrong terminal", "wrong day", or a flag typed to
  // silence a check rather than to satisfy it. A countdown costs the operation
  // a few seconds and is the only thing standing between a mistyped command and
  // real downtime. --yes skips it for genuinely unattended runs.
  if (!skipCountdown) {
    console.log('');
    line('=');
    console.log('ABOUT TO TAKE THE CRM OFFLINE.');
    for (const target of targets) {
      if (target.service.suspended !== 'suspended') {
        console.log(`  will suspend: ${target.service.name} (${target.service.id})`);
      }
    }
    console.log(`  the public site, all staff screens and every webhook stop answering at ${healthUrl}`);
    console.log('');
    console.log(`Press Ctrl+C to abort. Starting in ${abortSec}s ...`);
    for (let remaining = abortSec; remaining > 0; remaining -= 1) {
      process.stdout.write(`  ${remaining} ... `);
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
    console.log('');
    line('=');
  }

  const archived = rotateStateFile();
  if (archived) console.log(`\nPrevious state archived to ${archived}`);
  if (carriedForward.length) {
    console.log('--force: carrying these unresumed services from the archived state into the new');
    console.log('one, so 01-unfreeze still knows to resume them:');
    for (const s of carriedForward) console.log(`  - ${s.name} (${s.id})`);
  }

  // 5. Record the plan BEFORE acting, so a crash mid-way is still recoverable
  const state = {
    version: 1,
    script: '01-freeze',
    createdAt: new Date().toISOString(),
    confirmed: true,
    envFile,
    healthUrl,
    healthBeforeFreeze: livePre,
    apiServiceId,
    apiServiceIdSource: idSource,
    localApi,
    signingKeyOverridden: keyVerdict.blocksFreeze && allowUnpinnedKey,
    // One-way digest of the live HMAC key, captured while the OLD project is
    // still authoritative. 01-unfreeze refuses to bring the API back if this
    // has changed — that change is the silent seal-breaking event.
    signingKey,
    services: [
      // Anything a previous --force run left suspended, so 01-unfreeze still
      // resumes it. Their recorded outcome is preserved as-is; this run does not
      // re-issue a suspend for them.
      ...carriedForward.map((entry) => ({ ...entry, carriedForwardFrom: previous?.createdAt || null })),
      ...targets
        .filter((target) => !carriedForward.some((s) => s.id === target.service.id))
        .map((target) => ({
          id: target.service.id,
          name: target.service.name,
          type: target.service.type,
          url: target.service.url,
          schedule: target.service.schedule,
          suspendedBefore: target.service.suspended,
          suspendersBefore: target.service.suspenders,
          // Only what WE suspend may be resumed by 01-unfreeze. Something the owner
          // (or Render billing) had already suspended stays suspended.
          restoreOnUnfreeze: target.service.suspended !== 'suspended',
          suspendRequested: false,
          suspendOk: null,
          suspendHttpStatus: null,
          suspendedAt: null,
          note: null,
        })),
    ],
    cronsNotFound: cronFindings.filter((f) => !f.service).map((f) => f.expected.name),
    cronsSkipped: skipCrons,
    frozenAt: null,
    verification: null,
    resumedAt: null,
  };
  writeState(state);
  console.log(`State file written: ${STATE_FILE}`);

  // 6. Suspend
  section('SUSPENDING');
  let failures = 0;
  for (const entry of state.services) {
    if (entry.carriedForwardFrom) {
      console.log(`  SKIP     ${entry.name} (${entry.id}) — already suspended by the run of ${entry.carriedForwardFrom}`);
      writeState(state);
      continue;
    }
    if (!entry.restoreOnUnfreeze) {
      entry.note = 'already suspended before this run — left alone';
      console.log(`  SKIP     ${entry.name} (${entry.id}) — already suspended`);
      writeState(state);
      continue;
    }
    console.log(`  SUSPEND  ${entry.name} (${entry.id}) ...`);
    entry.suspendRequested = true;
    try {
      const res = await render.post(`/services/${entry.id}/suspend`);
      entry.suspendHttpStatus = res.status;
      entry.suspendOk = res.ok;
      entry.suspendedAt = new Date().toISOString();
      if (res.ok) {
        console.log(`           OK (HTTP ${res.status}) at ${entry.suspendedAt}`);
      } else {
        failures += 1;
        entry.note = res.text;
        console.error(`           FAILED (HTTP ${res.status}): ${res.text}`);
      }
    } catch (err) {
      failures += 1;
      entry.suspendOk = false;
      entry.note = err.message;
      console.error(`           FAILED: ${err.message}`);
    }
    writeState(state);
  }

  if (failures) {
    console.error('');
    console.error(`ERROR: ${failures} suspend call(s) failed. THE FREEZE IS NOT COMPLETE.`);
    console.error('  Do NOT start the dump. Fix the failures above, or suspend the service by');
    console.error('  hand in the Render dashboard, then re-run this script.');
    writeState(state);
    return 2;
  }

  // 7. Verify the freeze
  //
  // Two independent signals, because either one alone lies:
  //   - the Render API's own view of each service (authoritative, but says
  //     nothing about requests already in flight);
  //   - the public health endpoint going quiet (observable, but a laptop losing
  //     DNS for ten seconds looks exactly the same as a suspended service).
  // A freeze that was never actually applied but is reported as verified is the
  // worst outcome this script can produce, so both must agree.
  section('VERIFYING THE FREEZE');

  console.log(`1) Polling ${healthUrl} every ${pollSec}s for up to ${timeoutSec}s.`);
  console.log('   Looking for two consecutive quiet probes.');
  console.log('');

  const startedAt = Date.now();
  const deadline = startedAt + timeoutSec * 1000;
  let probes = 0;
  let consecutiveQuiet = 0;
  let sawAnswering = livePre.answering; // proves the probe path works at all
  let last = null;
  while (Date.now() < deadline) {
    probes += 1;
    last = await probeHealth(healthUrl);
    if (last.answering) sawAnswering = true;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  [${String(elapsed).padStart(4)}s] probe ${probes}: ${last.answering ? 'STILL ANSWERING' : 'quiet'} — HTTP ${last.status}, ${last.detail}`);
    consecutiveQuiet = last.answering ? 0 : consecutiveQuiet + 1;
    if (consecutiveQuiet >= 2) break;
    await sleep(pollSec * 1000);
  }
  const quiet = consecutiveQuiet >= 2;

  // Render does not flip `suspended` the instant the POST returns, so this is
  // retried rather than read once. Reading it once and failing on a state that
  // simply had not propagated yet would send the operator hunting a problem
  // that does not exist, in the middle of a cutover window.
  console.log('');
  console.log('2) Re-reading each service from the Render API until it reports suspended ...');
  let stateChecks = [];
  let allSuspendedPerApi = false;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    stateChecks = [];
    for (const entry of state.services) {
      // eslint-disable-next-line no-await-in-loop
      const res = await render.get(`/services/${entry.id}`);
      const live = res.ok ? describeService(res.json.service || res.json) : null;
      const reported = live?.suspended || `HTTP ${res.status}`;
      stateChecks.push({ id: entry.id, name: entry.name, suspended: live?.suspended === 'suspended', reported });
    }
    allSuspendedPerApi = stateChecks.length > 0 && stateChecks.every((c) => c.suspended);
    for (const check of stateChecks) {
      console.log(`   attempt ${attempt}: ${check.suspended ? 'suspended' : 'NOT SUSPENDED'}  ${check.name} (${check.id}) — Render reports "${check.reported}"`);
    }
    if (allSuspendedPerApi || Date.now() >= deadline) break;
    console.log(`   not all suspended yet; re-checking in ${pollSec}s`);
    await sleep(pollSec * 1000);
  }

  const elapsedMs = Date.now() - startedAt;
  const frozen = quiet && allSuspendedPerApi;
  // If the endpoint never once answered — not before the suspend, not during —
  // then "quiet" proves nothing about the service, only about this machine's
  // ability to reach it. Say so rather than banking a false verification.
  const probePathUnproven = quiet && !sawAnswering;

  state.verification = {
    frozen,
    quiet,
    allSuspendedPerApi,
    serviceStates: stateChecks,
    probePathUnproven,
    sawAnswering,
    probes,
    consecutiveQuiet,
    lastStatus: last?.status ?? null,
    lastDetail: last?.detail ?? null,
    elapsedMs,
    timeoutSec,
    localApiChecked: localApi.checked,
    localApiRunningAtPlanTime: localApi.running,
  };
  state.frozenAt = frozen ? new Date().toISOString() : null;
  writeState(state);

  section('RESULT');
  const suspendedList = state.services.filter((s) => s.suspendOk);
  console.log(`  suspended now : ${suspendedList.length} service(s)`);
  for (const s of suspendedList) console.log(`                  - ${s.name} (${s.id}, ${s.type})`);
  const skippedList = state.services.filter((s) => !s.restoreOnUnfreeze);
  if (skippedList.length) {
    console.log(`  left as-is    : ${skippedList.length} service(s) that were already suspended`);
    for (const s of skippedList) console.log(`                  - ${s.name} (${s.id})`);
  }
  if (state.cronsNotFound.length) {
    console.log(`  not on Render : ${state.cronsNotFound.join(', ')} (declared in render.yaml, never created)`);
  }
  console.log(`  health probes : ${probes} in ${Math.round(elapsedMs / 1000)}s`);
  console.log(`  render says   : ${allSuspendedPerApi ? 'every targeted service is suspended' : 'AT LEAST ONE SERVICE IS NOT SUSPENDED'}`);
  console.log(`  health url    : ${quiet ? 'quiet' : 'STILL ANSWERING'}`);
  console.log(`  local server  : ${localApi.checked ? (localApi.running ? 'WAS RUNNING — see above' : `none on port ${localApi.port}`) : 'not checked (--skip-local-check)'}`);
  console.log(`  signing key   : ${signingKey?.fingerprint || 'not captured'} via ${signingKey?.effectiveSource || 'n/a'} — this exact fingerprint must survive the cutover`);
  console.log(`  key verdict   : ${keyVerdict.code}${keyVerdict.blocksFreeze ? ` — MOVES WITH THE CUTOVER${allowUnpinnedKey ? ' (overridden)' : ''}` : ' — does not move with the cutover'}`);
  console.log(`  state file    : ${STATE_FILE}`);

  console.log('');
  console.log('RESUME COMMAND (the exact inverse of what this run just did):');
  console.log('');
  console.log('    node migration/01-unfreeze.mjs --confirm');
  console.log('');
  console.log('  It reads the ids above out of migration/state/01-freeze.json and resumes only');
  console.log('  the services this run suspended. Anything already suspended beforehand stays');
  console.log('  suspended.');

  if (!frozen) {
    console.error('');
    line('=');
    console.error('THE FREEZE IS NOT VERIFIED.');
    if (!quiet) {
      console.error('  The health endpoint was still answering when the timeout expired.');
    }
    if (!allSuspendedPerApi) {
      console.error('  Render itself does not report every targeted service as suspended:');
      for (const check of stateChecks.filter((c) => !c.suspended)) {
        console.error(`    - ${check.name} (${check.id}) reports "${check.reported}"`);
      }
    }
    console.error('');
    console.error('  DO NOT START THE DUMP. A live API keeps writing to the old project, and any');
    console.error('  scheduler marker written after the dump is lost at cutover — which is exactly');
    console.error('  how the WhatsApp bot ends up re-messaging real customers on the new project.');
    console.error('  Check the Render dashboard for the service state, then re-run this script.');
    console.error('');
    console.error('  Services this run suspended are still suspended. To bring them back:');
    console.error('      node migration/01-unfreeze.mjs --confirm');
    line('=');
    return 3;
  }

  console.log('');
  line('=');
  console.log('FROZEN. Render reports every targeted service suspended and the health endpoint');
  console.log('has gone quiet, so nothing reaches the old Supabase project through Render.');
  if (probePathUnproven) {
    console.log('');
    console.log('CAVEAT: the health endpoint never answered even once during this run, including');
    console.log('before the suspend. "Quiet" therefore only proves this machine could not reach');
    console.log('it — the Render API state above is the load-bearing evidence here, not the poll.');
  }
  if (!localApi.checked) {
    console.log('');
    console.log('CAVEAT: localhost was not probed (--skip-local-check). If a local `crm-api` is');
    console.log('up, it is still writing to the OLD project right now.');
  }
  console.log('');
  console.log('STILL YOURS TO HOLD SHUT for the whole window: local servers, server/scripts/ runs,');
  console.log('open psql sessions, and edits made directly in the Supabase dashboard.');
  console.log('Next step: take the dump (migration/02-*), then cut over.');
  line('=');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('');
    console.error('UNEXPECTED FAILURE:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    console.error('');
    console.error('Check migration/state/01-freeze.json for what had already been done.');
    process.exitCode = 1;
  });
