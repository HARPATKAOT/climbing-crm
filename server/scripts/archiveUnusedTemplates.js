/**
 * מעביר לארכיון את התבניות שאיש כבר לא שולח.
 *
 * הרשימה למטה היא תוצאת ביקורת מ-12.8.2026: כל תבנית נבדקה מול היסטוריית
 * השליחה (10.7.2026 ואילך) ומול חיפוש בקוד השרת והלקוח אחרי שם התבנית. נכנסה
 * לכאן רק תבנית שנכשלה בשני המבחנים — אפס שליחות, ואין שום מסלול בקוד ששולח
 * אותה.
 *
 * ארכיון ולא מחיקה: מחיקה מוחקת את התבנית גם אצל Meta ואי אפשר להחזיר, בעוד
 * שארכיון רק מוציא אותה מכל רשימות השליחה — מהדיוור, מכרטיס הלקוח ומהמסלולים
 * האוטומטיים — ואפשר לשחזר בלחיצה מהמסך.
 *
 * הכתיבה היא ישירות ל-Supabase, כי ה-API החי דורש כניסה כמנהל. השרת קורא את
 * הטבלה מחדש בעליית התהליך, ולכן השינוי מופיע אחרי הדפלוי הבא.
 *
 * הרצה מתוך server/:
 *   node scripts/archiveUnusedTemplates.js          מה עומד לקרות
 *   node scripts/archiveUnusedTemplates.js --apply  ביצוע
 */
import 'dotenv/config';

const APPLY = process.argv.includes('--apply');

/** שם התבנית ב-Meta, והסיבה שהיא כאן. */
export const UNUSED_TEMPLATES = [
  ['hello', 'תבנית בדיקה מימי החיבור לוואטסאפ'],
  ['heloo', 'תבנית בדיקה'],
  ['coustumer_details', 'הגרסה הישנה של טופס ההצטרפות — הכפתור מוביל לטופס חיצוני'],
  ['equipment_payment_link', 'מסך הציוד שולח equipment_update_or_purchase_v2'],
  ['summer_camp2', 'קמפיין קיץ שלא יצא לדרך'],
  ['event_host_payment_v2', 'גרסה ישנה — v4 היא הנשלחת'],
  ['event_host_payment_v3', 'גרסה ישנה — v4 היא הנשלחת'],
  ['event_participant_link_v2', 'גרסה ישנה — v4 היא הנשלחת'],
  ['event_participant_link_v3', 'גרסה ישנה — v4 היא הנשלחת'],
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function headers() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('חסרים SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ב-server/.env');
    process.exit(1);
  }

  const names = UNUSED_TEMPLATES.map(([name]) => name);
  const query = `meta_name=in.(${names.join(',')})&select=id,meta_name,status,archived`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/message_templates?${query}`, {
    headers: headers(),
  });
  const rows = await res.json();
  if (!res.ok) throw new Error(rows?.message || 'קריאת התבניות נכשלה');

  const found = new Map(rows.map((row) => [row.meta_name, row]));
  const pending = [];
  for (const [name, why] of UNUSED_TEMPLATES) {
    const row = found.get(name);
    if (!row) {
      console.log(`  ✗ ${name} — לא נמצאה בטבלה`);
      continue;
    }
    if (row.archived) {
      console.log(`  · ${name} — כבר בארכיון`);
      continue;
    }
    console.log(`  → ${name} — ${why}`);
    pending.push(row);
  }

  if (!pending.length) {
    console.log('\nאין מה לעשות.');
    return;
  }
  if (!APPLY) {
    console.log(`\n${pending.length} תבניות יועברו לארכיון. הרצה עם --apply לביצוע.`);
    return;
  }

  const ids = pending.map((row) => row.id);
  const update = await fetch(
    `${SUPABASE_URL}/rest/v1/message_templates?id=in.(${ids.map(encodeURIComponent).join(',')})`,
    {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ archived: true, updated_at: new Date().toISOString() }),
    }
  );
  const updated = await update.json();
  if (!update.ok) throw new Error(updated?.message || 'העדכון נכשל');
  console.log(`\n✅ ${updated.length} תבניות הועברו לארכיון.`);
  console.log('השינוי יופיע במערכת אחרי הדפלוי/הפעלה מחדש של השרת.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
