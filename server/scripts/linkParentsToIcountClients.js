/**
 * ממלא לכל לקוח את מזהה התיק שלו ב-iCount.
 *
 * המזהה נשמר אצלנו רק כשהופקה חשבונית דרך המערכת, ולכן 6 לקוחות מתוך 1,606
 * מקושרים — כל השאר נוצרו ב-iCount לפני שהמערכת הזאת נכנסה, והקישור אליהם
 * מהדלפק פשוט לא מופיע.
 *
 * ההתאמה נעשית לפי טלפון, ובהיעדרו לפי מייל. שם הוא לא מפתח: „דנה כהן”
 * יכולה להיות שתי משפחות, וקישור שגוי כאן שולח דלפקיסט לתיק הכספי של אדם
 * אחר. מזהה שמופיע אצל יותר מאחד — בשני הצדדים — נפסל ולא מקושר.
 *
 * רשימת התיקים ב-iCount מחזירה שם ומייל בלבד, ולכן הטלפון נמשך בקריאה
 * נפרדת לכל תיק. זה כמה מאות קריאות ולוקח דקה או שתיים.
 *
 * הרצה מתוך תיקיית server:
 *   node scripts/linkParentsToIcountClients.js           דוח בלבד
 *   node scripts/linkParentsToIcountClients.js --apply   שמירה
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb, persistCore } = await import('../db.js');
const icount = await import('../icount.js');

const APPLY = process.argv.includes('--apply');

/** תשע הספרות האחרונות — כך 0528310928 ו-972528310928 הם אותו מספר. */
function phoneKey(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

const emailKey = (raw) => String(raw || '').trim().toLowerCase();

/**
 * רשומות שאין להן שם אמיתי — „לקוח וואטסאפ” וחבריו. הטלפון שלהן הוא לעיתים
 * מספר כללי, וההתאמה שלו קישרה אחת מהן לתיק של מרכז רפואי. רשומה בלי שם
 * אינה שווה קישור לתיק כספי של מישהו.
 */
const PLACEHOLDER_NAMES = /^(לקוח|לקוח וואטסאפ|וואטסאפ|לא ידוע|ללא שם|test|בדיקה)$/i;
const isPlaceholder = (name) => !String(name || '').trim() || PLACEHOLDER_NAMES.test(String(name).trim());

/** מפתח → ערך יחיד, או null אם המפתח מופיע יותר מפעם אחת. */
function uniqueIndex(rows, keyOf) {
  const seen = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    seen.set(key, seen.has(key) ? null : row);
  }
  return seen;
}

async function main() {
  await initDb();
  if (!icount.isConfigured()) throw new Error('iCount לא מוגדר — אין מה למשוך');

  const parents = db.get('parents') || [];
  const already = parents.filter((p) => p.icount_client_id).length;
  console.log(`לקוחות אצלנו: ${parents.length} · מקושרים כבר: ${already}`);

  const listed = Object.values((await icount.listClients()) || {});
  console.log(`תיקים ב-iCount: ${listed.length} — מושך פרטים...`);

  const clients = [];
  for (const row of listed) {
    if (!row?.client_id) continue;
    try {
      clients.push((await icount.getClientInfo(row.client_id)) || row);
    } catch {
      clients.push(row);
    }
    if (clients.length % 50 === 0) console.log(`  ${clients.length}/${listed.length}`);
  }

  const clientByPhone = uniqueIndex(clients, (c) => phoneKey(c.mobile || c.phone));
  const clientByEmail = uniqueIndex(clients, (c) => emailKey(c.email));
  const parentByPhone = uniqueIndex(parents, (p) => phoneKey(p.phone));
  const parentByEmail = uniqueIndex(parents, (p) => emailKey(p.email));

  const matches = [];
  const ambiguous = [];
  const skipped = [];
  for (const parent of parents) {
    if (parent.icount_client_id) continue;
    if (isPlaceholder(parent.name)) { skipped.push(parent.name || '(בלי שם)'); continue; }

    const phone = phoneKey(parent.phone);
    if (phone) {
      if (parentByPhone.get(phone) === null) {
        ambiguous.push([parent.name, 'הטלפון משותף לכמה לקוחות אצלנו']);
      } else {
        const byPhone = clientByPhone.get(phone);
        if (byPhone === null) {
          ambiguous.push([parent.name, 'הטלפון משותף לכמה תיקים ב-iCount']);
        } else if (byPhone?.client_id) {
          matches.push({ parent, clientId: String(byPhone.client_id), clientName: byPhone.client_name, by: 'טלפון' });
          continue;
        }
      }
    }

    // מייל הוא גיבוי בלבד: משפחות רבות חולקות תיבה אחת, ולכן רק מייל שמופיע
    // פעם אחת בכל צד נחשב זיהוי.
    const email = emailKey(parent.email);
    if (!email) continue;
    if (parentByEmail.get(email) === null) continue;
    const byEmail = clientByEmail.get(email);
    if (!byEmail?.client_id) continue;
    matches.push({ parent, clientId: String(byEmail.client_id), clientName: byEmail.client_name, by: 'מייל' });
  }

  console.log(`\nהתאמות לפי טלפון: ${matches.length}`);
  for (const m of matches.slice(0, 15)) {
    const same = String(m.parent.name || '').trim() === String(m.clientName || '').trim();
    console.log(`  ${m.parent.name} → ${m.clientId} [${m.by}]${same ? '' : `  (ב-iCount: ${m.clientName})`}`);
  }
  if (matches.length > 15) console.log(`  ... ועוד ${matches.length - 15}`);
  // שם שונה לגמרי אינו בהכרח טעות — אצלנו רשום לא פעם שם הילד, ואצל iCount
  // שם ההורה המשלם. זה כן המקום היחיד שבו קישור שגוי יתגלה, ולכן הוא נספר.
  const nameMismatch = matches.filter(
    (m) => String(m.parent.name || '').trim() !== String(m.clientName || '').trim()
  ).length;
  console.log(`מתוכן בשם שונה מהשם ב-iCount: ${nameMismatch}`);
  if (skipped.length) console.log(`דולגו רשומות בלי שם אמיתי: ${skipped.length}`);
  if (ambiguous.length) {
    console.log(`\nלא קושרו בגלל טלפון כפול: ${ambiguous.length}`);
    for (const [name, why] of ambiguous.slice(0, 10)) console.log(`  ${name} — ${why}`);
  }

  if (!APPLY) {
    console.log('\nדוח בלבד — הוסיפו --apply כדי לשמור.');
    return;
  }

  let saved = 0;
  for (const m of matches) {
    const updated = db.update('parents', m.parent.id, { icount_client_id: m.clientId });
    if (updated) {
      await persistCore('parents', updated);
      saved += 1;
    }
  }
  console.log(`\nנשמרו ${saved} קישורים.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
