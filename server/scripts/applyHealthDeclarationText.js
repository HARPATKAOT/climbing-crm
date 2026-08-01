/**
 * Writes the agreed wording of the health declarations into the form templates
 * — the records the public form actually reads.
 *
 * The texts in `PublicOnboardingForm.jsx` are only a fallback for a CRM with no
 * template saved. Everything a customer sees comes from these rows, so a change
 * of wording that is not applied here is a change nobody experiences.
 *
 * **One declaration per activity, built from one skeleton.** The wall, a
 * birthday party and an outdoor trip are not the same undertaking: a trip adds
 * travel, terrain, weather and distance from help, and a party is a room full
 * of children who never had a lesson. A waiver holds up only where the signer
 * understood the risk they were actually taking, so the risk clause and the
 * safety rules differ by activity — while everything else (the medical
 * questions, the liability structure, the doctor's-approval rule) is identical,
 * because there is no reason for it not to be.
 *
 * What every template gets:
 *   • the waiver as numbered clauses, naming the signer, with liability limited
 *     to negligence proved beyond doubt
 *   • the plain-language summary, addressed to the signer by name
 *   • "@" on clauses that only apply when a parent signs for a child
 *   • "!" on questions where a "yes" requires a doctor's written approval
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

/**
 * The waiver, with two holes: what the activity is, and what its risks are.
 * Everything else is identical across activities on purpose — a family that
 * signs for the wall and again for a trip should meet the same document.
 */
function buildWaiver({ activityPhrase, riskClause }) {
  return `כתב הצהרה, ויתור והסרת אחריות — ${activityPhrase}

1. אני החתום/ה מטה, {{שם החותם}}, מצהיר/ה כי קראתי מסמך זה במלואו, הבנתי את תוכנו, וכי אני חותם/ת עליו מרצוני החופשי ומתוך הבנה שמדובר בחוזה מחייב לכל דבר ועניין.

2. ${riskClause}

3. אני מצהיר/ה כי מסרתי בהצהרת הבריאות מידע מלא, נכון ומעודכן ביחס אליי או ביחס למשתתף/ת שעליו/ה אני חותם/ת, וכי לא ידועה לי מגבלה רפואית שלא פורטה בה. אני מתחייב/ת לעדכן את הצוות בכל שינוי במצב הבריאותי.

4. בחינת התאמת הפעילות למצב הבריאותי היא באחריותי בלבד, ובמקרה הצורך לאחר היוועצות ברופא. "${LEGAL_NAME}" אינו גורם רפואי ואינו בוחן כשירות רפואית להשתתפות.

5. אני, {{שם החותם}}, נוטל/ת על עצמי את הסיכון הרגיל הכרוך בפעילות, ומוותר/ת על כל טענה, דרישה או תביעה כלפי "${LEGAL_NAME}", בעליו, מנהליו, עובדיו ומי מטעמו, בגין נזק גוף או רכוש שייגרם במסגרת אותו סיכון.

6. הוויתור שבסעיף 5 לא יחול, ואחריות המקום תעמוד בעינה, אך ורק במקרים בהם תוכח מעל לכל ספק רשלנות של המקום.

7. אני מתחייב/ת לפעול לפי כל הוראות הבטיחות שסימנתי בשלב הקודם ולפי הוראות הצוות, ולדווח לצוות באופן מיידי על כל מפגע, תקלה, פציעה או תחושה גופנית חריגה.

8. ידוע לי כי הצוות רשאי להפסיק את ההשתתפות בכל עת, אם לדעתו היא מסכנת את המשתתף/ת או אחרים.

9. חתימת הורה או אפוטרופוס על מסמך זה מחייבת גם את המשתתף/ת הקטין/ה שעליו/ה נחתם, ומהווה הסכמה להשתתפותו/ה בפעילות.`;
}

/** {{שם החותם}} is filled in by the form with the name typed into it. */
function buildSummary({ riskBullet }) {
  return `• ${riskBullet}
• את הסיכון הרגיל של הפעילות אני, {{שם החותם}}, לוקח/ת על עצמי.
• "${LEGAL_NAME}" יישא באחריות אך ורק במקרים בהם תוכח מעל לכל ספק רשלנות של המקום.
• מסרתי מידע רפואי מלא ונכון, ואין מגבלה רפואית שלא סיפרתי עליה.
• ההחלטה שהפעילות מתאימה למצב הבריאותי היא שלי, ובמקרה הצורך לאחר התייעצות עם רופא.
• אני מתחייב/ת לפעול לפי הוראות הבטיחות והצוות, ולדווח מיד על פציעה או תחושה לא טובה.
• הצוות רשאי להפסיק את ההשתתפות אם היא מסכנת את המשתתף/ת או אחרים.
• הורה שחותם — חותם גם בשם הילד/ה.
• זהו חוזה מחייב, לא טופס.`;
}

