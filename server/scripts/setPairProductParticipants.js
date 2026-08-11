/**
 * מסמן על מוצרי „אימון זוגי” שיחידה אחת מכסה שני משתתפים.
 *
 * בלי זה, סימון של הילד השני בדלפק קונה יחידה שנייה — כי המערכת סופרת אדם
 * ליחידה. השדה „מספר משתתפים” קיים במחירון מזמן ושימש לתצוגה בלבד; מעכשיו
 * הוא מה שקובע את הכמות.
 *
 *   node scripts/setPairProductParticipants.js          (יבש)
 *   node scripts/setPairProductParticipants.js --apply
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
await initDb();

const APPLY = process.argv.includes('--apply');
const TARGETS = ['pr1785822570650', 'pr1785822567697'];

for (const id of TARGETS) {
  const item = db.getOne('pricelist', id);
  if (!item) { console.log(`חסר: ${id}`); continue; }
  console.log(`${item.name}: "${item.participants ?? ''}" → "2"`);
  if (APPLY) db.update('pricelist', id, { participants: '2' });
}
// הכתיבה למאגר הקבוע יוצאת ברקע; יציאה מיידית הורגת אותה, והשינוי נשאר
// רק ב-db.json המקומי.
if (APPLY) await new Promise((r) => setTimeout(r, 4000));
console.log(APPLY ? 'נשמר.' : 'הרצה יבשה — הוסיפו --apply.');
process.exit(0);
