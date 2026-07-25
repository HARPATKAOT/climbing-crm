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
