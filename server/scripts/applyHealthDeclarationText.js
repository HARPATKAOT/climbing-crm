/**
 * Writes the agreed wording of the health declaration into the default form
 * template — the record the public form actually reads.
 *
 * The texts in `PublicOnboardingForm.jsx` are only a fallback for a CRM with no
 * template saved. Everything a customer sees comes from this row, so a change
 * of wording that is not applied here is a change nobody experiences.
 *
 * What it sets:
 *   • the waiver, rewritten as numbered clauses, with liability limited to
 *     negligence proved beyond doubt
 *   • the plain-language summary, addressed to the signer by name
 *   • the safety clause about an unaccompanied child, marked "@" so it is not
 *     shown to an adult signing for themselves
 *   • the doctor's-limitation question, marked "!" so a "yes" now requires a
 *     doctor's written approval to be attached before the form can be sent
 *
 *   node scripts/applyHealthDeclarationText.js --dry       # print the diff only
 *   node scripts/applyHealthDeclarationText.js             # local db.json only
 *   node scripts/applyHealthDeclarationText.js --remote    # the live CRM (Supabase)
 */

import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { db } from '../db.js';
import { supa } from '../supa.js';

const LEGAL_NAME = 'הרפתקאות (קיר בועז)';

const WAIVER_TEXT = `כתב הצהרה, ויתור והסרת אחריות

1. אני החתום/ה מטה מצהיר/ה כי קראתי מסמך זה במלואו, הבנתי את תוכנו, וכי אני חותם/ת עליו מרצוני החופשי ומתוך הבנה שמדובר בחוזה מחייב לכל דבר ועניין.

2. ידוע לי כי טיפוס ספורטיבי, על כל צורותיו, הוא פעילות אתגרית הכרוכה מטבעה בסיכון לפגיעה גופנית — לרבות נפילה, החלקה, פגיעה מציוד, מאמץ יתר ופציעה — וכי סיכון זה קיים גם בהקפדה מלאה על הוראות הבטיחות.

3. אני מצהיר/ה כי מסרתי בהצהרת הבריאות מידע מלא, נכון ומעודכן ביחס אליי או ביחס למשתתף/ת שעליו/ה אני חותם/ת, וכי לא ידועה לי מגבלה רפואית שלא פורטה בה. אני מתחייב/ת לעדכן את הצוות בכל שינוי במצב הבריאותי.

4. בחינת התאמת הפעילות למצב הבריאותי היא באחריותי בלבד, ובמקרה הצורך לאחר היוועצות ברופא. "${LEGAL_NAME}" אינו גורם רפואי ואינו בוחן כשירות רפואית להשתתפות.

5. אני נוטל/ת על עצמי את הסיכון הרגיל הכרוך בפעילות, ומוותר/ת על כל טענה, דרישה או תביעה כלפי "${LEGAL_NAME}", בעליו, מנהליו, עובדיו ומי מטעמו, בגין נזק גוף או רכוש שייגרם במסגרת אותו סיכון.

6. הוויתור שבסעיף 5 לא יחול, ואחריות המקום תעמוד בעינה, אך ורק במקרים בהם תוכח מעל לכל ספק רשלנות של המקום.

7. אני מתחייב/ת לפעול לפי כל הוראות הבטיחות שסימנתי בשלב הקודם ולפי הוראות הצוות, ולדווח לצוות באופן מיידי על כל מפגע, תקלה, פציעה או תחושה גופנית חריגה.

8. ידוע לי כי הצוות רשאי להפסיק את ההשתתפות בכל עת, אם לדעתו היא מסכנת את המשתתף/ת או אחרים.

9. חתימת הורה או אפוטרופוס על מסמך זה מחייבת גם את המשתתף/ת הקטין/ה שעליו/ה נחתם, ומהווה הסכמה להשתתפותו/ה בפעילות.

10. תוקף הצהרה זו שנה מיום החתימה, או עד לשינוי במצב הבריאותי — המוקדם מביניהם.`;

// {{שם החותם}} is filled in by the form with the name typed into it.
const WAIVER_SUMMARY = `• טיפוס הוא פעילות אתגרית. גם כשמקפידים על כל כללי הבטיחות אפשר להיפצע.
• את הסיכון הרגיל של הפעילות אני, {{שם החותם}}, לוקח/ת על עצמי.
• "${LEGAL_NAME}" יישא באחריות אך ורק במקרים בהם תוכח מעל לכל ספק רשלנות של המקום.
• מסרתי מידע רפואי מלא ונכון, ואין מגבלה רפואית שלא סיפרתי עליה.
• ההחלטה שהפעילות מתאימה למצב הבריאותי היא שלי, ובמקרה הצורך לאחר התייעצות עם רופא.
• אני מתחייב/ת לפעול לפי הוראות הבטיחות והצוות, ולדווח מיד על פציעה או תחושה לא טובה.
• הצוות רשאי להפסיק את ההשתתפות אם היא מסכנת את המשתתף/ת או אחרים.
• הורה שחותם — חותם גם בשם הילד/ה.
• זהו חוזה מחייב, לא טופס. תוקפו שנה, או עד שינוי במצב הבריאותי.`;

