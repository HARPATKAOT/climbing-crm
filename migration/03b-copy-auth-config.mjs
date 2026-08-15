#!/usr/bin/env node
/**
 * 03b-copy-auth-config.mjs — copy the Auth dashboard settings from the old
 * project to the new one.
 *
 * These settings are not in the database, so a restore does not carry them: a
 * new project starts with an empty redirect allow-list, default email
 * templates and Supabase's default password policy. The runbook originally had
 * this as twenty minutes of retyping across two browser tabs, which is both
 * slow and exactly the kind of step where one forgotten field turns into
 * "password reset stopped working" a week later.
 *
 * WHAT IT COPIES: an explicit allow-list of fields, grouped below. The auth
 * config endpoint returns 242 keys and most of them are platform defaults or
 * read-only; sending all of them back would be noise at best and a rejected
 * request at worst. Every group here is something an operator could plausibly
 * have changed and would miss if it vanished.
 *
 * WHAT IT CANNOT COPY: secrets. The API never returns an SMTP password, a
 * Twilio auth token or a captcha secret — it returns them empty or masked. If
 * the source has such a provider enabled, this script says so by name and
 * refuses to claim the copy is complete.
 *
 * WHAT IT DELIBERATELY SKIPS: the `hook_*` URIs. Those point at endpoints that
 * may be project-scoped, and copying a URL that references the old project is
 * how you get a setting that looks right and behaves wrong.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OLD_REF = 'xaxykjvqqhrodmseqleu';
const API = 'https://api.supabase.com/v1';

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const CONFIRM = flag('confirm');
const SOURCE_REF = opt('source', OLD_REF);
const ENV_FILE = opt('env-file', process.env.ENV_FILE || path.join(REPO, 'server', '.env'));
const TARGET_REF = opt('target', process.env.NEW_PROJECT_REF || '');

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
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;

const fail = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };
const say = (m) => console.log(m);

if (!TOKEN) fail(`SUPABASE_ACCESS_TOKEN not found in ${ENV_FILE} or the environment.`);
if (!TARGET_REF) fail('pass --target <new project ref>, or set NEW_PROJECT_REF.');
if (TARGET_REF === SOURCE_REF && CONFIRM) {
  fail('source and target are the same project — nothing to copy, and --confirm would be a no-op write.');
}

// ── the allow-list ──────────────────────────────────────────────────────────
/** Field groups, in the order a human would think about them. */
const GROUPS = [
  {
    name: 'Site URL and redirects',
    why: 'without these, password-reset and invite links bounce',
    fields: ['site_url', 'uri_allow_list', 'jwt_exp'],
  },
  {
    name: 'Signup and email',
    fields: [
      'disable_signup', 'mailer_autoconfirm', 'external_email_enabled',
      'external_phone_enabled', 'external_anonymous_users_enabled',
      'mailer_otp_exp', 'mailer_otp_length', 'smtp_max_frequency',
      'mailer_secure_email_change_enabled',
    ],
  },
  {
    name: 'Email subjects and templates',
    why: 'a new project ships Supabase defaults in English',
    // Expanded at runtime from whatever the source actually has.
    prefixes: ['mailer_subjects_', 'mailer_templates_'],
  },
  {
    name: 'SMTP',
    why: 'the password is never readable — it must be typed by hand if a host is set',
    fields: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_admin_email', 'smtp_sender_name'],
    secretFields: ['smtp_pass'],
    activeWhen: (src) => Boolean(src.smtp_host),
  },
  {
    name: 'Password policy',
    fields: [
      'password_min_length', 'password_required_characters', 'password_hibp_enabled',
      'security_update_password_require_reauthentication',
      'security_update_password_require_current_password',
    ],
  },
  {
    name: 'Sessions and refresh tokens',
    fields: [
      'refresh_token_rotation_enabled', 'security_refresh_token_reuse_interval',
      'sessions_timebox', 'sessions_inactivity_timeout', 'sessions_single_per_user',
      'security_manual_linking_enabled',
    ],
  },
  {
    name: 'Multi-factor',
    fields: [
      'mfa_totp_enroll_enabled', 'mfa_totp_verify_enabled', 'mfa_max_enrolled_factors',
      'mfa_web_authn_enroll_enabled', 'mfa_web_authn_verify_enabled',
    ],
  },
  {
    name: 'Rate limits',
    prefixes: ['rate_limit_'],
  },
  {
    name: 'SMS',
    why: 'the Twilio auth token is never readable — type it by hand if SMS is in use',
    fields: ['sms_provider', 'sms_template', 'sms_otp_exp', 'sms_otp_length', 'sms_max_frequency', 'sms_autoconfirm'],
    secretFields: ['sms_twilio_auth_token', 'sms_twilio_account_sid', 'sms_messagebird_access_key', 'sms_vonage_api_secret'],
    activeWhen: (src) => src.external_phone_enabled === true,
  },
  {
    name: 'Captcha',
    why: 'the captcha secret is never readable',
    fields: ['security_captcha_enabled', 'security_captcha_provider'],
    secretFields: ['security_captcha_secret'],
    activeWhen: (src) => src.security_captcha_enabled === true,
  },
];

