// Every customer the bot talked to in a date range, one thread after another,
// so a person can read what it actually said.
//
// Read-only. Run from the server folder:
//   node scripts/reviewConversations.js 2026-08-09

import 'dotenv/config';
import { supa } from '../supa.js';

const since = String(process.argv[2] || '').trim() || new Date().toISOString().slice(0, 10);
const skip = new Set(String(process.argv[3] || '').split(',').map((s) => s.trim()).filter(Boolean));

const [messages, parents] = await Promise.all([
  supa.getAll('messages'),
  supa.getAll('parents'),
]);

const byPhone = new Map();
for (const m of messages || []) {
  const phone = String(m.phone || '');
  if (!phone) continue;
  if (String(m.created_at || '') < since) continue;
  if (!byPhone.has(phone)) byPhone.set(phone, []);
  byPhone.get(phone).push(m);
}

const nameOf = (phone) => (parents || []).find(
  (p) => String(p.phone || '').replace(/\D/g, '').endsWith(String(phone).replace(/\D/g, '').slice(-9))
)?.name || '';

const threads = [...byPhone.entries()]
  // Only conversations the bot took part in — a lone OTP is not a conversation.
  .filter(([, list]) => list.some((m) => m.is_ai))
  .filter(([phone]) => !skip.has(phone))
  .sort((a, b) => b[1].length - a[1].length);

console.log(`${threads.length} conversations with bot replies since ${since}\n`);
for (const [phone, list] of threads) {
  console.log(`\n${'='.repeat(70)}\n${nameOf(phone) || '(ללא שם)'}  ${phone}  — ${list.length} הודעות`);
  for (const m of list.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    const at = String(m.created_at || '').slice(5, 16).replace('T', ' ');
    const who = m.direction === 'inbound'
      ? 'לקוח'
      : `${m.is_ai ? 'בוט' : 'אדם'}/${m.source || ''}`;
    if (String(m.source || '') === 'otp') continue;
    console.log(`${at} ${who.padEnd(14)} ${String(m.message || '').replace(/\n/g, ' ⏎ ').slice(0, 400)}`);
  }
}
