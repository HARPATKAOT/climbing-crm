// One-off migration: move the WhatsApp log history out of kv_collections into the
// durable `messages` table, which is now the single source of truth for a conversation.
//
// Safe to run more than once: rows are matched by id and by Meta message id, and
// nothing is deleted from kv_collections.
//
// Run from the server folder:
//   node scripts/migrateLogsToMessages.js          (dry run — reports only)
//   node scripts/migrateLogsToMessages.js --apply  (writes to the durable store)

import 'dotenv/config';
import { supa } from '../supa.js';
import { normalizeMessage } from '../channels/messageStore.js';

const APPLY = process.argv.includes('--apply');

function parentIdForPhone(parents, phone) {
  if (!phone) return null;
  const variants = new Set(supa.phoneVariants(phone));
  const tail = String(phone).replace(/[^\d]/g, '').slice(-9);
  const match = parents.find((p) => {
    const parentPhone = String(p.phone || '');
    if (variants.has(parentPhone)) return true;
    const parentTail = parentPhone.replace(/[^\d]/g, '').slice(-9);
    return tail.length === 9 && parentTail === tail;
  });
  return match?.id || null;
}

async function main() {
  if (!supa.isEnabled()) {
    console.error('Supabase is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const [logs, messages, parents] = await Promise.all([
    supa.getAll('whatsapp_logs'),
    supa.getAll('messages'),
    supa.getAll('parents'),
  ]);

  if (logs === null || messages === null || parents === null) {
    console.error('Could not read the durable store — aborting without changes.');
    process.exit(1);
  }

  const parentIds = new Set(parents.map((p) => String(p.id)));
  const existingIds = new Set(messages.map((m) => String(m.id)));
  const existingMetaIds = new Set(
    messages.map((m) => m.meta_message_id).filter(Boolean).map(String)
  );

  const toWrite = [];
  let skipped = 0;
  let linked = 0;

  for (const log of logs) {
    const id = String(log.id ?? '');
    if (!id) { skipped += 1; continue; }
    if (existingIds.has(id)) { skipped += 1; continue; }
    if (log.meta_message_id && existingMetaIds.has(String(log.meta_message_id))) {
      skipped += 1;
      continue;
    }

    // A card that was merged away leaves a dead parent_id behind; re-resolve it
    // by phone so the foreign key cannot reject real history.
    const knownParentId = log.parent_id && parentIds.has(String(log.parent_id))
      ? log.parent_id
      : null;
    const parentId = knownParentId || parentIdForPhone(parents, log.phone);
    if (!knownParentId && parentId) linked += 1;

    const message = normalizeMessage({
      ...log,
      id,
      parent_id: parentId,
      template_name: log.template_name || log.template_id || null,
      media_type: log.media_type || log.message_type || 'text',
    });

    toWrite.push(message);
    existingIds.add(id);
    if (message.meta_message_id) existingMetaIds.add(String(message.meta_message_id));
  }

  console.log(
    `kv whatsapp_logs: ${logs.length} | messages already durable: ${messages.length}\n` +
    `to migrate: ${toWrite.length} | already present: ${skipped} | newly linked to a customer card: ${linked}`
  );

  if (!APPLY) {
    console.log('\nDry run only. Re-run with --apply to write these rows.');
    return;
  }

  let written = 0;
  const failures = [];
  for (const message of toWrite) {
    const result = await supa.upsert('messages', message);
    if (result?.ok === false) {
      failures.push({ id: message.id, error: result.error });
      continue;
    }
    written += 1;
    if (written % 100 === 0) console.log(`  … ${written}/${toWrite.length}`);
  }

  console.log(`\nMigrated ${written} message(s).`);
  if (failures.length) {
    console.error(`${failures.length} row(s) failed:`);
    for (const failure of failures.slice(0, 10)) {
      console.error(`  ${failure.id}: ${failure.error}`);
    }
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
