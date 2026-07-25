// Resilience check for the conversation store, run against the real durable store.
// Simulates a cold start: hydrate from Supabase, rebuild the local mirror, then
// confirm every customer waiting in the handling queue has a visible conversation.
//
// Read-only — it never sends a message and never creates a customer.
//
// Run from the server folder:
//   node scripts/verifyConversationStore.js
//   node scripts/verifyConversationStore.js 0508862878   (focus on one phone)

import 'dotenv/config';
import { db, initDb } from '../db.js';
import { supa } from '../supa.js';
import {
  rebuildLogMirrorFromMessages,
  countPendingMessages,
} from '../channels/messageStore.js';
import { getConversation, isAwaitingHandling } from '../channels/conversations.js';

const focusPhone = process.argv[2] || '';

function lastInboundOf(messages) {
  return [...messages].reverse().find((m) => m.direction === 'inbound');
}

async function main() {
  const store = await supa.ping();
  console.log(
    store.ok
      ? `durable store: reachable in ${store.ms}ms`
      : `durable store: UNREACHABLE (${store.error})`
  );
  if (!store.ok) process.exit(1);
  console.log(`service role key in use: ${supa.hasServiceRoleKey() ? 'yes' : 'no'}`);

  // Cold start.
  await initDb();
  const mirrored = rebuildLogMirrorFromMessages();
  console.log(
    `after restart: ${(db.get('messages') || []).length} durable message(s), ` +
    `${mirrored} rebuilt into the conversation mirror, ` +
    `${countPendingMessages()} waiting to be stored`
  );

  const parents = db.get('parents') || [];
  const queue = parents.filter((p) => isAwaitingHandling(p));
  console.log(`customers waiting for handling: ${queue.length}`);

  const targets = focusPhone
    ? parents.filter((p) => {
      const tail = String(p.phone || '').replace(/\D/g, '').slice(-9);
      return tail && tail === focusPhone.replace(/\D/g, '').slice(-9);
    })
    : queue;

  const empty = [];
  for (const parent of targets) {
    const conversation = await getConversation(parent.id);
    const messages = conversation.messages || [];
    const inbound = lastInboundOf(messages);
    console.log(
      `\n${parent.name || 'ללא שם'} (${parent.phone}) — ${messages.length} message(s)`
    );
    if (inbound) {
      console.log(`  last inbound: ${inbound.created_at} — ${String(inbound.message).slice(0, 60)}`);
    } else {
      console.log('  last inbound: none in the conversation');
    }
    if (!messages.length || !inbound) empty.push(parent);
  }

  if (empty.length) {
    console.error(
      `\n✖ ${empty.length} customer(s) sit in the queue without a visible inbound message:`
    );
    for (const parent of empty) console.error(`  ${parent.name || parent.id} (${parent.phone})`);
    process.exit(1);
  }

  console.log('\n✔ Every checked customer has their conversation available after a restart.');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
