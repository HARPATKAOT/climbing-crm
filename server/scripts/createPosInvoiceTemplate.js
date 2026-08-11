/**
 * החשבונית שנשלחת ללקוח מיד אחרי מכירה בדלפק.
 *
 * עד היום היא נשלחה כטקסט חופשי, שמגיע רק למי שכתב לנו ב-24 השעות האחרונות.
 * לקוח שנכנס לטפס ושילם במזומן כמעט אף פעם אינו כזה — כלומר החשבונית פשוט
 * לא הגיעה, ומטא בולעת את ההודעה בשקט בלי לומר שנכשלה.
 *
 * UTILITY ולא MARKETING: זו הודעה על עסקה שהלקוח בדיוק ביצע, וזה בדיוק מה
 * שהקטגוריה הזאת נועדה לה — היא נמסרת גם בלי הסכמה לדיוור.
 *
 * הרצה מתוך תיקיית server:
 *   node scripts/createPosInvoiceTemplate.js           הצגה בלבד
 *   node scripts/createPosInvoiceTemplate.js --apply   יצירה והגשה לאישור
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';
import {
  createDraftTemplate, submitTemplateToMeta, POS_INVOICE_TEMPLATE_NAME,
} from '../channels/templates.js';
import { apiRedirectBase } from '../publicLinks.js';

const APPLY = process.argv.includes('--apply');

/**
 * {{1}} שם הלקוח · {{2}} סכום · {{3}} מספר המסמך.
 *
 * הקישור למסמך יושב בכפתור ולא בגוף ההודעה: מטא דורשת שכתובת בגוף תהיה
 * קבועה, ואילו כפתור מסוג URL מקבל סיומת משתנה — מספר המסמך שלנו.
 */
export const POS_INVOICE_TEMPLATE = {
  name: 'חשבונית · אישור רכישה בדלפק',
  meta_name: POS_INVOICE_TEMPLATE_NAME,
  language: 'he',
  category: 'UTILITY',
  tag: 'קופה',
  usage: 'נשלחת אוטומטית ללקוח מיד אחרי מכירה בדלפק, עם קישור לחשבונית.',
  body: [
    'שלום {{1}},',
    'תודה על הרכישה בקיר בועז.',
    'סכום: ₪{{2}}',
    'מספר מסמך: {{3}}',
    'החשבונית מצורפת בקישור למטה.',
  ].join('\n'),
  footer: '',
  header: '',
  variables: [
    { key: '1', field: 'parent_name', label: 'שם הלקוח', example: 'דנה כהן' },
    { key: '2', field: 'custom', label: 'סכום', example: '120' },
    { key: '3', field: 'custom', label: 'מספר מסמך', example: '10452' },
  ],
  body_examples: ['דנה כהן', '120', '10452'],
  buttons: [
    // המארח קפוא אצל מטא, ולכן הוא השרת שלנו: `/d/<מזהה מכירה>` מפנה משם
    // לכתובת האמיתית של המסמך. מעבר לדומיין אחר לא ידרוש אישור תבנית חדש.
    { type: 'URL', text: 'צפייה בחשבונית', url: `${apiRedirectBase()}/d/{{1}}`, example: 'po1786358032724' },
  ],
};

async function main() {
  await initDb();

  const existing = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === POS_INVOICE_TEMPLATE_NAME
  );
  console.log('template already present:', existing ? `${existing.id} (${existing.status})` : 'no');
  console.log('\nbody to be submitted:\n' + POS_INVOICE_TEMPLATE.body);

  if (!APPLY) {
    console.log('\nlist only — re-run with --apply to create and submit it.');
    return;
  }

  const template = existing || createDraftTemplate(POS_INVOICE_TEMPLATE);
  console.log(`\ntemplate: ${template.meta_name} (${template.id}) status=${template.status}`);
  await persistCore('message_templates', template);

  if (String(template.status || '').toUpperCase() === 'DRAFT') {
    const submitted = await submitTemplateToMeta(template.id);
    console.log(`submitted to Meta -> ${submitted.status}`);
  } else {
    console.log('not a draft — left as is at Meta.');
  }
  console.log('\nהחשבונית תמשיך לצאת כטקסט חופשי עד שמטא תאשר; מאז — בתבנית.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
