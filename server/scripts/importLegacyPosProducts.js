/**
 * ייבוא מוצרי הקופה הישנה למחירון — עם תמונות אמיתיות מהרשת.
 *
 * הרצה:
 *   node scripts/importLegacyPosProducts.js            → הדמיה
 *   node scripts/importLegacyPosProducts.js --apply    → כתיבה ל-Supabase + db.json
 *   node scripts/importLegacyPosProducts.js --apply --skip-images → בלי הורדת תמונות
 *
 * לפני --apply מול המערכת החיה: לעצור שרת מקומי (pm2 stop crm-api),
 * כדי שלא ידרוס את המחירון במסד.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');
const { clampImage } = await import('../productCategories.js');

const APPLY = process.argv.includes('--apply');
const SKIP_IMAGES = process.argv.includes('--skip-images');
const SEED = path.resolve(HERE, 'legacy-pos-products.json');
const IMAGE_MAP_FILE = path.resolve(HERE, 'legacy-pos-product-images.json');
const IMAGE_DIR = path.resolve(HERE, '../../client/public/product-images');
const MAX_IMAGE_CHARS = 700_000;
const OPENVERSE = 'https://api.openverse.org/v1/images/';
const WIKI_API = 'https://commons.wikimedia.org/w/api.php';

const DIRECT_IMAGE_URLS = fs.existsSync(IMAGE_MAP_FILE)
  ? JSON.parse(fs.readFileSync(IMAGE_MAP_FILE, 'utf8'))
  : {};

function normName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function slugify(name) {
  return String(name || '')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .toLowerCase() || 'product';
}

function daysUntil(isoDate) {
  const end = new Date(`${isoDate}T23:59:59`);
  const now = new Date();
  const ms = end.getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function findExisting(existing, seed) {
  const candidates = [
    seed.name,
    ...(Array.isArray(seed.match_names) ? seed.match_names : []),
  ].map(normName);
  return existing.find((row) => candidates.includes(normName(row.name)));
}

async function extractOgImage(pageUrl) {
  if (!pageUrl) return '';
  try {
    const res = await fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KirBoazCatalog/1.0)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    const m =
      html.match(/property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/content="([^"]+)"\s+property="og:image"/i) ||
      html.match(/"og:image"\s*:\s*"([^"]+)"/i);
    return m?.[1] ? String(m[1]).replace(/^http:\/\//i, 'https://') : '';
  } catch {
    return '';
  }
}

function cleanWikiUrl(url) {
  if (!url) return '';
  return String(url).replace(/^http:\/\//i, 'https://').split('?')[0];
}

async function searchWikimedia(query) {
  if (!query) return '';
  const url = `${WIKI_API}?${new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '480',
    format: 'json',
    origin: '*',
  })}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KirBoazCatalog/1.0 (climbing-crm import)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const json = await res.json();
    const pages = Object.values(json.query?.pages || {});
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      const candidate = cleanWikiUrl(info?.thumburl || info?.url);
      if (candidate && /\.(jpe?g|png|webp)$/i.test(candidate.split('/').pop() || '')) {
        return candidate;
      }
      if (candidate) return candidate;
    }
    return '';
  } catch {
    return '';
  }
}

async function searchOpenverse(query) {
  if (!query) return '';
  const url = `${OPENVERSE}?${new URLSearchParams({
    q: query,
    page_size: '5',
    mature: 'false',
  })}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'KirBoazCatalog/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const json = await res.json();
    const hit = (json.results || []).find((r) => r?.url && !r.mature);
    return hit?.url || hit?.thumbnail || '';
  } catch {
    return '';
  }
}

async function resolveImageUrl(seed) {
  // מפת התמונות שנבנתה מראש — מקור ראשי, בלי בדיקת HEAD (חלק מהשרתים חוסמים אותה)
  const mapped = DIRECT_IMAGE_URLS[seed.name];
  if (mapped) return cleanWikiUrl(mapped) || mapped;
  if (seed.image_url) return cleanWikiUrl(seed.image_url) || seed.image_url;
  if (seed.image_page) {
    const og = await extractOgImage(seed.image_page);
    if (og) return og;
  }
  const wiki = await searchWikimedia(seed.image_query || seed.name);
  if (wiki) return wiki;
  await new Promise((r) => setTimeout(r, 400));
  return searchOpenverse(seed.image_query || seed.name);
}

async function downloadAsDataUrl(imageUrl, fileBase) {
  if (!imageUrl) return { image: '', localPath: '' };
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': 'KirBoazCatalog/1.0' },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`הורדת תמונה נכשלה (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext =
    contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
        : contentType.includes('gif') ? 'gif'
          : 'jpg';
  const mime =
    contentType.startsWith('image/') ? contentType
      : ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
          : 'image/jpeg';

  fs.mkdirSync(IMAGE_DIR, { recursive: true });
  const localName = `${fileBase}.${ext}`;
  const localPath = path.join(IMAGE_DIR, localName);
  fs.writeFileSync(localPath, buf);

  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  if (dataUrl.length <= MAX_IMAGE_CHARS) {
    return { image: dataUrl, localPath: `/product-images/${localName}` };
  }
  // גדול מדי ל-data URL — שומרים כתובת חיצונית + קובץ מקומי לפריסה
  return { image: imageUrl, localPath: `/product-images/${localName}` };
}

function buildRecord(seed, image, existing) {
  const now = new Date().toISOString();
  const validityDays = seed.validity_until
    ? daysUntil(seed.validity_until)
    : seed.validity_days != null
      ? Number(seed.validity_days)
      : null;

  const base = {
    name: seed.name,
    price: Number(seed.price) || 0,
    description: seed.description || '',
    notes: seed.notes || '',
    categories: seed.categories,
    category: seed.categories[0],
    ages: seed.ages || [],
    active: true,
    image: image || existing?.image || '',
    image_fit: seed.image_fit || 'cover',
    product_type: seed.product_type || 'product',
    track_inventory: seed.track_inventory === true,
    stock_qty: existing?.stock_qty ?? (seed.track_inventory ? 0 : null),
    visits_total: seed.visits_total != null ? Number(seed.visits_total) : null,
    validity_days: validityDays,
    duration_days: seed.duration_days != null ? Number(seed.duration_days) : null,
    updated_at: now,
  };

  if (existing) {
    return {
      ...existing,
      ...base,
      id: existing.id,
      created_at: existing.created_at || now,
      self_serve: existing.self_serve === true,
      public_slug: existing.public_slug || '',
    };
  }

  return {
    ...base,
    id: `pr${Date.now()}${Math.floor(Math.random() * 1000)}`,
    created_at: now,
    self_serve: false,
    public_slug: '',
  };
}

async function run() {
  if (!fs.existsSync(SEED)) throw new Error(`חסר קובץ זרע: ${SEED}`);
  const seeds = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  if (!Array.isArray(seeds) || !seeds.length) throw new Error('קובץ הזרע ריק');

  await initDb();
  const remote = await supa.getAll('pricelist');
  if (Array.isArray(remote) && remote.length) {
    db.set('pricelist', remote);
  }
  let existing = [...(db.get('pricelist') || [])];

  const created = [];
  const updated = [];
  const imageFails = [];
  const imageOk = [];

  for (let i = 0; i < seeds.length; i += 1) {
    const seed = seeds[i];
    process.stdout.write(`[${i + 1}/${seeds.length}] ${seed.name} … `);

    let image = '';
    if (!SKIP_IMAGES) {
      const src = await resolveImageUrl(seed);
      if (!src) {
        imageFails.push(`${seed.name}: לא נמצאה תמונה`);
      } else {
        try {
          const got = await downloadAsDataUrl(src, slugify(seed.name));
          image = clampImage(got.image);
          imageOk.push(`${seed.name} → ${got.localPath || 'url'}`);
          await new Promise((r) => setTimeout(r, 600));
        } catch (err) {
          // אם ההורדה נחסמה — שומרים כתובת https ישירה שעדיין מציגה תמונה בקופה
          image = src;
          imageFails.push(`${seed.name}: הורדה נכשלה (${err.message || err}) — נשמרה כתובת ישירה`);
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
    }

    const match = findExisting(existing, seed);
    const record = buildRecord(seed, image, match);

    if (APPLY) {
      if (match) {
        db.update('pricelist', match.id, record);
        const saved = db.getOne('pricelist', match.id) || record;
        const result = await supa.upsert('pricelist', saved);
        if (!result.ok) throw new Error(`כתיבה נכשלה ל-${seed.name}: ${result.error}`);
        existing = existing.map((row) => (row.id === match.id ? saved : row));
        updated.push(`${seed.name} (עדכון ${match.id})`);
        console.log('עודכן');
      } else {
        // מזהה ייחודי בלולאה — Date.now לבד יכול להתנגש
        const stamp = Date.now() + i;
        const toSave = { ...record, id: `pr${stamp}` };
        db.insert('pricelist', toSave);
        const result = await supa.upsert('pricelist', toSave);
        if (!result.ok) throw new Error(`כתיבה נכשלה ל-${seed.name}: ${result.error}`);
        existing.push(toSave);
        created.push(seed.name);
        console.log('נוצר');
      }
    } else {
      if (match) {
        updated.push(`${seed.name} → יתעדכן כ-${match.name} (${match.id})`);
        console.log('יעודכן (הדמיה)');
      } else {
        created.push(seed.name);
        console.log('ייווצר (הדמיה)');
      }
    }
  }

  console.log(`\nמצב: ${APPLY ? 'נכתב למסד' : 'הדמיה בלבד'}`);
  console.log(`נוצרו/ייווצרו: ${created.length}`);
  created.forEach((n) => console.log(`  + ${n}`));
  console.log(`עודכנו/יעודכנו: ${updated.length}`);
  updated.forEach((n) => console.log(`  ~ ${n}`));
  console.log(`תמונות שהצליחו: ${imageOk.length}`);
  if (imageFails.length) {
    console.log(`תמונות שנכשלו: ${imageFails.length}`);
    imageFails.forEach((n) => console.log(`  ! ${n}`));
  }
  console.log(`סה״כ במחירון אחרי: ${existing.length}`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('הייבוא נכשל:', err?.message || err);
    process.exit(1);
  });
