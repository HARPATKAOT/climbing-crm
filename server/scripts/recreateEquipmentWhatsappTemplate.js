/**
 * Replace the broken equipment payment template.
 *
 * The old `equipment_payment` template was approved with a localhost button, and
 * an approved button host cannot be edited at Meta. The replacement points at the
 * server redirect (`/e/:token`) instead, so the destination is resolved per click
 * and a future domain move never needs another approval.
 *
 * Run from the server folder:
 *   node scripts/recreateEquipmentWhatsappTemplate.js          list only
 *   node scripts/recreateEquipmentWhatsappTemplate.js --apply  delete + create + submit
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import { deleteLocalTemplate, submitTemplateToMeta } from '../channels/templates.js';
import {
  EQUIPMENT_TEMPLATE_NAME,
  EQUIPMENT_TEMPLATE_LEGACY_NAMES,
  ensureEquipmentWhatsappTemplate,
  equipmentRedirectBase,
} from '../equipmentService.js';

const APPLY = process.argv.includes('--apply');

function findByNames(names) {
  return (db.get('message_templates') || []).filter((t) =>
    names.includes(t.meta_name || t.name)
  );
}

function describe(t) {
  return {
    id: t.id,
    name: t.meta_name || t.name,
    status: t.status,
    active_for_send: t.active_for_send,
    button: t.buttons?.[0]?.url,
  };
}

async function main() {
  await initDb();
  console.log(`redirect base: ${equipmentRedirectBase()}`);

  const legacy = findByNames(EQUIPMENT_TEMPLATE_LEGACY_NAMES);
  console.log('\nold templates found:', legacy.length);
  legacy.forEach((t) => console.log('  ', JSON.stringify(describe(t))));

  const already = findByNames([EQUIPMENT_TEMPLATE_NAME]);
  console.log('replacement already present:', already.length);
  already.forEach((t) => console.log('  ', JSON.stringify(describe(t))));

  if (!APPLY) {
    console.log('\nlist only — re-run with --apply to delete, create and submit.');
    return;
  }

  for (const t of legacy) {
    // Approved templates are deleted at Meta too; drafts are local-only.
    await deleteLocalTemplate(t.id);
    console.log(`deleted: ${t.meta_name || t.name} (${t.id})`);
  }

  const created = ensureEquipmentWhatsappTemplate({ db, persist: persistCore });
  console.log('created:', JSON.stringify(describe(created)));

  if (String(created.status || '').toUpperCase() === 'DRAFT') {
    const submitted = await submitTemplateToMeta(created.id);
    console.log(`submitted: ${submitted.meta_name || submitted.name} -> ${submitted.status}`);
  } else {
    console.log(`not submitting — status is already ${created.status}`);
  }

  // Fire-and-forget Meta deletes / upserts need a moment to land in Supabase.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const finalRows = findByNames([...EQUIPMENT_TEMPLATE_LEGACY_NAMES, EQUIPMENT_TEMPLATE_NAME]);
  console.log('\ntemplates now:');
  finalRows.forEach((t) => console.log('  ', JSON.stringify(describe(t))));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
