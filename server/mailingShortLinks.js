/**
 * קישור מקוצר וקבוע לעמוד העדפות הדיוור של לקוח.
 *
 * The signed preferences token is ~180 characters — in WhatsApp it arrives as
 * four lines of noise. Instead each parent gets one short random code, stored
 * once, and `/api/mp/<code>` mints a fresh signed token at click time and
 * redirects to the page. The code is random (not the parent id), so a link
 * cannot be guessed, and it never expires — the token it redirects to is
 * created fresh on every click.
 */

import crypto from 'crypto';
import { db } from './db.js';
import { appPublicBase } from './publicLinks.js';

const TABLE = 'short_links';
const KIND = 'mailing_prefs';

export function getOrCreateMailingShortCode(parent) {
  if (!parent?.id) return '';
  const rows = db.get(TABLE) || [];
  const existing = rows.find((r) => r.kind === KIND && r.parentId === parent.id);
  if (existing) return existing.id;

  let code = '';
  do {
    code = crypto.randomBytes(6).toString('base64url');
  } while (rows.some((r) => r.id === code));
  db.insert(TABLE, { id: code, kind: KIND, parentId: parent.id });
  return code;
}

/** הקישור שנשלח ללקוח: קצר, על הדומיין המוכר. */
export function shortMailingPreferencesUrl(parent) {
  const code = getOrCreateMailingShortCode(parent);
  if (!code) return '';
  return `${appPublicBase()}/api/mp/${code}`;
}

/** From a clicked code back to the customer card, or null. */
export function resolveMailingShortCode(code) {
  const clean = String(code || '').trim();
  if (!clean) return null;
  const row = (db.get(TABLE) || []).find((r) => r.id === clean && r.kind === KIND);
  if (!row) return null;
  return (db.get('parents') || []).find((p) => p.id === row.parentId) || null;
}
