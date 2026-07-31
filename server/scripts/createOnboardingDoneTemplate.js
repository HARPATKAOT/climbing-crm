/**
 * The message a family gets the moment they finish the onboarding form.
 *
 * Until now they got nothing. A lead who has just filled in the form has never
 * written to us, so their 24-hour window is closed by definition — freeform is
 * impossible and the `new_lead` automation had no template to fall back on, so
 * every submission ended in silence and a manual call.
 *
 * UTILITY, not MARKETING: this confirms something the person just did, which is
 * what the category is for, and it delivers without a marketing opt-in.
 *
 * Run from the server folder:
 *   node scripts/createOnboardingDoneTemplate.js          show what would happen
 *   node scripts/createOnboardingDoneTemplate.js --apply  create, submit, wire up
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import { createDraftTemplate, submitTemplateToMeta } from '../channels/templates.js';

const APPLY = process.argv.includes('--apply');

export const ONBOARDING_DONE_TEMPLATE_NAME = 'onboarding_completed_v1';

/**
 * {{1}} is the parent, {{2}} the participant — the order the automation sends
 * them in via `templateVarKeys: ['parentName', 'name']`.
 */
export const ONBOARDING_DONE_TEMPLATE = {
  name: 'סיום מילוי טופס · אישור קליטה',
  meta_name: ONBOARDING_DONE_TEMPLATE_NAME,
  language: 'he',
  category: 'UTILITY',
  tag: 'קליטה',
  usage: 'נשלח אוטומטית מיד אחרי שמשפחה מסיימת את טופס ההצטרפות וההצהרה.',
  body: [
    'שלום {{1}},',
    'קיבלנו את הפרטים ואת הצהרת הבריאות של {{2}} — הכול נשמר במערכת.',
    'נחזור אליכם בהקדם לתיאום השיבוץ לחוג.',
    'אפשר להשיב להודעה הזו בכל שאלה.',
  ].join('\n'),
  footer: '',
  header: '',
  variables: [
    { key: '1', field: 'parent_name', label: 'שם ההורה', example: 'דנה כהן' },
    { key: '2', field: 'custom', label: 'שם המשתתף/ת', example: 'נועם כהן' },
  ],
  body_examples: ['דנה כהן', 'נועם כהן'],
  buttons: [],
};

/** The automation that fires on `new_lead`, pointed at the template above. */
function wireAutomation(template) {
  const automations = db.get('automations') || [];
  const existing = automations.find((a) => a.trigger_event === 'new_lead');
  const payload = {
    // Kept as the freeform wording for anyone whose 24-hour window happens to
    // be open — the template is what actually goes out for a new lead.
    message: 'שלום {{parentName}}, קיבלנו את הפרטים ואת הצהרת הבריאות של {{name}}. נחזור אליכם בהקדם לתיאום השיבוץ לחוג.',
    templateName: template.meta_name,
    preferTemplate: true,
    templateVarKeys: ['parentName', 'name'],
    language: 'he',
  };
  if (existing) {
    return db.update('automations', existing.id, {
      name: 'אישור קליטה — מיד אחרי מילוי הטופס',
      is_active: true,
      action_type: 'send_whatsapp',
      action_payload: payload,
    });
  }
  return db.insert('automations', {
    id: `au-onboarding-done`,
    name: 'אישור קליטה — מיד אחרי מילוי הטופס',
    is_active: true,
    action_type: 'send_whatsapp',
    trigger_event: 'new_lead',
    action_payload: payload,
    trigger_condition: null,
  });
}

async function main() {
  await initDb();

  const existing = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === ONBOARDING_DONE_TEMPLATE_NAME
  );
  console.log('template already present:', existing ? `${existing.id} (${existing.status})` : 'no');

  const currentAutomation = (db.get('automations') || []).find(
    (a) => a.trigger_event === 'new_lead'
  );
  console.log(
    'new_lead automation:',
    currentAutomation
      ? `${currentAutomation.name} → template ${currentAutomation.action_payload?.templateName || '(none)'}`
      : '(none)'
  );

  console.log('\nbody to be submitted:\n' + ONBOARDING_DONE_TEMPLATE.body);

  if (!APPLY) {
    console.log('\nlist only — re-run with --apply to create, submit and wire it up.');
    return;
  }

  const template = existing || createDraftTemplate(ONBOARDING_DONE_TEMPLATE);
  console.log(`\ntemplate: ${template.meta_name} (${template.id}) status=${template.status}`);
  await persistCore('message_templates', template);

  if (String(template.status || '').toUpperCase() === 'DRAFT') {
    const submitted = await submitTemplateToMeta(template.id);
    console.log(`submitted to Meta -> ${submitted.status}`);
  } else {
    console.log('not a draft — left as is at Meta.');
  }

  const automation = wireAutomation(template);
  await persistCore('automations', automation);
  console.log(`automation: ${automation.name} → ${automation.action_payload.templateName}`);
  console.log('\nNothing sends until Meta approves the template.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
