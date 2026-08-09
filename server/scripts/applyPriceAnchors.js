/**
 * חיבור המחירון הקיים לעוגני מחיר.
 *
 * הרצה:
 *   node scripts/applyPriceAnchors.js           → הדמיה, מדפיס טבלה ולא נוגע בכלום
 *   node scripts/applyPriceAnchors.js --apply   → כתיבה ל-Supabase + db.json
 *
 * לפני --apply מול המערכת החיה: pm2 stop crm-api, כדי שהשרת הרץ לא ידרוס את
 * db.json מהעותק שבזיכרון שלו. אין צורך במיגרציית SQL — המחירון נשמר כמסמכי
 * JSON ב-kv_collections, ושדה חדש נשמר בו מעצמו.
 *
 * המחירים לא זזים. לכל כרטיסייה מחושבת ההנחה שמשחזרת בדיוק את המחיר שהיא
 * נמכרת בו היום, ומכאן והלאה שינוי מחיר העוגן הוא זה שמזיז אותה. פריטי בדיקה
 * (מחיר עד 5 ₪) נשארים בחוץ — הנחה של 99.9% אינה נתון שמישהו יוכל לקרוא.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');
const { discountPercentFor, computeAnchoredPrice } = await import('../pricelistPricing.js');

const APPLY = process.argv.includes('--apply');
const TEST_ITEM_MAX_PRICE = 5;

/** העוגן השני: אימון עם מדריך אינו כניסה לקיר, ובסיס המחיר שלו אחר. */
const COACH_ANCHOR = {
  name: 'אימון אישי עם מדריך',
  price: 150,
  description: 'אימון בודד עם מדריך. מפתח המחיר של כרטיסיות האימון.',
  categories: ['אימונים אישיים'],
  category: 'אימונים אישיים',
  product_type: 'product',
  is_price_anchor: true,
  active: true,
  grants_wall_climbing: true,
  requires_customer: false,
  track_inventory: false,
};

const isCoachCard = (item) => /אימון|אימונים/.test(String(item.name || ''));

async function save(table, row) {
  db.update(table, row.id, row);
  const result = await supa.upsert(table, row);
  if (result?.ok === false) throw new Error(`${row.name}: ${result.error}`);
}

async function main() {
  await initDb();
  const items = db.get('pricelist') || [];

  const entryAnchor = items.find((row) => String(row.name).trim() === 'כניסה לקיר');
  if (!entryAnchor) throw new Error('לא נמצא פריט „כניסה לקיר” במחירון');

  let coachAnchor = items.find((row) => String(row.name).trim() === COACH_ANCHOR.name);
  const plan = [];

  if (!entryAnchor.is_price_anchor) {
    plan.push({ what: 'סימון עוגן', name: entryAnchor.name, detail: `₪${entryAnchor.price}` });
  }
  if (!coachAnchor) {
    plan.push({ what: 'פריט חדש (עוגן)', name: COACH_ANCHOR.name, detail: `₪${COACH_ANCHOR.price}` });
  }

  const links = [];
  for (const item of items) {
    const type = item.product_type;
    if (type !== 'punch_card' && type !== 'time_membership') continue;
    if (item.id === entryAnchor.id || item.id === coachAnchor?.id) continue;
    if (item.price_anchor_id) continue;
    const price = Number(item.price) || 0;
    if (price <= TEST_ITEM_MAX_PRICE) {
      plan.push({ what: 'דילוג (פריט בדיקה)', name: item.name, detail: `₪${price}` });
      continue;
    }

    const toCoach = isCoachCard(item);
    const anchorPrice = toCoach ? COACH_ANCHOR.price : Number(entryAnchor.price);
    const units = type === 'punch_card'
      ? Number(item.visits_total) || 0
      : Math.max(1, Math.round(price / anchorPrice));
    if (!units) {
      plan.push({ what: 'דילוג (אין יחידות)', name: item.name, detail: `₪${price}` });
      continue;
    }

    const percent = discountPercentFor(price, units, anchorPrice);
    links.push({ item, toCoach, units, percent, price, anchorPrice });
    plan.push({
      what: toCoach ? 'עוגן אימון' : 'עוגן כניסה',
      name: item.name,
      detail: `${units} × ₪${anchorPrice} ${percent >= 0 ? 'פחות' : 'ועוד'} ${Math.abs(percent)}% = ₪${price}`,
    });
  }

  console.log(`\n${APPLY ? '🖊️  מיישם' : '👀 הדמיה'} — ${plan.length} שינויים:\n`);
  for (const row of plan) console.log(`  ${row.what.padEnd(22)} ${String(row.name).padEnd(38)} ${row.detail}`);

  if (!APPLY) {
    console.log('\nלהרצה אמיתית: node scripts/applyPriceAnchors.js --apply\n');
    return;
  }

  if (!entryAnchor.is_price_anchor) {
    await save('pricelist', { ...entryAnchor, is_price_anchor: true });
  }
  if (!coachAnchor) {
    coachAnchor = db.insert('pricelist', { ...COACH_ANCHOR });
    const result = await supa.upsert('pricelist', coachAnchor);
    if (result?.ok === false) throw new Error(`יצירת עוגן האימון נכשלה: ${result.error}`);
  } else if (!coachAnchor.is_price_anchor) {
    await save('pricelist', { ...coachAnchor, is_price_anchor: true });
  }

  for (const link of links) {
    const anchor = link.toCoach ? coachAnchor : entryAnchor;
    const row = {
      ...link.item,
      price_anchor_id: anchor.id,
      anchor_units: link.item.product_type === 'punch_card' ? null : link.units,
      anchor_discount_percent: link.percent,
    };
    // בדיקת ביטחון אחרונה: המחיר הנגזר חייב לצאת בדיוק המחיר הקיים.
    const derived = computeAnchoredPrice(row, anchor);
    if (derived !== link.price) {
      throw new Error(`${link.item.name}: המחיר הנגזר ${derived} אינו זהה למחיר הקיים ${link.price}`);
    }
    await save('pricelist', row);
  }

  console.log(`\n✅ הושלם — ${links.length} פריטים קושרו לעוגן, המחירים לא זזו.\n`);
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
