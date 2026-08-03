/**
 * The follow-up the bot sends once the free-text window has closed.
 *
 * A short follow-up ("check with me tomorrow") is scheduled 23 hours after the
 * customer's last message, so it lands while Meta still allows free text and
 * costs nothing. A long one — "let's talk in September" — cannot: by then the
 * window has been shut for weeks, and without a template the promise quietly
 * became a note to the team instead of a message to the customer.
 *
 * UTILITY, not MARKETING: this continues a conversation the customer asked us
 * to continue, on the subject they named. That is also why {{2}} carries their
 * own words back — a follow-up that cannot say what it is about reads as spam.
 *
 * Run from the server folder:
 *   node scripts/createFollowUpTemplate.js          show what would happen
 *   node scripts/createFollowUpTemplate.js --apply  create and submit to Meta
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import { createDraftTemplate, submitTemplateToMeta } from '../channels/templates.js';

const APPLY = process.argv.includes('--apply');

export const FOLLOWUP_TEMPLATE_NAME = 'bot_followup_v1';

/** {{1}} is the customer's first name, {{2}} the subject they asked about. */
export const FOLLOWUP_TEMPLATE = {
  name: 'מעקב הבוט · חזרה ללקוח',
  meta_name: FOLLOWUP_TEMPLATE_NAME,
  language: 'he',
  category: 'UTILITY',
  tag: 'מעקב',
  usage: 'נשלח אוטומטית כשהבוט הבטיח לחזור ללקוח וחלון 24 השעות כבר סגור.',
  body: [
    'היי {{1}}, חוזרים אליכם כמו שסיכמנו 🙂',
    'לגבי {{2}} — יש התקדמות, או שנוכל לעזור במשהו?',
    'אפשר פשוט להשיב להודעה הזו.',
  ].join('\n'),
  footer: '',
  header: '',
  variables: [
    { key: '1', field: 'parent_name', label: 'שם הלקוח', example: 'דנה' },
    { key: '2', field: 'custom', label: 'הנושא שסוכם', example: 'ההרשמה של לילי לחוג' },
  ],
  body_examples: ['דנה', 'ההרשמה של לילי לחוג'],
  buttons: [],
};

async function main() {
  await initDb();

  const existing = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === FOLLOWUP_TEMPLATE_NAME
  );
  console.log('template already present:', existing ? `${existing.id} (${existing.status})` : 'no');

  if (!APPLY) {
    console.log('\n--- dry run, nothing was changed ---');
    console.log(FOLLOWUP_TEMPLATE.body);
    console.log('\nrun again with --apply to create it and submit it to Meta.');
    return;
  }

  const template = existing || createDraftTemplate(FOLLOWUP_TEMPLATE);
  if (!existing) {
    await persistCore('message_templates', template);
    console.log('created draft:', template.id);
  }

  const submitted = await submitTemplateToMeta(template.id);
  console.log('submitted to Meta:', JSON.stringify(submitted));
  console.log('\nMeta reviews it — usually minutes, sometimes a day. Until it is');
  console.log('APPROVED the bot keeps handing long follow-ups to the team.');
}

// Only run when invoked directly: the server imports the name from this file.
if (process.argv[1] && process.argv[1].endsWith('createFollowUpTemplate.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
