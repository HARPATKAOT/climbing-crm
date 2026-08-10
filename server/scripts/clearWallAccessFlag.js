/**
 * הסרת הסימון „מקנה כניסה לקיר” ממוצרים שסומנו בו בטעות.
 *
 * הרצה:
 *   node scripts/clearWallAccessFlag.js "שם מוצר" ["שם נוסף"]            → הדמיה
 *   node scripts/clearWallAccessFlag.js "שם מוצר" --apply                → כתיבה
 *
 * הסימון קובע שני דברים: שהמוצר מייצר כרטיס כניסה לקיר, ושמכירתו חסומה למי
 * שאין לו טופס השתתפות בתוקף. מוצר שסומן בטעות פותח כניסות שאיש לא התכוון
 * למכור, ולכן ההסרה היא תיקון ולא העדפה.
 *
 * המחירון הוא אוסף kv — אין מיגרציה, השדה נשמר כמו שהוא.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');

const APPLY = process.argv.includes('--apply');
const names = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!names.length) {
  console.error('יש למסור לפחות שם מוצר אחד');
  process.exit(1);
}

await initDb();

const wanted = names.map((name) => name.trim());
const items = (db.get('pricelist') || []).filter((item) => (
  item.grants_wall_climbing === true && wanted.includes(String(item.name || '').trim())
));

const missing = wanted.filter((name) => !items.some((item) => String(item.name).trim() === name));
for (const name of missing) console.log(`⚠ לא נמצא מוצר פעיל עם הסימון בשם "${name}"`);

console.log(`\nמוצרים שהסימון יוסר מהם: ${items.length}`);
for (const item of items) console.log(`  ${item.name} · ₪${item.price} · ${item.product_type || 'product'}`);

if (!APPLY) {
  console.log('\nהדמיה בלבד. להרצה אמיתית: --apply');
  process.exit(0);
}

let saved = 0;
for (const item of items) {
  const updated = { ...item, grants_wall_climbing: false, updated_at: new Date().toISOString() };
  const result = await supa.upsert('pricelist', updated);
  if (result?.ok === false) {
    console.error(`  ✗ ${item.name}: ${result.error}`);
    continue;
  }
  db.update('pricelist', item.id, { grants_wall_climbing: false });
  saved += 1;
}
console.log(`\nהוסרו: ${saved}`);
process.exit(saved === items.length ? 0 : 1);
