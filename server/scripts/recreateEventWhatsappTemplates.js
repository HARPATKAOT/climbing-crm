/**
 * Delete broken event WhatsApp templates (localhost button URLs) and recreate
 * drafts pointed at the live app, then submit them to Meta for approval.
 *
 * Run from the server folder:
 *   node scripts/recreateEventWhatsappTemplates.js
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import { deleteLocalTemplate, submitTemplateToMeta } from '../channels/templates.js';
import {
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  publicBase,
  recreateEventWhatsappTemplates,
} from '../eventWhatsappTemplates.js';

const LIVE = publicBase(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || '');

async function main() {
  console.log(`public app base: ${LIVE}`);
  await initDb();

  const result = await recreateEventWhatsappTemplates({
    db,
    persist: persistCore,
    publicAppBase: LIVE,
    deleteTemplate: deleteLocalTemplate,
  });

  console.log('deleted:', result.deleted);
  console.log('host button:', result.hostPayment?.buttons?.[0]?.url);
  console.log('participant button:', result.participantLink?.buttons?.[0]?.url);

  const submitted = [];
  for (const id of [result.hostPayment.id, result.participantLink.id]) {
    const updated = await submitTemplateToMeta(id);
    submitted.push({
      id: updated.id,
      meta_name: updated.meta_name || updated.name,
      status: updated.status,
    });
    console.log(`submitted ${updated.meta_name || updated.name}: ${updated.status}`);
  }

  // Give fire-and-forget Meta deletes / upserts a moment to land in Supabase.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const check = (db.get('message_templates') || []).filter((t) =>
    [EVENT_HOST_PAYMENT_TEMPLATE, EVENT_PARTICIPANT_LINK_TEMPLATE].includes(
      t.meta_name || t.name
    )
  );
  console.log('local templates now:', check.map((t) => ({
    id: t.id,
    meta_name: t.meta_name,
    status: t.status,
    button: t.buttons?.[0]?.url,
  })));
  console.log('done', { submitted });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