// ── api ─────────────────────────────────────────────────────────────────────
async function getAuthConfig(ref) {
  const r = await fetch(`${API}/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) fail(`GET auth config for ${ref} returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function patchAuthConfig(ref, body) {
  const r = await fetch(`${API}/projects/${ref}/config/auth`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text };
}

/** Short, single-line, never more than a glance. */
function preview(v) {
  if (v === null || v === undefined || v === '') return '(empty)';
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 58 ? `${s.slice(0, 55)}…` : s;
}

// ── main ────────────────────────────────────────────────────────────────────
say('');
say('  03b-copy-auth-config — Auth dashboard settings, old project to new');
say('  ──────────────────────────────────────────────────────────────────');
say('');
say(`  source  ${SOURCE_REF}`);
say(`  target  ${TARGET_REF}`);

const src = await getAuthConfig(SOURCE_REF);
const dst = await getAuthConfig(TARGET_REF);

const payload = {};
const manual = [];
let unchanged = 0;

for (const group of GROUPS) {
  if (group.activeWhen && !group.activeWhen(src)) {
    say('');
    say(`  ── ${group.name}: not in use on the source, skipping`);
    continue;
  }

  const fields = group.prefixes
    ? Object.keys(src).filter((k) => group.prefixes.some((p) => k.startsWith(p)))
    : group.fields;

  const changes = [];
  for (const f of fields) {
    if (!(f in src)) continue;
    // `custom_contents` come back as objects the PATCH body does not accept.
    if (typeof src[f] === 'object' && src[f] !== null) continue;
    if (JSON.stringify(src[f]) === JSON.stringify(dst[f])) { unchanged++; continue; }
    payload[f] = src[f];
    changes.push([f, dst[f], src[f]]);
  }

  say('');
  say(`  ── ${group.name}${group.why ? ` — ${group.why}` : ''}`);
  if (!changes.length) {
    say('     already matches');
  } else {
    for (const [f, from, to] of changes) {
      say(`     ${f}`);
      say(`       target now : ${preview(from)}`);
      say(`       will become: ${preview(to)}`);
    }
  }

  for (const s of group.secretFields || []) {
    manual.push(`${s}  (${group.name})`);
  }
}

say('');
say(`  ${Object.keys(payload).length} field(s) to change, ${unchanged} already identical`);

if (manual.length) {
  say('');
  say('  NOT COPYABLE — the API never returns these. Type them into the new');
  say('  project by hand, or the feature they belong to stays broken:');
  for (const m of manual) say(`    · ${m}`);
}

if (!Object.keys(payload).length) {
  say('');
  say('  Nothing to do.');
  say('');
  process.exit(0);
}

if (!CONFIRM) {
  say('');
  say('  DRY RUN — nothing was written. Re-run with --confirm to apply.');
  say('');
  process.exit(0);
}

say('');
process.stdout.write('  applying … ');
const res = await patchAuthConfig(TARGET_REF, payload);
if (!res.ok) {
  say('FAILED');
  fail(`PATCH returned ${res.status}: ${res.text.slice(0, 500)}`);
}
say('ok');

// ── verify by reading it back ───────────────────────────────────────────────
say('');
say('  reading the target back to confirm each field landed:');
const after = await getAuthConfig(TARGET_REF);
let bad = 0;
for (const [f, want] of Object.entries(payload)) {
  const got = after[f];
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  say(`    ${ok ? '✓' : '✗'} ${f}${ok ? '' : `  — target holds ${preview(got)}`}`);
}

say('');
if (bad) {
  say(`  ${bad} field(s) did not take. Set those by hand before cutting over.`);
} else {
  say('  every field verified against the target.');
}
say('');
process.exit(bad ? 2 : 0);