const HEALTH_QUESTIONS = [
  { id: 'm1', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'm2', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש בעיות לב, לחץ דם, סחרחורות או התעלפויות?' },
  { id: 'm3', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש אפילפסיה או אירועי אובדן הכרה?' },
  { id: 'm4', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים, פריקות חוזרות) שמגבילה פעילות מאומצת?' },
  { id: 'm5', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם עברתם ניתוח, אשפוז או פציעה משמעותית בשנה האחרונה?' },
  { id: 'm6', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש נטילת תרופות קבועות?' },
  { id: 'm7', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אלרגיה שהצוות צריך להכיר (מזון, תרופות, עקיצות)?' },
  { id: 'm8', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם רופא הגביל פעילות גופנית בשנה האחרונה, או שיש מגבלה רפואית אחרת שלא נזכרה כאן?' },
  {
    id: 'h1',
    kind: 'confirm',
    requireYes: true,
    audience: 'all',
    requiresClearance: false,
    label: `אני החתום/ה מטה מצהיר/ה בזאת שאני או האדם אותו אני רושם לחוג הטיפוס בריא/ה וכשיר/ה פיזית, נפשית וקוגניטיבית להשתתף בפעילות המתקיימת ב"${LEGAL_NAME}", וכי מסרתי מידע רפואי מלא ומעודכן. אני מתחייב/ת לעדכן את הצוות בכל שינוי במצב הבריאותי.`,
  },
  // The only clause that speaks about a child rather than to the signer.
  { id: 's1', kind: 'confirm', requireYes: true, audience: 'child', requiresClearance: false, label: 'אין להשאיר ילד עד גיל 11 ללא ליווי מבוגר שלא במסגרת חוג מסודר' },
  { id: 's2', kind: 'confirm', requireYes: true, audience: 'all', requiresClearance: false, label: 'נא להימנע מריצה והשתוללות בכל מתחם הקיר' },
  { id: 's3', kind: 'confirm', requireYes: true, audience: 'all', requiresClearance: false, label: 'יש להישמע להוראות המדריכים' },
  { id: 's4', kind: 'confirm', requireYes: true, audience: 'all', requiresClearance: false, label: 'טיפוס על הקיר יתאפשר רק לאלו שקיבלו תדריך מסודר' },
  { id: 's5', kind: 'confirm', requireYes: true, audience: 'all', requiresClearance: false, label: 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך' },
];

export const DECLARATION_TEXT = {
  waiverText: WAIVER_TEXT,
  waiverSummary: WAIVER_SUMMARY,
  healthQuestions: HEALTH_QUESTIONS,
};

/**
 * Comparable form of a question list.
 *
 * Supabase returns jsonb with its own key order, so comparing the stringified
 * arrays reports a difference on a write that in fact succeeded.
 */
function canonicalQuestions(questions) {
  return JSON.stringify((questions || []).map((q) => [
    q.id,
    q.kind,
    q.label,
    q.audience || 'all',
    !!q.requiresClearance,
    !!q.requireYes,
  ]));
}

function findDefault(templates) {
  const rows = Array.isArray(templates) ? templates : [];
  return rows.find((t) => t.isDefault) || rows.find((t) => t.slug === 'wall') || rows[0] || null;
}

function printDiff(current) {
  for (const key of ['waiverText', 'waiverSummary']) {
    const before = String(current?.[key] || '');
    const after = DECLARATION_TEXT[key];
    console.log(before === after ? `= ${key} (ללא שינוי)` : `~ ${key} (${before.length} → ${after.length} תווים)`);
  }
  const before = canonicalQuestions(current?.healthQuestions);
  const after = canonicalQuestions(HEALTH_QUESTIONS);
  if (before === after) {
    console.log('= healthQuestions (ללא שינוי)');
    return;
  }
  console.log('~ healthQuestions:');
  for (const question of HEALTH_QUESTIONS) {
    const was = (current?.healthQuestions || []).find((q) => q.id === question.id);
    const marks = [
      question.audience === 'child' ? 'להורה בלבד' : '',
      question.requiresClearance ? 'דורש אישור רופא' : '',
    ].filter(Boolean).join(', ');
    const changed = !was
      || was.label !== question.label
      || (was.audience || 'all') !== question.audience
      || !!was.requiresClearance !== question.requiresClearance;
    console.log(`  ${changed ? '~' : '='} ${question.id}${marks ? ` [${marks}]` : ''} ${question.label.slice(0, 60)}`);
  }
}

async function apply({ dry = false, remote = false } = {}) {
  if (remote && !supa.isEnabled()) {
    throw new Error('אין חיבור ל-Supabase — בדוק SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY ב-.env');
  }

  const templates = remote ? await supa.getAll('form_templates') : db.get('form_templates');
  const current = findDefault(templates);
  if (!current) throw new Error('לא נמצאה תבנית ברירת מחדל לעדכון');

  console.log(`תבנית: ${current.title} (${current.slug || 'ללא slug'})\n`);
  printDiff(current);

  if (dry) {
    console.log('\n(--dry) לא נשמר דבר.');
    return;
  }

  const next = { ...current, ...DECLARATION_TEXT };
  // Local first, so a Supabase failure never leaves db.json ahead of production.
  db.update('form_templates', current.id, DECLARATION_TEXT);

  if (remote) {
    const result = await supa.upsert('form_templates', next);
    if (!result?.ok) throw new Error(result?.error || 'כתיבה ל-Supabase נכשלה');
    const check = findDefault(await supa.getAll('form_templates'));
    const mismatched = ['waiverText', 'waiverSummary']
      .filter((key) => String(check?.[key] || '') !== DECLARATION_TEXT[key]);
    if (canonicalQuestions(check?.healthQuestions) !== canonicalQuestions(HEALTH_QUESTIONS)) {
      mismatched.push('healthQuestions');
    }
    if (mismatched.length) throw new Error(`נשמר חלקית: ${mismatched.join(', ')}`);
    console.log('\n✅ הנוסח נשמר ב-CRM החי ואומת בקריאה חוזרת.');
  } else {
    console.log('\n✅ נשמר ב-db.json המקומי בלבד (בלי --remote לא נוגעים בפרודקשן).');
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  apply({ dry: process.argv.includes('--dry'), remote: process.argv.includes('--remote') })
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
