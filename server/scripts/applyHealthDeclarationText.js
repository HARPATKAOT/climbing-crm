/**
 * Writes the agreed wording of the health declarations into the form templates
 * — the records the public form actually reads.
 *
 * The texts in `PublicOnboardingForm.jsx` are only a fallback for a CRM with no
 * template saved. Everything a customer sees comes from these rows, so a change
 * of wording that is not applied here is a change nobody experiences.
 *
 * **Two participation scopes, built from one skeleton.** Every activity at the
 * wall (class, entry, personal training or event) uses the wall waiver. A trip
 * adds travel, terrain, weather and distance from help, so its risk clause and
 * safety rules remain separate — while everything else (the medical
 * questions, the liability structure, the doctor's-approval rule) is identical,
 * because there is no reason for it not to be.
 *
 * What every template gets:
 *   • the waiver as numbered clauses, naming nobody — one signature covers the
 *     signer and the minors listed above the signature field — with liability
 *     limited to negligence proved beyond doubt
 *   • the plain-language summary, in the same collective voice
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

1. אני החותם/ת מטה נוטל/ת אחריות עבור עצמי[[ ועבור ילדי הקטינים המפורטים לעיל]], ומצהיר/ה כי קראתי מסמך זה במלואו, הבנתי את תוכנו, וכי אני חותם/ת עליו מרצוני החופשי ומתוך הבנה שמדובר בחוזה מחייב לכל דבר ועניין.

2. ${riskClause}

3. אני מצהיר/ה כי מסרתי בהצהרת הבריאות מידע מלא, נכון ומעודכן ביחס אליי[[ וביחס לכל אחד מהמשתתפים המפורטים לעיל]], וכי לא ידועה לי מגבלה רפואית שלא פורטה בה. אני מתחייב/ת להודיע לצוות באופן מיידי על כל שינוי רפואי משמעותי.

4. בחינת התאמת הפעילות למצב הבריאותי היא באחריותי בלבד, ובמקרה הצורך לאחר היוועצות ברופא. "${LEGAL_NAME}" אינו גורם רפואי ואינו בוחן כשירות רפואית להשתתפות.

5. אני נוטל/ת על עצמי[[, ועבור המשתתפים הקטינים המפורטים לעיל,]] את הסיכון הרגיל הכרוך בפעילות, ומוותר/ת על כל טענה, דרישה או תביעה כלפי "${LEGAL_NAME}", בעליו, מנהליו, עובדיו ומי מטעמו, בגין נזק גוף או רכוש שייגרם במסגרת אותו סיכון.

6. אין בוויתור שבסעיף 5 כדי לגרוע מאחריות "${LEGAL_NAME}" לפי דין, לרבות בשל רשלנות של "${LEGAL_NAME}" או של מי שפעל מטעמה.

7. ידוע לי כי הצוות רשאי להפסיק את ההשתתפות בכל עת, אם לדעתו היא מסכנת את המשתתף/ת או אחרים.

[[8. חתימת הורה או אפוטרופוס על מסמך זה מחייבת גם את המשתתפים הקטינים המפורטים לעיל, ומהווה הסכמה להשתתפותם בפעילות.]]`;
}

/**
 * The plain-language summary. Like the waiver itself it names nobody: one
 * signature now covers the signer and every minor listed above it, and those
 * names are printed above the signature field rather than woven into the text.
 */
function buildSummary({ riskBullet }) {
  return `• ${riskBullet}
• את הסיכון הרגיל של הפעילות אני לוקח/ת על עצמי[[, ועבור ילדי הקטינים המפורטים לעיל]].
• אין במסמך כדי לגרוע מאחריות "${LEGAL_NAME}" לפי דין, לרבות בשל רשלנות שלה או של מי שפעל מטעמה.
• מסרתי מידע רפואי מלא ונכון, ואין מגבלה רפואית שלא סיפרתי עליה.
• ההחלטה שהפעילות מתאימה למצב הבריאותי היא שלי, ובמקרה הצורך לאחר התייעצות עם רופא.
• אני מתחייב/ת לפעול לפי הוראות הבטיחות והצוות, ולדווח מיד על פציעה או תחושה לא טובה.
• הצוות רשאי להפסיק את ההשתתפות אם היא מסכנת את המשתתף/ת או אחרים.
[[• הורה שחותם — חותם גם בשם הילד/ה.]]
• זהו חוזה מחייב, לא טופס.`;
}

