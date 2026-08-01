/**
 * One-time codes that tie a form submission to possession of the phone.
 *
 * The public onboarding form asks for a phone number and, on it, a signature
 * that releases liability. Until now nothing showed the person typing was the
 * person whose number it is. The code closes that gap: it is sent to the
 * number over WhatsApp, typed back into the form, and the declaration is filed
 * carrying "verified at" — evidence, not decoration.
 *
 * Everything lives in memory on purpose. A code is worth five minutes; writing
 * it to the durable store would only create a place for stale secrets to
 * accumulate. A server restart forgets pending codes, and the person asks for
 * a new one — the failure mode is a resend, never a leak.
 */

import crypto from 'crypto';

const CODE_TTL_MS = 5 * 60 * 1000;
// The token is earned on step 1 and spent at submit, with the whole form in
// between — health questions per child, a doctor's approval to photograph, a
// signature. Nothing is filed without it, so a token that lapses mid-form
// fails the family after they have already signed. Hours, not minutes.
const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * Tokens are signed rather than stored.
 *
 * They used to be rows in a Map, which meant a deploy in the middle of
 * someone's registration threw their verification away — and deploys happen
 * during the working day. A signed token carries its own phone and expiry, so
 * it survives a restart, and it cannot be forged without the key.
 *
 * The key is derived from a secret the server already holds, so this needs no
 * new configuration to be stable across restarts and instances. The domain
 * string keeps it from being the same key material as anything else.
 */
// Module level, so every service in one process shares it: without a secret to
// derive from, tokens should die with the process, not with each instance.
const FALLBACK_TOKEN_KEY = crypto.randomBytes(32);

function tokenKey(secret) {
  const source = secret
    || process.env.OTP_TOKEN_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.META_WA_ACCESS_TOKEN
    || '';
  if (!source) return FALLBACK_TOKEN_KEY;
  return crypto.createHmac('sha256', 'crm.otp.submission-token.v1').update(source).digest();
}
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_SENDS_PER_WINDOW = 4;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(phone, code) {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

/** Codes are keyed by the normalized phone — the caller normalizes. */
export function createOtpService({ now = () => Date.now(), secret = '' } = {}) {
  const codes = new Map(); // phone -> { hash, expiresAt, attempts, sends: [ts], lastSentAt }
  const key = tokenKey(secret);
  // Best-effort replay guard. A restart empties it and a token becomes
  // reusable until it expires — a duplicate registration by the same verified
  // person, which staff can see, and far better than the alternative of
  // throwing away the verification of everyone mid-form.
  const spent = new Set();

  function sweep() {
    const t = now();
    for (const [phone, entry] of codes) {
      if (entry.expiresAt < t && (!entry.sends.length || entry.sends[entry.sends.length - 1] < t - SEND_WINDOW_MS)) {
        codes.delete(phone);
      }
    }
  }

  function signToken(phone, expiresAt) {
    const body = `${phone}.${expiresAt}`;
    const mac = crypto.createHmac('sha256', key).update(body).digest('base64url');
    return `${Buffer.from(body).toString('base64url')}.${mac}`;
  }

  /** Valid, unexpired, and for this phone — without spending it. */
  function readToken(token, phone) {
    const raw = String(token || '');
    const [encoded, mac] = raw.split('.');
    if (!encoded || !mac) return null;
    let body;
    try {
      body = Buffer.from(encoded, 'base64url').toString();
    } catch {
      return null;
    }
    const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
    const macBuf = Buffer.from(mac);
    const expectedBuf = Buffer.from(expected);
    if (macBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(macBuf, expectedBuf)) return null;

    const separator = body.lastIndexOf('.');
    const tokenPhone = body.slice(0, separator);
    const expiresAt = Number(body.slice(separator + 1));
    if (!expiresAt || expiresAt < now()) return null;
    if (tokenPhone !== phone) return null;
    return { phone: tokenPhone, expiresAt };
  }

  return {
    /**
     * A fresh code for this phone, or the reason there is none.
     * The code itself is returned to the caller for sending and never stored.
     */
    issueCode(phone) {
      sweep();
      const t = now();
      const entry = codes.get(phone) || { attempts: 0, sends: [] };
      entry.sends = entry.sends.filter((ts) => ts > t - SEND_WINDOW_MS);
      if (entry.lastSentAt && t - entry.lastSentAt < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - (t - entry.lastSentAt)) / 1000);
        return { error: `אפשר לבקש קוד חדש בעוד ${wait} שניות` };
      }
      if (entry.sends.length >= MAX_SENDS_PER_WINDOW) {
        return { error: 'נשלחו יותר מדי קודים למספר הזה — נסו שוב מאוחר יותר' };
      }
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      entry.hash = hashCode(phone, code);
      entry.expiresAt = t + CODE_TTL_MS;
      entry.attempts = 0;
      entry.lastSentAt = t;
      entry.sends.push(t);
      codes.set(phone, entry);
      return { code };
    },

    /** Verifies a typed code; success returns a single-use submission token. */
    verifyCode(phone, code) {
      sweep();
      const t = now();
      const entry = codes.get(phone);
      if (!entry || !entry.hash || entry.expiresAt < t) {
        return { error: 'הקוד פג תוקף — בקשו קוד חדש' };
      }
      if (entry.attempts >= MAX_VERIFY_ATTEMPTS) {
        return { error: 'יותר מדי ניסיונות — בקשו קוד חדש' };
      }
      entry.attempts += 1;
      if (hashCode(phone, String(code || '').trim()) !== entry.hash) {
        return { error: 'הקוד שגוי — בדקו ונסו שוב' };
      }
      // Spent: the same code must not verify a second submission.
      entry.hash = null;
      return { token: signToken(phone, t + TOKEN_TTL_MS) };
    },

    /**
     * Is this submission allowed to proceed? Asked at the top of the route,
     * before any work is done, and it does not spend the token — a submission
     * refused later for a missing birth date has to be fixable by sending it
     * again, not by verifying the phone from scratch.
     */
    checkToken(token, phone) {
      if (!readToken(token, phone)) return false;
      return !spent.has(String(token || ''));
    },

    /**
     * Spends the token, once the submission it authorised has actually been
     * filed. Bound to the phone the form was submitted with — a token for one
     * number says nothing about another.
     */
    consumeToken(token, phone) {
      if (!this.checkToken(token, phone)) return false;
      spent.add(String(token || ''));
      return true;
    },
  };
}
