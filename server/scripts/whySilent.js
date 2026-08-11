// For a customer whose last message got no reply: what state the card was in,
// and what the bot would have decided. Read-only.
//
//   node scripts/whySilent.js 972547794165 972543973623 …

import 'dotenv/config';
import { supa } from '../supa.js';

const wanted = process.argv.slice(2).map((p) => String(p).replace(/\D/g, ''));
const [parents, messages] = await Promise.all([supa.getAll('parents'), supa.getAll('messages')]);

const tail = (phone) => (messages || [])
  .filter((m) => String(m.phone || '').replace(/\D/g, '').endsWith(phone.slice(-9)))
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  .slice(-6);

for (const phone of wanted) {
  const card = (parents || []).find((p) => String(p.phone || '').replace(/\D/g, '').endsWith(phone.slice(-9)));
  const thread = tail(phone);
  const last = thread[thread.length - 1];
  const lastOutbound = [...thread].reverse().find((m) => m.direction === 'outbound');
  const reasons = [];
  if (!card) reasons.push('אין כרטיס');
  if (card?.bot_opted_out) reasons.push('הלקוח ביקש להפסיק');
  if (card?.bot_paused_until && Date.parse(card.bot_paused_until) > Date.parse(last?.created_at || '')) {
    reasons.push(`מושתק עד ${card.bot_paused_until} (${card.bot_pause_reason || ''})`);
  }
  if (card?.bot_handoff_at && (!lastOutbound || Date.parse(lastOutbound.created_at) <= Date.parse(card.bot_handoff_at))) {
    reasons.push('הועבר לצוות ואיש לא ענה מאז');
  }
  if (lastOutbound && !lastOutbound.is_ai && !['automation', 'template', 'otp'].includes(String(lastOutbound.source || ''))) {
    reasons.push(`ההודעה האחרונה נשלחה בידי אדם (${lastOutbound.source || ''}) — הבוט נסוג`);
  }
  console.log(`\n${card?.name || '(ללא שם)'}  ${phone}`);
  console.log(`  אחרונה מהלקוח: "${String(last?.message || '').slice(0, 60)}" (${String(last?.created_at || '').slice(5, 16)})`);
  console.log(`  ${reasons.length ? reasons.join(' · ') : '❓ אין סיבה בכרטיס — צריך לבדוק בלוג'}`);
}
