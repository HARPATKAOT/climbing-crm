/**
 * Ensure a single-visit wall entry product exists under category «כניסה».
 *
 * The bot's getPrices tool reads this category. Without a row, every
 * "כמה עולה כניסה?" hands off to the team even though the answer is known.
 *
 * Default price 70 ₪ — the public Freefit listing for קיר בועז. Edit the
 * product in the CRM pricelist if that number is wrong; the bot will follow.
 *
 * Run from the server folder:
 *   node scripts/ensureWallEntryProduct.js
 *   node scripts/ensureWallEntryProduct.js --price 70
 */
import 'dotenv/config';
import { db, initDb, persistCore } from '../db.js';

const PRICE_ARG = process.argv.find((a) => a.startsWith('--price='));
const PRICE = Number(PRICE_ARG ? PRICE_ARG.split('=')[1] : 70);

const PRODUCT = {
  name: 'כניסה לקיר',
  price: PRICE,
  category: 'כניסה',
  categories: ['כניסה'],
  product_type: 'product',
  active: true,
  description: 'כניסה בודדת לקיר',
  self_serve: false,
  track_inventory: false,
  requires_customer: false,
  image: '',
  notes: '',
};

function isEntryProduct(p) {
  const cats = [
    ...(Array.isArray(p.categories) ? p.categories : []),
    p.category,
  ].filter(Boolean).map(String);
  if (cats.some((c) => c === 'כניסה')) return true;
  return String(p.name || '').trim() === 'כניסה לקיר';
}

async function main() {
  if (!Number.isFinite(PRICE) || PRICE <= 0) {
    console.error('price must be a positive number');
    process.exit(1);
  }

  await initDb();
  const list = db.get('pricelist') || [];
  const existing = list.find(isEntryProduct);

  if (existing) {
    const patch = {
      ...existing,
      name: existing.name || PRODUCT.name,
      price: Number(existing.price) > 0 ? Number(existing.price) : PRICE,
      category: 'כניסה',
      categories: ['כניסה'],
      product_type: existing.product_type || 'product',
      active: existing.active !== false,
      updated_at: new Date().toISOString(),
    };
    db.update('pricelist', existing.id, patch);
    const saved = db.getOne('pricelist', existing.id) || patch;
    await persistCore('pricelist', saved);
    console.log('updated existing entry product:', saved.id, saved.price);
    return;
  }

  const now = new Date().toISOString();
  const row = {
    id: `pr${Date.now()}`,
    ...PRODUCT,
    price: PRICE,
    created_at: now,
    updated_at: now,
  };
  db.insert('pricelist', row);
  await persistCore('pricelist', row);
  console.log('created entry product:', row.id, row.price);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