/**
 * The medical half. Identical everywhere: a heart condition does not become
 * safer because the activity is an event, and a family that answered
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
  // Before the catch-all, so m9 stays last on the screen. The id skips m10 on
  // purpose: that number was a claustrophobia question the trip templates
  // carried and the unified migration removed.
  { id: 'm11', kind: 'screen', requireYes: false, audience: 'adult_female', requiresClearance: true, label: 'האם המשתתפת בהריון?' },
  { id: 'm9', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש מגבלה רפואית, אבחנה או מידע אחר שחשוב שנדע ולא נשאלנו עליו כאן?' },
];

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
 * The two legal scopes. `slug` is what the public link carries
 * (/health, /health/trip). Old /health/event and /health/birthday links resolve
 * to the wall scope in the server.
 */
const ACTIVITIES = [
  {
    slug: 'wall',
    title: 'הצהרת בריאות ובטיחות + הסרת אחריות',
    activityPhrase: 'פעילות וטיפוס בקיר — לרבות חוג, אימון, כניסה חד־פעמית ואירוע',
    riskClause: 'ידוע לי כי טיפוס ספורטיבי, על כל צורותיו, הוא פעילות אתגרית הכרוכה מטבעה בסיכון לפגיעה גופנית — לרבות נפילה, החלקה, פגיעה מציוד, מאמץ יתר ופציעה — וכי סיכון זה קיים גם בהקפדה מלאה על הוראות הבטיחות.',
    riskBullet: 'טיפוס הוא פעילות אתגרית. גם כשמקפידים על כל כללי הבטיחות אפשר להיפצע.',
    // New ids rather than reworded s2..s5: an old signature keeps its own
    // wording in its snapshot, and a rule that says something else under the
    // same id would let a re-rendered copy claim it was agreed to.
    safety: [
      safety('w1', 'יש לפעול בכל עת לפי הוראות הצוות המקצועי — שימוש בציוד ובמתקנים מותר רק באישורם'),
      safety('w2', 'אין לרוץ או להשתולל בכל מתחם הקיר', { childOnly: true }),
      safety('w3', 'אין לטפס או לאבטח ללא קבלת תדריך ומעבר של מבחן בטיחות'),
      safety('w4', 'אבטוח הוא אחריות על חיי המטפס — יש להתייחס אליו ברצינות מוחלטת ולבצע אותו בהתאם לתדריך שתקבלו'),
      safety('w5', 'יש לדווח מיידית על כל מפגע, תקלה, פציעה או תחושה חריגה'),
      // Asked of a parent only, and last: it is a statement about what they did
      // before signing, not another rule to read.
      safety('w7', 'אני מאשר/ת שהסברתי לילדי את הכללים הללו', { childOnly: true }),
    ],
  },
  {
    slug: 'trip',
    title: 'הצהרת בריאות ובטיחות + הסרת אחריות — יציאה / טיול',
    activityPhrase: 'יציאה לטיול הליכה / סנפלינג / טיפוס / מערנות',
    // A trip may be one of these activities, or combine some of them. The
    // wording must not claim that every outing necessarily includes all three.
    riskClause: 'ידוע לי כי היציאה כוללת פעילות אתגרית בשטח — טיפוס / סנפלינג / מערנות, בהתאם לפעילות שנבחרה — הכרוכה מטבעה בסיכון לפגיעה גופנית, לרבות נפילה, החלקה, התדרדרות אבנים, פגיעה מציוד ומאמץ יתר. אם הפעילות כוללת כניסה למערה, ידוע לי כי היא מוסיפה סיכונים משלה: חללים צרים וחשוכים, רטיבות והחלקה, קור, ותלות בתאורה ובציוד. ידוע לי כי ליציאה לשטח נלווים סיכונים שאינם קיימים במתקן סגור — תנאי מזג אוויר ושטח, בעלי חיים, הנסיעה אל אתר הפעילות וממנו, וריחוק ממענה רפואי מיידי. הסיכון קיים גם בהקפדה מלאה על הוראות הבטיחות.',
    riskBullet: 'היציאה כוללת טיפוס / סנפלינג / מערנות, בהתאם לפעילות שנבחרה, וכרוכה בסיכוני שטח, מזג אוויר, נסיעה וריחוק מעזרה רפואית.',
    safety: [
      safety('s2', 'יש להישמע להוראות המדריך האחראי בכל עת, ואין להתרחק מהקבוצה'),
      safety('s3', 'חובה להגיע עם הציוד, הביגוד והנעליים המתאימים כפי שנדרש ליציאה'),
      safety('s4', 'כל אחת מהפעילויות טיפוס / סנפלינג / כניסה למערה תתאפשר רק למי שקיבל/ה תדריך מסודר ורק בהשגחת מדריך'),
      safety('s5', 'אין לגעת בציוד, בחבלים או בעיגונים ללא הוראת מדריך'),
      safety('s6', 'אם הפעילות כוללת כניסה למערה, חובה לחבוש קסדה ולהשתמש בתאורה, ואין להיכנס, להתפצל או לצאת ללא הוראת מדריך'),
      safety('s7', 'יש להצטייד במים בכמות מתאימה ולדווח מיד על תשישות, סחרחורת, קוצר נשימה או תחושה לא טובה'),
      safety('s8', 'ידוע לי כי הצוות רשאי לשנות או לבטל את מסלול הפעילות משיקולי בטיחות ומזג אוויר'),
    ],
  },
];

