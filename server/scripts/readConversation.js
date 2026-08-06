// Print one customer's WhatsApp thread from the durable store, exactly as the
// bot saw it: direction, who wrote it, and the flags the gate reads.
//
// Read-only. Run from the server folder:
//   node scripts/readConversation.js 0508862878

import 'dotenv/config';
import { supa } from '../supa.js';
import { normalizeWaPhone, phonesMatch } from '../whatsappConnect.js';

const wanted = normalizeWaPhone(process.argv[2] || '') || process.argv[2];
if (!wanted) {
  console.error('usage: node scripts/readConversation.js <phone>');
  process.exit(1);
}

const messages = (await supa.getAll('messages')) || [];
const thread = messages
  .filter((m) => phonesMatch(m.phone || '', wanted))
  .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

console.log(`${thread.length} messages for ${wanted}\n`);
for (const m of thread) {
  const at = String(m.created_at || '').slice(11, 19);
  const who = m.direction === 'inbound'
    ? 'לקוח'
    : `${m.is_ai ? 'בוט' : 'אדם'}${m.source ? `/${m.source}` : ''}`;
  const flags = [m.status, m.message_type !== 'text' ? m.message_type : ''].filter(Boolean).join(' ');
  console.log(`${at}  ${who.padEnd(16)} ${flags.padEnd(12)} ${String(m.message || '').replace(/\n/g, ' ⏎ ')}`);
}

const parents = (await supa.getAll('parents')) || [];
for (const p of parents.filter((row) => phonesMatch(row.phone || '', wanted))) {
  console.log('\ncard:', {
    id: p.id,
    name: p.name,
    lastName: p.lastName,
    bot_paused_until: p.bot_paused_until,
    bot_pause_reason: p.bot_pause_reason,
    bot_opted_out: p.bot_opted_out,
    bot_handoff_at: p.bot_handoff_at,
    bot_intake: p.bot_intake,
    last_inbound_whatsapp: p.last_inbound_whatsapp,
  });
}
