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
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_SENDS_PER_WINDOW = 4;
const SEND_WINDOW_MS = 15 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(phone, code) {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

/** Both stores keyed by the normalized phone — the caller normalizes. */
export function createOtpService({ now = () => Date.now() } = {}) {
  const codes = new Map(); // phone -> { hash, expiresAt, attempts, sends: [ts], lastSentAt }
  const tokens = new Map(); // token -> { phone, expiresAt }

  function sweep() {
    const t = now();
    for (const [phone, entry] of codes) {
      if (entry.expiresAt < t && (!entry.sends.length || entry.sends[entry.sends.length - 1] < t - SEND_WINDOW_MS)) {
        codes.delete(phone);
      }
    }
    for (const [token, entry] of tokens) {
      if (entry.expiresAt < t) tokens.delete(token);
    }
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
      const token = crypto.randomUUID() + crypto.randomBytes(8).toString('hex');
      tokens.set(token, { phone, expiresAt: t + TOKEN_TTL_MS });
      return { token };
    },

    /**
     * Redeems a token at submit time. Single-use, and bound to the phone the
     * form is being submitted with — a token for one number says nothing about
     * another.
     */
    consumeToken(token, phone) {
      sweep();
      const entry = tokens.get(String(token || ''));
      if (!entry || entry.expiresAt < now() || entry.phone !== phone) return false;
      tokens.delete(String(token || ''));
      return true;
    },
  };
}