/** The full desired content of one template row. */
export function declarationFor(activity) {
  return {
    // The slug and activityType are written too: a template that was renamed
    // has to move, not be duplicated alongside the one it replaced.
    slug: activity.slug,
    activityType: activity.slug,
    title: activity.title,
    waiverText: buildWaiver(activity),
    waiverSummary: buildSummary(activity),
    healthQuestions: [
      ...MEDICAL_QUESTIONS,
      fitnessConfirmation(activity.activityPhrase),
      ...activity.safety,
    ],
  };
}

export const DECLARATIONS = Object.fromEntries(
  ACTIVITIES.map((activity) => [activity.slug, declarationFor(activity)])
);

/**
 * One-time, deploy-safe migration for the event→wall merge.
 *
 * It runs only while an active legacy event template exists, or while the wall
 * still contains the removed accompaniment clause. Once migrated, later owner
 * edits are left alone on every restart.
 */
export async function migrateUnifiedWallWaiver({ database = db, persist = null } = {}) {
  const rows = database.get('form_templates') || [];
  const legacy = rows.filter((template) => (
    ['event', 'birthday'].includes(String(template.slug || '').toLowerCase())
  ));
  const wall = rows.find((template) => template.slug === 'wall')
    || rows.find((template) => template.isDefault);
  const hasRemovedAccompanimentClause = (wall?.healthQuestions || []).some((question) => (
    String(question?.id || '').toLowerCase() === 's1'
    && /ליווי מבוגר|גיל 11/.test(String(question?.label || ''))
  ));
  const needsMigration = legacy.some((template) => template.isActive !== false)
    || hasRemovedAccompanimentClause;
  if (!needsMigration) return { updated: 0, retired: 0 };

  let updated = 0;
  let retired = 0;
  if (wall) {
    const saved = database.update('form_templates', wall.id, {
      ...DECLARATIONS.wall,
      activityType: 'wall',
      activityTypes: ['wall'],
    });
    if (saved) {
      updated += 1;
      if (persist) await persist('form_templates', saved);
    }
  }
  for (const template of legacy) {
    if (template.isActive === false && template.isDefault === false) continue;
    const saved = database.update('form_templates', template.id, {
      isActive: false,
      isDefault: false,
    });
    if (saved) {
      retired += 1;
      if (persist) await persist('form_templates', saved);
    }
  }
  return { updated, retired };
}

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
  if (current && current.slug !== desired.slug) {
    console.log(`  ~ slug (${current.slug} → ${desired.slug}) — הכתובת הישנה תמשיך לעבוד`);
  }
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
  const retiredEventTemplates = rows.filter((template) => (
    ['event', 'birthday'].includes(String(template.slug || '').toLowerCase())
  ));

  const plan = [];
  for (const activity of ACTIVITIES) {
    // `formerSlug` is how a renamed template is found the first time, so it is
    // updated in place instead of leaving the old one behind as a second form.
    const current = rows.find((t) => t.slug === activity.slug)
      || (activity.formerSlug ? rows.find((t) => t.slug === activity.formerSlug) : null)
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
    retiredEventTemplates.forEach((template) => {
      console.log(`\n=== ${template.slug} — תבנית היסטורית שתכובה ותוחלף באישור הקיר`);
    });
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
  for (const template of retiredEventTemplates) {
    db.update('form_templates', template.id, { isActive: false, isDefault: false });
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
  for (const template of retiredEventTemplates) {
    const result = await supa.upsert('form_templates', {
      ...template,
      isActive: false,
      isDefault: false,
    });
    if (!result?.ok) throw new Error(`${template.slug}: כיבוי התבנית ההיסטורית נכשל — ${result?.error || ''}`);
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
  for (const template of retiredEventTemplates) {
    const row = (after || []).find((candidate) => candidate.id === template.id);
    if (row?.isActive !== false) mismatched.push(`${template.slug}/isActive`);
  }
  if (mismatched.length) throw new Error(`נשמר חלקית: ${mismatched.join(', ')}`);
  console.log('\n✅ שני האישורים נשמרו ב-CRM החי ותבניות האירוע ההיסטוריות כובו ואומתו.');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  apply({ dry: process.argv.includes('--dry'), remote: process.argv.includes('--remote') })
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