/**
 * The medical half. Identical everywhere: a heart condition does not become
 * safer because the activity is a birthday party, and a family that answered
 * these once should meet the same questions the next time.
 */
const MEDICAL_QUESTIONS = [
  { id: 'm1', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'm2', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיות לב, לחץ דם, סחרחורות או התעלפויות?' },
  { id: 'm3', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש אפילפסיה או אירועי אובדן הכרה?' },
  // The question already says the problem limits strenuous activity — the wall
  // is not the one to decide it does not limit this one.
  { id: 'm4', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים, פריקות חוזרות) שמגבילה פעילות מאומצת?' },
  { id: 'm5', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם עברתם ניתוח, אשפוז או פציעה משמעותית בשנה האחרונה?' },
  { id: 'm6', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש נטילת תרופות קבועות?' },
  { id: 'm7', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אלרגיה שהצוות צריך להכיר (מזון, תרופות, עקיצות)?' },
  // Split in two. Asked together, the catch-all inherited the doctor's-approval
  // requirement that belongs only to the first half, so someone wanting to
  // mention a small thing nobody asked about was blocked until they produced a
  // certificate — and the safest answer became saying nothing.
  { id: 'm8', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם רופא הגביל פעילות גופנית בשנה האחרונה?' },
  { id: 'm9', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש מגבלה רפואית, אבחנה או מידע אחר שחשוב שנדע ולא נשאלנו עליו כאן?' },
];

/**
 * Asked only where the activity actually raises it.
 *
 * The nine questions above are deliberately identical everywhere — a heart
 * condition does not care which outing it is. This one is different: fear of
 * confined spaces means nothing on a wall and everything in a cave, and asking
 * it of every birthday party would be noise that teaches families to click
 * through the questionnaire.
 *
 * No doctor's approval attached: this is not a condition to be cleared, it is
 * something the guide needs to know before a narrow passage, so the detail box
 * that opens on "yes" is the whole point.
 */
const CAVE_QUESTION = {
  id: 'm10',
  kind: 'screen',
  requireYes: false,
  audience: 'all',
  requiresClearance: false,
  label: 'האם יש קלאוסטרופוביה, חרדה או קושי בחללים סגורים, צרים או חשוכים?',
};

/** The fitness declaration, which names the activity it is made about. */
function fitnessConfirmation(activityPhrase) {
  return {
    id: 'h1',
    kind: 'confirm',
    requireYes: true,
    audience: 'all',
    requiresClearance: false,
    label: `אני החתום/ה מטה מצהיר/ה בזאת שאני, או האדם שאני רושם/ת ל${activityPhrase}, בריא/ה וכשיר/ה פיזית, נפשית וקוגניטיבית להשתתף בפעילות המתקיימת מטעם "${LEGAL_NAME}", וכי מסרתי מידע רפואי מלא ומעודכן. אני מתחייב/ת לעדכן את הצוות בכל שינוי במצב הבריאותי.`,
  };
}

function safety(id, label, { childOnly = false } = {}) {
  return {
    id,
    kind: 'confirm',
    requireYes: true,
    audience: childOnly ? 'child' : 'all',
    requiresClearance: false,
    label,
  };
}

/**
 * The three activities. `slug` is what the public link carries
 * (/health, /health/birthday, /health/trip).
 */
const ACTIVITIES = [
  {
    slug: 'wall',
    title: 'הצהרת בריאות ובטיחות + הסרת אחריות',
    activityPhrase: 'חוג ופעילות טיפוס בקיר',
    riskClause: 'ידוע לי כי טיפוס ספורטיבי, על כל צורותיו, הוא פעילות אתגרית הכרוכה מטבעה בסיכון לפגיעה גופנית — לרבות נפילה, החלקה, פגיעה מציוד, מאמץ יתר ופציעה — וכי סיכון זה קיים גם בהקפדה מלאה על הוראות הבטיחות.',
    riskBullet: 'טיפוס הוא פעילות אתגרית. גם כשמקפידים על כל כללי הבטיחות אפשר להיפצע.',
    safety: [
      safety('s1', 'אין להשאיר ילד עד גיל 11 ללא ליווי מבוגר שלא במסגרת חוג מסודר', { childOnly: true }),
      safety('s2', 'נא להימנע מריצה והשתוללות בכל מתחם הקיר'),
      safety('s3', 'יש להישמע להוראות המדריכים'),
      safety('s4', 'טיפוס על הקיר יתאפשר רק לאלו שקיבלו תדריך מסודר'),
      safety('s5', 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך'),
    ],
  },
  {
    slug: 'birthday',
    title: 'הצהרת בריאות ובטיחות + הסרת אחריות — יום הולדת',
    activityPhrase: 'פעילות יום הולדת בקיר',
    // A party is the wall's risks with a crowd of children who have never
    // climbed before, and that is what the clause has to say.
    riskClause: 'ידוע לי כי פעילות יום ההולדת כוללת טיפוס בקיר — פעילות אתגרית הכרוכה מטבעה בסיכון לפגיעה גופנית, לרבות נפילה, החלקה, פגיעה מציוד ופציעה — וכי חלק מהמשתתפים מגיעים ללא ניסיון קודם. הסיכון קיים גם בהקפדה מלאה על הוראות הבטיחות.',
    riskBullet: 'יום ההולדת כולל טיפוס. זו פעילות אתגרית, וגם כשמקפידים על כללי הבטיחות אפשר להיפצע.',
    safety: [
      safety('s1', 'ידוע לי כי באחריות המזמין/ה לוודא ליווי מבוגר לילדים שהובאו לפעילות', { childOnly: true }),
      safety('s2', 'נא להימנע מריצה והשתוללות בכל מתחם הקיר, לרבות באזור הישיבה והכיבוד'),
      safety('s3', 'יש להישמע להוראות המדריכים לאורך כל הפעילות'),
      safety('s4', 'טיפוס על הקיר יתאפשר רק למשתתפים שקיבלו תדריך מסודר'),
      safety('s5', 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך'),
      safety('s6', 'ידוע לי כי יש למסור מראש לצוות כל רגישות או אלרגיה למזון של המשתתפים'),
    ],
  },
  {
    slug: 'trip',
    title: 'הצהרת בריאות ובטיחות + הסרת אחריות — יציאה / טיול',
    activityPhrase: 'יציאה או טיול — סנפלינג, טיפוס ומערנות',
    // The only template with a cave in it, and so the only one that asks.
    asksAboutConfinedSpaces: true,
    // Most trips are rappelling, and the same day may add climbing or a cave.
    // One declaration covers all three because they are one outing under one
    // instructor — but each has to be named, and a cave is not a cliff: it
    // adds the dark, the cold, and a space you cannot simply walk out of.
    riskClause: 'ידוע לי כי היציאה כוללת פעילות אתגרית בשטח — גלישה על חבל (סנפלינג), טיפוס, מערנות (פעילות במערות) והליכה בשטח פתוח — הכרוכה מטבעה בסיכון לפגיעה גופנית, לרבות נפילה, החלקה, התדרדרות אבנים, פגיעה מציוד ומאמץ יתר. ידוע לי כי פעילות במערה מוסיפה סיכונים משלה: חללים צרים וחשוכים, רטיבות והחלקה, קור, ותלות בתאורה ובציוד. ידוע לי כי ליציאה לשטח נלווים סיכונים שאינם קיימים במתקן סגור — תנאי מזג אוויר ושטח, בעלי חיים, הנסיעה אל אתר הפעילות וממנו, וריחוק ממענה רפואי מיידי. הסיכון קיים גם בהקפדה מלאה על הוראות הבטיחות.',
    riskBullet: 'היציאה כוללת סנפלינג, טיפוס ומערנות, ומוסיפה סיכוני שטח, מזג אוויר, חללים חשוכים, נסיעה וריחוק מעזרה רפואית.',
    safety: [
      safety('s1', 'ידוע לי כי ילד עד גיל 11 יוצא לשטח רק בליווי מבוגר או במסגרת קבוצה מאורגנת', { childOnly: true }),
      safety('s2', 'יש להישמע להוראות המדריך האחראי בכל עת, ואין להתרחק מהקבוצה'),
      safety('s3', 'חובה להגיע עם הציוד, הביגוד והנעליים המתאימים כפי שנדרש ליציאה'),
      safety('s4', 'סנפלינג, טיפוס וכניסה למערה יתאפשרו רק למי שקיבל/ה תדריך מסודר, ורק בהשגחת מדריך'),
      safety('s5', 'אין לגעת בציוד, בחבלים או בעיגונים ללא הוראת מדריך'),
      safety('s6', 'במערה חובה קסדה ותאורה, ואין להיכנס, להתפצל או לצאת ללא הוראת מדריך'),
      safety('s7', 'יש להצטייד במים ולדווח מיד על תשישות, סחרחורת, קוצר נשימה או תחושה לא טובה'),
      safety('s8', 'ידוע לי כי הצוות רשאי לשנות או לבטל את מסלול הפעילות משיקולי בטיחות ומזג אוויר'),
    ],
  },
];

/** The full desired content of one template row. */
export function declarationFor(activity) {
  return {
    title: activity.title,
    waiverText: buildWaiver(activity),
    waiverSummary: buildSummary(activity),
    healthQuestions: [
      ...MEDICAL_QUESTIONS,
      ...(activity.asksAboutConfinedSpaces ? [CAVE_QUESTION] : []),
      fitnessConfirmation(activity.activityPhrase),
      ...activity.safety,
    ],
  };
}

export const DECLARATIONS = Object.fromEntries(
  ACTIVITIES.map((activity) => [activity.slug, declarationFor(activity)])
);

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

function printDiff(current, desired) {
  for (const key of ['title', 'waiverText', 'waiverSummary']) {
    const before = String(current?.[key] || '');
    const after = desired[key];
    console.log(before === after
      ? `  = ${key} (ללא שינוי)`
      : `  ~ ${key} (${before.length} → ${after.length} תווים)`);
  }
  const before = canonicalQuestions(current?.healthQuestions);
  const after = canonicalQuestions(desired.healthQuestions);
  if (before === after) {
    console.log('  = healthQuestions (ללא שינוי)');
    return;
  }
  console.log('  ~ healthQuestions:');
  for (const question of desired.healthQuestions) {
    const was = (current?.healthQuestions || []).find((q) => q.id === question.id);
    const marks = [
      question.audience === 'child' ? 'להורה בלבד' : '',
      question.requiresClearance ? 'דורש אישור רופא' : '',
    ].filter(Boolean).join(', ');
    const changed = !was
      || was.label !== question.label
      || (was.audience || 'all') !== question.audience
      || !!was.requiresClearance !== question.requiresClearance;
    console.log(`    ${changed ? '~' : '='} ${question.id}${marks ? ` [${marks}]` : ''} ${question.label.slice(0, 58)}`);
  }
  const removed = (current?.healthQuestions || [])
    .filter((q) => !desired.healthQuestions.some((d) => d.id === q.id));
  removed.forEach((q) => console.log(`    - ${q.id} (הוסר) ${String(q.label).slice(0, 50)}`));
}

async function apply({ dry = false, remote = false } = {}) {
  if (remote && !supa.isEnabled()) {
    throw new Error('אין חיבור ל-Supabase — בדוק SUPABASE_URL ו-SUPABASE_SERVICE_ROLE_KEY ב-.env');
  }

  const templates = remote ? await supa.getAll('form_templates') : db.get('form_templates');
  const rows = Array.isArray(templates) ? templates : [];

  const plan = [];
  for (const activity of ACTIVITIES) {
    const current = rows.find((t) => t.slug === activity.slug)
      || (activity.slug === 'wall' ? rows.find((t) => t.isDefault) : null);
    const desired = DECLARATIONS[activity.slug];
    console.log(`\n=== ${activity.slug} — ${desired.title}`);
    if (!current) {
      console.log('  (לא קיימת תבנית כזאת — תיווצר)');
    } else {
      printDiff(current, desired);
    }
    plan.push({ activity, current, desired });
  }

  if (dry) {
    console.log('\n(--dry) לא נשמר דבר.');
    return;
  }

  for (const { activity, current, desired } of plan) {
    if (current) {
      db.update('form_templates', current.id, desired);
    } else {
      // A missing template is created inactive: its wording is ready, but which
      // activity is live is the owner's call, not this script's.
      db.insert('form_templates', {
        ...desired,
        slug: activity.slug,
        activityType: activity.slug,
        isDefault: false,
        isActive: false,
      });
    }
  }

  if (!remote) {
    console.log('\n✅ נשמר ב-db.json המקומי בלבד (בלי --remote לא נוגעים בפרודקשן).');
    return;
  }

  for (const { activity, current, desired } of plan) {
    const row = current
      ? { ...current, ...desired }
      : {
        ...(db.get('form_templates') || []).find((t) => t.slug === activity.slug),
      };
    const result = await supa.upsert('form_templates', row);
    if (!result?.ok) throw new Error(`${activity.slug}: ${result?.error || 'כתיבה ל-Supabase נכשלה'}`);
  }

  const after = await supa.getAll('form_templates');
  const mismatched = [];
  for (const { activity, desired } of plan) {
    const row = (after || []).find((t) => t.slug === activity.slug);
    if (!row) { mismatched.push(`${activity.slug} (חסרה)`); continue; }
    if (String(row.waiverText || '') !== desired.waiverText) mismatched.push(`${activity.slug}/waiverText`);
    if (String(row.waiverSummary || '') !== desired.waiverSummary) mismatched.push(`${activity.slug}/waiverSummary`);
    if (canonicalQuestions(row.healthQuestions) !== canonicalQuestions(desired.healthQuestions)) {
      mismatched.push(`${activity.slug}/healthQuestions`);
    }
  }
  if (mismatched.length) throw new Error(`נשמר חלקית: ${mismatched.join(', ')}`);
  console.log('\n✅ שלוש ההצהרות נשמרו ב-CRM החי ואומתו בקריאה חוזרת.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  apply({ dry: process.argv.includes('--dry'), remote: process.argv.includes('--remote') })
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
