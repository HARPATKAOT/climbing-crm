#!/usr/bin/env node
/**
 * migration/01-unfreeze.mjs — THE EXACT INVERSE OF migration/01-freeze.mjs
 *
 * It resumes ONLY what 01-freeze suspended, reading the ids that run recorded to
 * migration/state/01-freeze.json. A service that was already suspended before the
 * freeze (by the owner, or by Render for billing) is left suspended: 01-freeze
 * marks those with restoreOnUnfreeze=false and this script skips them.
 *
 * Use it in two very different situations:
 *   a) ABORT — the migration was called off, nothing was cut over. Resume and the
 *      CRM is back on the OLD Supabase project, exactly as before.
 *   b) CUTOVER COMPLETE — the new project is live and the Render environment has
 *      been repointed. Resume and the CRM comes up on the NEW project.
 *
 * BEFORE YOU RESUME AFTER A CUTOVER — the check this script performs for you:
 *   server/signatureEvidence.js, server/otpService.js and server/mailingPreferences.js
 *   all derive their HMAC key from
 *     EVIDENCE_SIGNING_SECRET || OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY || META_WA_ACCESS_TOKEN
 *   Whatever wins that chain is the key behind every signature_evidence seal
 *   (minors' health declarations, liability waivers) and every mailing-preference
 *   and unsubscribe link (365-day TTL). If its VALUE changes, all of them stop
 *   verifying — silently, with no error anywhere.
 *
 *   This script does not assume which variable currently wins. It reads the live
 *   Render environment, works out the winner, and compares a one-way fingerprint
 *   of the key against the fingerprint 01-freeze recorded before the move. It
 *   never reads out, prints or stores a secret value. If the fingerprint changed,
 *   it REFUSES to resume without --i-know, because bringing the API up in that
 *   state is the exact silent failure this migration exists to avoid.
 *
 *   Note for whoever repoints the environment: if EVIDENCE_SIGNING_SECRET is
 *   already set, LEAVE IT EXACTLY AS IT IS. Overwriting it — even with the old
 *   service_role key — changes the key and breaks every existing seal.
 *
 * SAFETY
 *   - Without --confirm this prints the plan and changes NOTHING.
 *   - It only ever calls Render's resume endpoint. It cannot delete or deploy.
 *   - It never prints a secret value.
 *
 * USAGE
 *   node migration/01-unfreeze.mjs                 # plan only, no changes
 *   node migration/01-unfreeze.mjs --confirm       # actually resume + verify
 *
 * FLAGS
 *   --confirm             Perform the resumes. Without it: plan only.
 *   --state <path>        State file to read (default migration/state/01-freeze.json).
 *   --env-file <path>     Explicit .env (default: server/.env).
 *   --health-url <url>    Override the health endpoint used to prove recovery.
 *   --timeout-sec <n>     Wait for the API to answer again (default 600).
 *   --poll-sec <n>        Seconds between health probes (default 10).
 *   --all                 Also resume services 01-freeze deliberately left alone.
 *   --i-know              Proceed despite the EVIDENCE_SIGNING_SECRET warning.
 *   --skip-health         Resume and exit without waiting for the API to boot.
 *   --help
 *
 * EXIT CODES
 *   0 plan printed, or resume completed and the API is answering again
 *   1 configuration / precondition error (nothing was changed)
 *   2 at least one resume call failed
 *   3 resumes succeeded but the API never came back within the timeout
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RENDER_API = 'https://api.render.com/v1';
const FALLBACK_API_ORIGIN = 'https://climbing-crm-api.onrender.com';
const HEALTH_PATH = '/api/health';
const OLD_PROJECT_REF = 'xaxykjvqqhrodmseqleu';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const STATE_DIR = path.join(HERE, 'state');
const DEFAULT_STATE_FILE = path.join(STATE_DIR, '01-freeze.json');

// ── Tiny CLI parser ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > -1) {
      opts[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      opts[key] = next;
      i += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, opts };
}

// ── .env loading (identical resolution to 01-freeze.mjs) ────────────────────
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

// ── Render API client (read + resume only) ──────────────────────────────────
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/**
 * Presence-only inspection of the service's environment.
 * The response body carries secret VALUES; they are read into memory and used
 * for boolean checks, a one-way fingerprint, and the Supabase project ref
 * (which is public — it is baked into the client bundle). No value is ever
 * printed or stored.
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
  const supabaseUrl = String(map.get('SUPABASE_URL') || '');
  const refMatch = supabaseUrl.match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i);
  return {
    available: true,
    signingKey: signingKeyReport(map),
    supabaseProjectRef: refMatch ? refMatch[1] : null,
  };
}

/**
 * Mirrors evidenceKey() in server/signatureEvidence.js — and the identical
 * chains in server/otpService.js and server/mailingPreferences.js:
 *   EVIDENCE_SIGNING_SECRET || OTP_TOKEN_SECRET || SUPABASE_SERVICE_ROLE_KEY || META_WA_ACCESS_TOKEN
 * Whatever wins that chain IS the HMAC key behind every signature_evidence seal
 * and every mailing-preference / unsubscribe link. The fingerprint below is a
 * one-way digest, computed the same way 01-freeze computed it, so the two can
 * be compared without anyone handling the secret.
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
  return {
    chain: chain.map((key) => ({ key, set: Boolean(map.get(key)) })),
    effectiveSource: winner,
    strength: winner === 'EVIDENCE_SIGNING_SECRET' ? 'dedicated_secret'
      : winner ? 'derived_server_secret' : 'process_ephemeral',
    fingerprint: value
      ? createHash('sha256').update(`crm-migration-fingerprint.v1|${value}`).digest('hex').slice(0, 16)
      : null,
  };
}

// ── Health probing ──────────────────────────────────────────────────────────
async function probeHealth(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* Render's suspended / boot page is HTML */ }
    return {
      answering: res.ok && body?.status === 'UP',
      status: res.status,
      uptime: typeof body?.uptime === 'number' ? Math.round(body.uptime) : null,
      release: body?.release || null,
      detail: body?.status ? `status=${body.status}` : `non-JSON body (${text.trim().slice(0, 60) || 'empty'})`,
    };
  } catch (err) {
    return {
      answering: false,
      status: 0,
      uptime: null,
      release: null,
      detail: `no response (${err.name === 'AbortError' ? 'timeout' : err.message})`,
    };
  } finally {
    clearTimeout(timer);
  }
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
migration/01-unfreeze.mjs — resume exactly what migration/01-freeze.mjs suspended.

  node migration/01-unfreeze.mjs                 plan only, changes nothing
  node migration/01-unfreeze.mjs --confirm       resume the recorded services

  --confirm            perform the resumes (required for any change)
  --state <path>       state file to read (default migration/state/01-freeze.json)
  --env-file <path>    explicit .env file (default: server/.env)
  --health-url <url>   health endpoint used to prove recovery
  --timeout-sec <n>    wait for the API to boot again (default 600)
  --poll-sec <n>       seconds between health probes (default 10)
  --all                also resume services the freeze deliberately left alone
  --i-know             proceed despite the EVIDENCE_SIGNING_SECRET warning
  --skip-health        resume and exit without waiting for the boot
  --help               this text
