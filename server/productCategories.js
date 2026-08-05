/** Default product catalog categories + helpers for local persistence. */

export const DEFAULT_PRODUCT_CATEGORY_NAMES = [
  'קיוסק',
  'פעילויות',
  'אימונים אישיים',
  'כרטיסיות ומנויים',
  'ציוד טיפוס',
  'כניסה',
  'חוגים',
  'הנחות',
  'שונות',
];

const MAX_IMAGE_CHARS = 700_000; // ~500KB base64 JPEG

export function clampImage(image) {
  const s = String(image || '');
  if (!s) return '';
  if (s.length > MAX_IMAGE_CHARS) {
    throw new Error('התמונה גדולה מדי — נסו תמונה קטנה יותר');
  }
  if (s.startsWith('data:image/') || s.startsWith('https://') || s.startsWith('http://')) {
    return s;
  }
  throw new Error('פורמט תמונה לא נתמך');
}

export function defaultProductCategories() {
  return DEFAULT_PRODUCT_CATEGORY_NAMES.map((name, i) => ({
    id: `pcat-${i + 1}`,
    name,
    image: '',
    description: '',
    sort_order: i,
    active: true,
  }));
}

export function ensureProductCategories(db) {
  let rows = db.get('product_categories') || [];
  if (!Array.isArray(rows) || rows.length === 0) {
    for (const row of defaultProductCategories()) {
      db.insert('product_categories', { ...row });
    }
    rows = db.get('product_categories') || [];
  }
  return [...rows].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
}

/**
 * A product must always carry at least one category label, otherwise it becomes
 * unreachable in the catalog UI (which only lists items inside an open category).
 * Falls back to the legacy single `category` field, then to 'שונות'.
 */
export function normalizeProductCategories(item = {}) {
  const raw = Array.isArray(item.categories)
    ? item.categories
    : item.categories
      ? [item.categories]
      : [];
  const cleaned = [...new Set(raw.map((c) => String(c || '').trim()).filter(Boolean))];
  if (cleaned.length) return cleaned;
  const legacy = String(item.category || '').trim();
  return [legacy || 'שונות'];
}

/** One-time heal for rows saved before categories were enforced. */
export function backfillPricelistCategories(db) {
  const items = db.get('pricelist') || [];
  let updated = 0;
  for (const item of items) {
    const next = normalizeProductCategories(item);
    const current = Array.isArray(item.categories) ? item.categories : [];
    if (current.length === next.length && current.every((c, i) => c === next[i])) continue;
    db.update('pricelist', item.id, { categories: next, category: next[0] });
    updated += 1;
  }
  return { updated };
}

const INITIAL_WALL_ACCESS_CATEGORIES = new Set([
  'כניסה',
  'כרטיסיות ומנויים',
  'חוגים',
  'אימונים אישיים',
]);

/**
 * One-time classification for rows that predate the explicit safety flag.
 * Runtime eligibility never guesses from a product name; after this migration
 * every row carries a boolean that owners can edit in the pricelist.
 */
export function backfillWallClimbingProducts(db) {
  const changed = [];
  for (const item of db.get('pricelist') || []) {
    if (typeof item.grants_wall_climbing === 'boolean') continue;
    const categories = normalizeProductCategories(item);
    const productType = String(item.product_type || '').trim();
    const familyLegacy = String(item.name || '').trim() === 'מנוי משפחתי';
    const grantsWallClimbing = productType === 'punch_card'
      || productType === 'time_membership'
      || categories.some((category) => INITIAL_WALL_ACCESS_CATEGORIES.has(category));
    const updated = db.update('pricelist', item.id, {
      grants_wall_climbing: grantsWallClimbing,
      family_shared: familyLegacy,
      ...(familyLegacy ? { name: 'כרטיסייה משפחתית' } : {}),
    });
    if (updated) changed.push(updated);
  }
  return { updated: changed.length, rows: changed };
}

/** When a category is renamed, retarget product category labels. */
export function renameCategoryOnProducts(db, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return 0;
  const items = db.get('pricelist') || [];
  let changed = 0;
  for (const item of items) {
    const cats = Array.isArray(item.categories)
      ? item.categories
      : item.category
        ? [item.category]
        : [];
    if (!cats.includes(oldName)) continue;
    const next = [...new Set(cats.map((c) => (c === oldName ? newName : c)))];
    db.update('pricelist', item.id, {
      categories: next,
      category: next[0] || newName,
    });
    changed += 1;
  }
  return changed;
}
