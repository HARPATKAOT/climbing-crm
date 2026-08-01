/**
 * The confirmation for an adult who registered themselves.
 *
 * `onboarding_completed_v1` greets the parent and names the participant, which
 * is right for a parent registering a child and reads badly when they are the
 * same person: "שלום דלק איל, קיבלנו את הפרטים ואת הצהרת הבריאות של דלק איל".
 * Meta will not let a template drop a parameter conditionally, so the second
 * wording is a second template, and the automation picks between them.
 *
 * UTILITY, like its sibling: it confirms something the person just did.
 *
 * Run from the server folder:
 *   node scripts/createOnboardingSelfTemplate.js          show what would happen
 *   node scripts/createOnboardingSelfTemplate.js --apply  create, submit, wire up
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { db, initDb, persistCore } from '../db.js';
import { createDraftTemplate, submitTemplateToMeta } from '../channels/templates.js';
import { ONBOARDING_DONE_TEMPLATE_NAME } from './createOnboardingDoneTemplate.js';

const APPLY = process.argv.includes('--apply');

export const ONBOARDING_SELF_TEMPLATE_NAME = 'onboarding_completed_self_v1';

export const ONBOARDING_SELF_TEMPLATE = {
  name: 'סיום מילוי טופס · אישור קליטה (מבוגר לעצמו)',
  meta_name: ONBOARDING_SELF_TEMPLATE_NAME,
  language: 'he',
  category: 'UTILITY',
  tag: 'קליטה',
  usage: 'נשלח אוטומטית כשמבוגר מילא את טופס ההצטרפות עבור עצמו.',
  body: [
    'שלום {{1}},',
    'קיבלנו את הפרטים ואת הצהרת הבריאות שלך — הכול נשמר במערכת.',
    'נחזור אליכם בהקדם לתיאום השיבוץ לחוג.',
    'אפשר להשיב להודעה הזו בכל שאלה.',
  ].join('\n'),
  footer: '',
  header: '',
  variables: [
    { key: '1', field: 'parent_name', label: 'שם החותם', example: 'דנה כהן' },
  ],
  body_examples: ['דנה כהן'],
  buttons: [],
};

/** Points the existing new_lead automation at the variant. */
function wireAutomation(template) {
  const automations = db.get('automations') || [];
  const existing = automations.find((a) => a.trigger_event === 'new_lead');
  if (!existing) {
    console.log('אין אוטומציה על new_lead — אין למה לחבר. צור אותה קודם.');
    return null;
  }
  const payload = {
    ...(existing.action_payload || {}),
    templateName: existing.action_payload?.templateName || ONBOARDING_DONE_TEMPLATE_NAME,
    templateVarKeys: existing.action_payload?.templateVarKeys || ['parentName', 'name'],
    templateNameSelf: template.meta_name,
    templateVarKeysSelf: ['parentName'],
  };
  return db.update('automations', existing.id, { action_payload: payload });
}

async function apply() {
  await initDb();
  console.log(`תבנית: ${ONBOARDING_SELF_TEMPLATE_NAME} (he, UTILITY)`);
  console.log(ONBOARDING_SELF_TEMPLATE.body);

  if (!APPLY) {
    console.log('\n(ללא --apply) לא נשלח דבר למטא.');
    return;
  }

  const templates = db.get('message_templates') || [];
  let template = templates.find(
    (t) => (t.meta_name || t.name) === ONBOARDING_SELF_TEMPLATE_NAME
  );
  if (!template) {
    template = createDraftTemplate(ONBOARDING_SELF_TEMPLATE);
    await persistCore('message_templates', template);
    console.log('נוצרה טיוטה מקומית.');
  } else {
    console.log('התבנית כבר קיימת מקומית.');
  }

  const status = String(template.status || '').toUpperCase();
  if (status !== 'APPROVED' && status !== 'PENDING') {
    const submitted = await submitTemplateToMeta(template.id);
    await persistCore('message_templates', submitted);
    console.log(`נשלחה למטא, סטטוס: ${submitted.status}`);
    template = submitted;
  } else {
    console.log(`סטטוס נוכחי במטא: ${status}`);
  }

  const automation = wireAutomation(template);
  if (automation) {
    const durable = await persistCore('automations', automation);
    if (durable?.ok === false) throw new Error(`חיבור האוטומציה לא נשמר: ${durable.error}`);
    console.log('האוטומציה על new_lead מפנה עכשיו לשתי הגרסאות.');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  apply().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