`);
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || flags.has('h')) {
    usage();
    return 0;
  }

  const confirm = flags.has('confirm');
  const resumeAll = flags.has('all');
  const iKnow = flags.has('i-know');
  const skipHealth = flags.has('skip-health');
  const timeoutSec = Number(opts['timeout-sec'] || 600);
  const pollSec = Number(opts['poll-sec'] || 10);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    console.error('ERROR: --timeout-sec must be a positive number');
    return 1;
  }
  if (!Number.isFinite(pollSec) || pollSec <= 0) {
    console.error('ERROR: --poll-sec must be a positive number');
    return 1;
  }

  section('STEP 1 (INVERSE) — UNFREEZE: resume what 01-freeze suspended');
  console.log(confirm
    ? 'MODE: --confirm — this run WILL resume Render services.'
    : 'MODE: plan only — nothing will be changed. Add --confirm to act.');

  // 1. State file
  const stateFile = opts.state ? path.resolve(opts.state) : DEFAULT_STATE_FILE;
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (err) {
    console.error('');
    console.error(`ERROR: cannot read the freeze state file: ${stateFile}`);
    console.error(`  ${err.message}`);
    console.error('');
    console.error('  Without it there is no record of which services were suspended, and this');
    console.error('  script will not guess. Either point at an archived run with');
    console.error('  --state migration/state/history/01-freeze-<timestamp>.json, or resume the');
    console.error('  service by hand in the Render dashboard.');
    return 1;
  }
  if (state.script !== '01-freeze' || !Array.isArray(state.services)) {
    console.error(`ERROR: ${stateFile} is not a 01-freeze state file.`);
    return 1;
  }

  console.log(`State file : ${stateFile}`);
  console.log(`Frozen at  : ${state.frozenAt || '(freeze never verified)'}`);
  console.log(`Created at : ${state.createdAt}`);
  if (state.resumedAt) {
    console.log(`NOTE       : this state was already resumed at ${state.resumedAt}.`);
    console.log('             Re-running is harmless — each service is re-checked below.');
  }

  // 2. Configuration
  const envFile = resolveEnvFile(opts['env-file']);
  if (!envFile) {
    console.error('');
    console.error('ERROR: could not find server/.env. Pass one with --env-file <path>.');
    return 1;
  }
  loadEnvFile(envFile);
  const apiKey = (process.env.RENDER_API_KEY || '').trim();
  if (!apiKey) {
    console.error('');
    console.error(`ERROR: RENDER_API_KEY is not set (checked process.env and ${envFile}).`);
    return 1;
  }
  const render = makeRenderClient(apiKey);
  console.log(`Config file: ${envFile}`);

  // 3. Current state of every recorded service
  section('CURRENT STATE OF THE RECORDED SERVICES');
  const plan = [];
  for (const entry of state.services) {
    const res = await render.get(`/services/${entry.id}`);
    const live = res.ok ? res.json : null;
    const suspendedNow = live?.suspended || 'unknown';
    const suspenders = Array.isArray(live?.suspenders) ? live.suspenders : [];

    let action = 'RESUME';
    let reason = 'suspended by 01-freeze';
    if (!res.ok) {
      action = 'ERROR';
      reason = `Render API returned HTTP ${res.status}`;
    } else if (!entry.restoreOnUnfreeze && !resumeAll) {
      action = 'SKIP';
      reason = 'was ALREADY suspended before the freeze — 01-freeze did not suspend it';
    } else if (!entry.suspendOk && !resumeAll) {
      action = 'SKIP';
      reason = 'the freeze never successfully suspended it';
    } else if (suspendedNow === 'not_suspended') {
      action = 'SKIP';
      reason = 'already running';
    } else if (suspenders.length && !suspenders.includes('admin')) {
      action = 'RESUME';
      reason = `suspended by ${suspenders.join(', ')} — resume may be refused by Render`;
    }

    plan.push({ entry, live: live ? { suspendedNow, suspenders, url: live.serviceDetails?.url || null } : null, action, reason });

    console.log('');
    console.log(`  ${entry.name}  [${entry.id}]  (${entry.type})`);
    console.log(`    before freeze : ${entry.suspendedBefore}`);
    console.log(`    right now     : ${suspendedNow}${suspenders.length ? ` (by: ${suspenders.join(', ')})` : ''}`);
    console.log(`    action        : ${action} — ${reason}`);
  }

  const webEntry = state.services.find((s) => s.type === 'web_service') || state.services[0];
  const healthUrl = opts['health-url']
    || state.healthUrl
    || `${((plan.find((p) => p.entry === webEntry)?.live?.url) || FALLBACK_API_ORIGIN).replace(/\/$/, '')}${HEALTH_PATH}`;

  // 4. The pre-resume safety check that protects historical signatures
  section('PRE-RESUME CHECK — SIGNING KEY AND SUPABASE TARGET');
  let envInfo = { available: false, reason: 'not checked' };
  let signingRisk = false;
  if (webEntry) {
    envInfo = await inspectEnv(render, webEntry.id);
  }
  if (!envInfo.available) {
    console.log(`  Could not read the service environment (${envInfo.reason}).`);
    console.log('  Verify by hand in the Render dashboard before resuming after a cutover.');
  } else {
    const ref = envInfo.supabaseProjectRef;
    const pointsAtOld = ref === OLD_PROJECT_REF;
    const now = envInfo.signingKey;
    const before = state.signingKey || null;

    console.log(`  SUPABASE_URL project ref : ${ref || '(not set)'}${pointsAtOld ? ' — the OLD Seoul project' : ref ? ' — NOT the old project' : ''}`);
    for (const step of now.chain) {
      console.log(`  ${step.set ? 'set  ' : 'unset'}  ${step.key}${step.key === now.effectiveSource ? '   <-- the live HMAC key' : ''}`);
    }
    console.log(`  strength                 : ${now.strength}`);
    console.log(`  fingerprint now          : ${now.fingerprint || '(none — process-ephemeral)'}`);
    console.log(`  fingerprint at freeze    : ${before?.fingerprint || '(not recorded by that freeze run)'}`);
    console.log('  (one-way digests — no secret value is read out, logged or stored)');
    console.log('');

    if (before?.fingerprint && now.fingerprint && before.fingerprint !== now.fingerprint) {
      signingRisk = true;
      console.log('  *** STOP AND READ — THE SIGNING KEY CHANGED SINCE THE FREEZE ***');
      console.log('  This is the silent failure the whole migration is built to avoid. Resume');
      console.log('  now and, with no error message anywhere:');
      console.log('    - every historical signature_evidence seal stops verifying. That is');
      console.log('      minors\' health declarations and liability waivers.');
      console.log('    - every mailing-preference and unsubscribe link stops working');
      console.log('      (365-day TTL, so about a year of live links).');
      console.log(`  Put the key back so the fingerprint reads ${before.fingerprint} again.`);
      if (before.effectiveSource !== now.effectiveSource) {
        console.log(`  At freeze time the key came from ${before.effectiveSource}; it now comes from ${now.effectiveSource || 'nothing'}.`);
      } else {
        console.log(`  It still comes from ${now.effectiveSource}, so that variable's VALUE was edited.`);
      }
    } else if (before?.fingerprint && now.fingerprint && before.fingerprint === now.fingerprint) {
      console.log('  The HMAC key is byte-for-byte what it was at freeze time. Every existing');
      console.log('  seal and unsubscribe link will still verify after the resume.');
      if (!pointsAtOld) {
        console.log('  The API points at a different Supabase project, which is expected after a');
        console.log('  cutover — and harmless here precisely because the signing key did not move.');
      }
    } else if (now.effectiveSource === 'EVIDENCE_SIGNING_SECRET') {
      console.log('  A dedicated signing secret is set, so the key does not move when');
      console.log('  SUPABASE_SERVICE_ROLE_KEY is repointed. No fingerprint was recorded at');
      console.log('  freeze time, so this run cannot prove the value is unchanged — only that');
      console.log('  nothing in the fallback chain can shift it.');
    } else if (pointsAtOld) {
      console.log('  The API is still pointed at the OLD project. Resuming restores the CRM');
      console.log('  exactly as it was before the freeze. No signing-key risk.');
    } else {
      signingRisk = true;
      console.log('  *** STOP AND READ ***');
      console.log('  The API points at a project that is not the old one, and no dedicated');
      console.log(`  signing secret is set — the HMAC key falls through to ${now.effectiveSource || 'nothing'},`);
      console.log('  which the new project regenerated. Resume like this and every historical');
      console.log('  seal and unsubscribe link silently stops verifying.');
      console.log('  THE FIX: set EVIDENCE_SIGNING_SECRET on Render to the value the key had');
      console.log('  before the move, then re-run this script and check the fingerprint matches.');
    }

    if (!signingRisk && now.effectiveSource === 'EVIDENCE_SIGNING_SECRET') {
      console.log('');
      console.log('  REMINDER: do not edit EVIDENCE_SIGNING_SECRET during this migration for any');
      console.log('  reason. Its current value is what every existing seal was made with.');
    }
  }

  // 5. The plan
  section('PLAN');
  const toResume = plan.filter((p) => p.action === 'RESUME');
  const toSkip = plan.filter((p) => p.action === 'SKIP');
  const broken = plan.filter((p) => p.action === 'ERROR');

  if (toResume.length === 0) {
    console.log('  Nothing to resume — every recorded service is already running or');
    console.log('  deliberately left suspended.');
  }
  let n = 0;
  for (const item of toResume) {
    n += 1;
    console.log(`  ${n}. RESUME  ${item.entry.name}  [${item.entry.id}]  (${item.entry.type})`);
  }
  for (const item of toSkip) {
    console.log(`     SKIP    ${item.entry.name}  [${item.entry.id}] — ${item.reason}`);
  }
  for (const item of broken) {
    console.log(`     ERROR   ${item.entry.name}  [${item.entry.id}] — ${item.reason}`);
  }
  if (!skipHealth && toResume.length) {
    n += 1;
    console.log(`  ${n}. VERIFY  poll ${healthUrl} every ${pollSec}s for up to ${timeoutSec}s,`);
    console.log('       until it answers 200 with status=UP.');
    console.log('       Expect a slow first response: server/db.js initDb() hydrates all 103');
    console.log('       tables into memory on boot, and it deliberately throws and exits if any');
    console.log('       one of them fails — so a crash-loop, not a degraded API, is what a bad');
    console.log('       cutover looks like. Watch the Render logs if this times out.');
  }
  if (state.cronsNotFound?.length) {
    console.log('');
    console.log(`  For the record, these were never on Render at freeze time: ${state.cronsNotFound.join(', ')}`);
  }

  if (!confirm) {
    console.log('');
    line('=');
    console.log('PLAN ONLY — NOTHING WAS CHANGED.');
    console.log('To resume:   node migration/01-unfreeze.mjs --confirm');
    line('=');
    return 0;
  }

  if (signingRisk && !iKnow) {
    console.error('');
    line('=');
    console.error('REFUSING TO RESUME: the signing-key check above failed.');
    console.error('  Restore the HMAC key to the value it had before the move — the one whose');
    console.error('  fingerprint is printed above — then re-run and confirm the two fingerprints');
    console.error('  match. If you have already handled this another way, re-run with --i-know');
    console.error('  to override. Overriding wrongly is silent and not reversible for links');
    console.error('  already in customers\' hands.');
    line('=');
    return 1;
  }

  // 6. Resume
  section('RESUMING');
  let failures = 0;
  const resumeLog = [];
  for (const item of plan) {
    if (item.action !== 'RESUME') {
      resumeLog.push({ id: item.entry.id, name: item.entry.name, action: item.action, reason: item.reason });
      continue;
    }
    console.log(`  RESUME  ${item.entry.name} (${item.entry.id}) ...`);
    try {
      const res = await render.post(`/services/${item.entry.id}/resume`);
      const at = new Date().toISOString();
      if (res.ok) {
        console.log(`          OK (HTTP ${res.status}) at ${at}`);
      } else {
        failures += 1;
        console.error(`          FAILED (HTTP ${res.status}): ${res.text}`);
      }
      resumeLog.push({ id: item.entry.id, name: item.entry.name, action: 'RESUME', ok: res.ok, httpStatus: res.status, at, detail: res.ok ? null : res.text });
    } catch (err) {
      failures += 1;
      console.error(`          FAILED: ${err.message}`);
      resumeLog.push({ id: item.entry.id, name: item.entry.name, action: 'RESUME', ok: false, httpStatus: null, at: new Date().toISOString(), detail: err.message });
    }
  }

  const saveState = () => {
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    } catch (err) {
      console.error(`  WARNING: could not update the state file: ${err.message}`);
    }
  };

  state.resume = {
    at: new Date().toISOString(),
    healthUrl,
    services: resumeLog,
    signingRiskOverridden: signingRisk && iKnow,
    supabaseProjectRefAtResume: envInfo.available ? envInfo.supabaseProjectRef : null,
    signingKeyAtResume: envInfo.available ? envInfo.signingKey : null,
    verification: null,
  };
  state.resumedAt = failures ? null : state.resume.at;
  saveState();

  if (failures) {
    console.error('');
    console.error(`ERROR: ${failures} resume call(s) failed. THE CRM IS STILL DOWN.`);
    console.error('  Resume the service by hand in the Render dashboard, then re-run this script.');
    return 2;
  }

  if (skipHealth) {
    section('RESULT');
    console.log(`  resumed : ${resumeLog.filter((r) => r.ok).length} service(s)`);
    console.log('  --skip-health given, so recovery was not verified.');
    console.log(`  Check it yourself: ${healthUrl}`);
    return 0;
  }

  if (!toResume.length) {
    section('RESULT');
    console.log('  Nothing needed resuming. No changes were made.');
    return 0;
  }

  // 7. Verify recovery
  section('VERIFYING RECOVERY');
  console.log(`Polling ${healthUrl} every ${pollSec}s for up to ${timeoutSec}s.`);
  console.log('');
  const startedAt = Date.now();
  const deadline = startedAt + timeoutSec * 1000;
  let probes = 0;
  let last = null;
  let back = false;
  while (Date.now() < deadline) {
    probes += 1;
    last = await probeHealth(healthUrl);
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`  [${String(elapsed).padStart(4)}s] probe ${probes}: ${last.answering ? 'UP' : 'not yet'} — HTTP ${last.status}, ${last.detail}${last.uptime !== null ? `, uptime=${last.uptime}s` : ''}`);
    if (last.answering) { back = true; break; }
    await sleep(pollSec * 1000);
  }

  const elapsedMs = Date.now() - startedAt;
  state.resume.verification = {
    back,
    probes,
    lastStatus: last?.status ?? null,
    lastDetail: last?.detail ?? null,
    release: last?.release ?? null,
    uptimeSec: last?.uptime ?? null,
    elapsedMs,
    timeoutSec,
  };
  saveState();

  section('RESULT');
  console.log(`  resumed       : ${resumeLog.filter((r) => r.ok).length} service(s)`);
  for (const r of resumeLog.filter((x) => x.ok)) console.log(`                  - ${r.name} (${r.id})`);
  const skipped = resumeLog.filter((r) => r.action === 'SKIP');
  if (skipped.length) {
    console.log(`  left as-is    : ${skipped.length} service(s)`);
    for (const r of skipped) console.log(`                  - ${r.name} (${r.id}) — ${r.reason}`);
  }
  console.log(`  health probes : ${probes} in ${Math.round(elapsedMs / 1000)}s`);
  console.log(`  API answering : ${back ? `YES (release ${last?.release || 'n/a'}, uptime ${last?.uptime ?? '?'}s)` : 'NO'}`);
  console.log(`  state file    : ${stateFile}`);

  if (!back) {
    console.error('');
    line('=');
    console.error('WARNING: the service was resumed but never answered within the timeout.');
    console.error('  Most likely cause: server/db.js initDb() failed to hydrate one of the 103');
    console.error('  tables, so the process throws and exits on every boot and Render crash-loops.');
    console.error('  Open the Render logs for the service and look for the hydration error before');
    console.error('  changing anything else.');
    line('=');
    return 3;
  }

  console.log('');
  line('=');
  console.log('THE API IS BACK. Writes reach Supabase again.');
  console.log('  If this was a cutover, confirm next that the client on Vercel was rebuilt with');
  console.log('  the new VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — those are inlined at BUILD');
  console.log('  time, so an old build still talks to the old project no matter what the API does.');
  line('=');
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error('');
    console.error('UNEXPECTED FAILURE:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    process.exitCode = 1;
  });
