/**
 * שתי התבניות שנשלחות ברגע שמישהו מסיים למלא את הטופס — אחת למי שנרשם לחוג,
 * ואחת למי שרק בא לטפס.
 *
 * שתיהן נועדו לאותו רגע בדיוק: הלקוח מילא טופס והחלון של 24 השעות סגור, כי הוא
 * מעולם לא כתב לנו. מותר לשלוח רק תבנית מאושרת, ולכן הנוסח שלה הוא כל מה שיש.
 *
 * הנוסח הקודם נגמר ב„נחזור אליכם בהקדם לתיאום השיבוץ לחוג” — משפט שסוגר את
 * השיחה. מי שבתוך החלון כבר קיבל מהבוט „לאיזו קבוצה תרצו להשתבץ?” והמשיך משם;
 * מי שמחוץ לחלון נעצר, וחיכה לטלפון שלא תמיד הגיע. הנוסח החדש שואל שאלה, ותשובה
 * עליה פותחת את החלון — ומשם הבוט ממשיך לבד.
 *
 * ומי שבא לטפס לא נרשם לחוג בכלל. לו לא הובטח שיבוץ; לו נאמר שהכול נשמר, ומה
 * עוד יש אצלנו — כי זו הפעם היחידה שנדבר איתו.
 *
 * הרצה מתוך server/:
 *   node scripts/createFormReceivedTemplates.js          מה עומד לקרות
 *   node scripts/createFormReceivedTemplates.js --apply  יצירה, הגשה וחיווט
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import { createDraftTemplate, submitTemplateToMeta } from '../channels/templates.js';

const APPLY = process.argv.includes('--apply');

export const ONBOARDING_CONTINUE_TEMPLATE_NAME = 'onboarding_completed_v2';
export const WALL_FORM_TEMPLATE_NAME = 'wall_form_received_v1';

/** {{1}} ההורה, {{2}} המשתתף — לפי templateVarKeys: ['parentName', 'name']. */
export const ONBOARDING_CONTINUE_TEMPLATE = {
  name: 'סיום מילוי טופס · ממשיכים להרשמה',
  meta_name: ONBOARDING_CONTINUE_TEMPLATE_NAME,
  language: 'he',
  category: 'UTILITY',
  tag: 'קליטה',
  usage: 'נשלח אוטומטית מיד אחרי מילוי טופס ההצטרפות, כשחלון 24 השעות סגור.',
  body: [
    'שלום {{1}},',
    'קיבלנו את הפרטים ואת הצהרת הבריאות של {{2}} — הכול נשמר במערכת.',
    'עכשיו נשאר רק לבחור קבוצה. כתבו לי כאן לאיזה חוג או לאילו ימים תרצו,',
    'ואמשיך איתכם מכאן — כולל הרשמה במתנ״ס והסדרת הציוד.',
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

export const WALL_FORM_TEMPLATE = {
  name: 'טופס כניסה לקיר · אישור קליטה',
  meta_name: WALL_FORM_TEMPLATE_NAME,
  language: 'he',
  category: 'UTILITY',
  tag: 'קליטה',
  usage: 'נשלח למי שמילא טופס כדי להיכנס לקיר — לא הרשמה לחוג.',
  body: [
    'שלום {{1}},',
    'קיבלנו את הפרטים ואת הצהרת הבריאות של {{2}} — הכול נשמר ואפשר להיכנס לקיר.',
    'אם בא לכם יותר מזה: יש אצלנו חוגי טיפוס לילדים ולנוער, ימי הולדת וטיולי שטח.',
    'אפשר להשיב להודעה הזו ואשמח לספר על כל אחד מהם.',
  ].join('\n'),
  footer: '',
  header: '',
  variables: [
    { key: '1', field: 'parent_name', label: 'שם ההורה', example: 'דנה כהן' },
    { key: '2', field: 'custom', label: 'שם המטפס/ת', example: 'נועם כהן' },
  ],
  body_examples: ['דנה כהן', 'נועם כהן'],
  buttons: [],
};

/**
 * החיווט. `templateName` נשאר על התבנית המאושרת הקיימת, כדי שכלום לא ייפול
 * בזמן שהחדשות ממתינות לאישור מטא; הקוד באוטומציה בוחר בחדשה רק כשהיא מאושרת.
 */
function wireAutomation() {
  const automations = db.get('automations') || [];
  const existing = automations.find((a) => a.trigger_event === 'new_lead');
  if (!existing) return null;
  const payload = {
    ...(existing.action_payload || {}),
    templateNameNext: ONBOARDING_CONTINUE_TEMPLATE_NAME,
    templateNameWall: WALL_FORM_TEMPLATE_NAME,
    templateVarKeysWall: ['parentName', 'name'],
  };
  return db.update('automations', existing.id, { action_payload: payload });
}

async function ensure(spec) {
  const existing = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === spec.meta_name
  );
  console.log(`\n${spec.meta_name}: ${existing ? `${existing.id} (${existing.status})` : 'not present'}`);
  console.log(spec.body);
  if (!APPLY) return null;

  const template = existing || createDraftTemplate(spec);
  await persistCore('message_templates', template);
  if (String(template.status || '').toUpperCase() === 'DRAFT') {
    const submitted = await submitTemplateToMeta(template.id);
    console.log(`→ submitted to Meta: ${submitted.status}`);
  } else {
    console.log(`→ left as is at Meta (${template.status}).`);
  }
  return template;
}

async function main() {
  await initDb();
  await ensure(ONBOARDING_CONTINUE_TEMPLATE);
  await ensure(WALL_FORM_TEMPLATE);

  if (!APPLY) {
    console.log('\nlist only — re-run with --apply to create, submit and wire up.');
    return;
  }
  const automation = wireAutomation();
  if (automation) {
    await persistCore('automations', automation);
    console.log(`\nautomation wired: ${automation.name}`);
  } else {
    console.log('\nno new_lead automation found — nothing to wire.');
  }
  console.log('Nothing changes for customers until Meta approves each template.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
