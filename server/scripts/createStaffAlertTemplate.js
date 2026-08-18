/**
 * ההתראה הפנימית שנשלחת לצוות כשחלון 24 השעות סגור.
 *
 * התראות הצוות — שיבוץ חדש, קופה שנסגרה, פנייה שממתינה — נשלחו כטקסט חופשי,
 * ווואטסאפ מתיר טקסט חופשי רק בתוך יממה מההודעה האחרונה של הנמען. מנהל שלא
 * כתב לבוט יום שלם הפסיק לקבל אותן בשקט: חמש עשרה התראות אבדו כך בתוך יומיים,
 * וכל מה שנשאר היה סימן אדום בטלפון שלו.
 *
 * פרמטר אחד, כי התראה פנימית היא שורה אחת של תוכן משתנה — ומה שמופיע בה הוא
 * בדיוק הטקסט שהיה נשלח כהודעה רגילה.
 *
 * UTILITY: זו הודעה תפעולית לעובד של העסק, לא פנייה שיווקית ללקוח.
 *
 * הרצה מתיקיית server:
 *   node scripts/createStaffAlertTemplate.js          מראה מה יקרה
 *   node scripts/createStaffAlertTemplate.js --apply  יוצר ושולח למטא לאישור
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import { createDraftTemplate, submitTemplateToMeta } from '../channels/templates.js';
import { STAFF_ALERT_TEMPLATE } from '../staffNotify.js';

const APPLY = process.argv.includes('--apply');

export const STAFF_ALERT_TEMPLATE_DEF = {
  name: 'התראת צוות · הודעה פנימית',
  meta_name: STAFF_ALERT_TEMPLATE,
  language: 'he',
  category: 'UTILITY',
  tag: 'צוות',
  usage: 'התראה פנימית לצוות כשחלון 24 השעות סגור — שיבוץ, סגירת קופה, פנייה שממתינה.',
  // Meta refuses a body that ends on a variable, so the closing line is real
  // text — and it doubles as the instruction the alert needs anyway.
  body: [
    'התראה מהמערכת 🔔',
    '{{1}}',
    'הפרטים המלאים במסך הניהול.',
  ].join('\n'),
  footer: '',
  header: '',
  variables: [
    {
      key: '1',
      field: 'custom',
      label: 'תוכן ההתראה',
      example: 'שיבוץ מהבוט · מתאמן: גיא היבנטריגר · קבוצה: ה׳-ו׳ יום ד׳ 16:30',
    },
  ],
  body_examples: ['שיבוץ מהבוט · מתאמן: גיא היבנטריגר · קבוצה: ה׳-ו׳ יום ד׳ 16:30'],
  buttons: [],
};

async function main() {
  await initDb();

  const existing = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === STAFF_ALERT_TEMPLATE
  );
  console.log('template already present:', existing ? `${existing.id} (${existing.status})` : 'no');

  if (!APPLY) {
    console.log('\n--- dry run, nothing was changed ---');
    console.log(STAFF_ALERT_TEMPLATE_DEF.body);
    console.log('\nrun again with --apply to create it and submit it to Meta.');
    return;
  }

  const template = existing || createDraftTemplate(STAFF_ALERT_TEMPLATE_DEF);
  if (!existing) {
    await persistCore('message_templates', template);
    console.log('created draft:', template.id);
  }

  const submitted = await submitTemplateToMeta(template.id);
  console.log('submitted to Meta:', JSON.stringify(submitted));
  console.log('\nUntil Meta approves it, a staff alert that cannot go as free');
  console.log('text falls back to my_agenda_v1, which is already approved.');
}

if (process.argv[1] && process.argv[1].endsWith('createStaffAlertTemplate.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
