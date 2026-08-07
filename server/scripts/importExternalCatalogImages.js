/**
 * Bring catalog photos that live on someone else's server into ours.
 *
 * Twenty-nine products pointed at upload.wikimedia.org or an importer's site.
 * Those hosts owe us nothing: the day one of them renames a file or takes it
 * down, the product loses its picture here and no one finds out until a
 * customer opens the shop. This downloads each one, shrinks it the way the
 * upload form shrinks a photo staff pick themselves, and stores it in our own
 * bucket — after which nothing in the catalog depends on an outside address.
 *
 *   node scripts/importExternalCatalogImages.js --dry-run
 *   node scripts/importExternalCatalogImages.js
 *
 * The rows it is about to change are written to a backup file first; feed that
 * file to migrateCatalogImagesToStorage.js --restore to put them back.
 *
 * Needs the `sharp` devDependency. It is deliberately not a runtime dependency:
 * nothing on the server resizes images during normal use, so a native module
 * that failed to build on deploy would take the API down for no benefit.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { supa, productImageStoragePath } from '../supa.js';
import { persistCore } from '../db.js';
import { storeImageValue } from '../productImages.js';

const TABLES = [
  { table: 'pricelist', prefix: 'products' },
  { table: 'product_categories', prefix: 'categories' },
];

// The same shape the browser-side picker produces, so an imported photo and an
// uploaded one weigh the same.
const MAX_SIDE = 720;
const JPEG_QUALITY = 72;

// Wikimedia answers 429 to a burst from one address. This is a one-off job, so
// waiting is free; failing half the catalog is not.
const DELAY_MS = 1200;
const ATTEMPTS = 4;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const kb = (n) => `${Math.round(n / 1024)} KB`;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function download(url) {
  let lastError = 'unknown';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'climbing-crm/1.0 (catalog image import)' },
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        await wait(DELAY_MS * 2 * attempt);
        continue;
      }
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const contentType = String(res.headers.get('content-type') || '');
      if (!contentType.startsWith('image/')) {
        return { ok: false, error: `not an image (${contentType || 'no content-type'})` };
      }
      return { ok: true, buffer: Buffer.from(await res.arrayBuffer()) };
    } catch (error) {
      lastError = error.message;
      await wait(DELAY_MS * attempt);
    }
  }
  return { ok: false, error: lastError };
}

async function shrink(buffer) {
  const { default: sharp } = await import('sharp');
  const image = sharp(buffer, { failOn: 'none' });
  const meta = await image.metadata();
  const longest = Math.max(meta.width || 0, meta.height || 0);
  const pipeline = longest > MAX_SIDE
    ? image.resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    : image;
  // Flattened onto white: a transparent PNG turned into JPEG would otherwise
  // come out with black behind the product.
  return pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

async function main() {
  const plan = [];
  for (const { table, prefix } of TABLES) {
    const rows = await supa.getAll(table);
    if (!Array.isArray(rows)) throw new Error(`could not read ${table}`);
    for (const row of rows) {
      const url = String(row?.image || '');
      if (!url.startsWith('http') || productImageStoragePath(url)) continue;
      plan.push({ table, prefix, row, url });
    }
  }

  if (plan.length === 0) {
    console.log('Nothing to do — no catalog row points at an outside address.');
    return;
  }

  console.log(`${plan.length} catalog photo(s) still hosted elsewhere:`);
  for (const entry of plan) {
    console.log(`  ${new URL(entry.url).hostname.padEnd(28)} ${entry.row.name || entry.row.id}`);
  }
  if (dryRun) {
    console.log('\n--dry-run: nothing was downloaded or written.');
    return;
  }

  const backupFile = path.join(process.cwd(), `catalog-images-backup-${Date.now()}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ created_at: new Date().toISOString(), rows: plan.map(({ table, row }) => ({ table, row })) }, null, 2),
    'utf-8'
  );
  console.log(`\nBackup of the original rows: ${path.basename(backupFile)}\n`);

  let imported = 0;
  let before = 0;
  let after = 0;
  const failures = [];

  for (const entry of plan) {
    const label = entry.row.name || entry.row.id;
    const got = await download(entry.url);
    if (!got.ok) {
      failures.push(`${label} — ${got.error}`);
      console.error(`  ✗ ${label} — ${got.error}`);
      await wait(DELAY_MS);
      continue;
    }
    let shrunk;
    try {
      shrunk = await shrink(got.buffer);
    } catch (error) {
      failures.push(`${label} — could not read the image (${error.message})`);
      console.error(`  ✗ ${label} — could not read the image`);
      await wait(DELAY_MS);
      continue;
    }

    const dataUri = `data:image/jpeg;base64,${shrunk.toString('base64')}`;
    const stored = await storeImageValue(dataUri, entry.prefix);
    if (!stored.startsWith('http') || stored === dataUri) {
      failures.push(`${label} — upload failed`);
      console.error(`  ✗ ${label} — upload failed`);
      await wait(DELAY_MS);
      continue;
    }

    const result = await persistCore(entry.table, { ...entry.row, image: stored });
    if (result?.ok === false) {
      failures.push(`${label} — save failed: ${result.error}`);
      console.error(`  ✗ ${label} — save failed: ${result.error}`);
      await wait(DELAY_MS);
      continue;
    }

    imported += 1;
    before += got.buffer.length;
    after += shrunk.length;
    console.log(`  ✓ ${label.padEnd(42)} ${kb(got.buffer.length).padStart(8)} → ${kb(shrunk.length).padStart(7)}`);
    await wait(DELAY_MS);
  }

  console.log(`\n${imported}/${plan.length} imported. ${kb(before)} downloaded, stored as ${kb(after)}.`);
  if (failures.length) {
    console.log('\nStill on an outside address:');
    for (const failure of failures) console.log(`  ${failure}`);
    console.log('Run the script again to retry just those.');
  }
  console.log('\nRestart the API so it re-reads the catalog.');
}

try {
  await main();
  process.exit(0);
} catch (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
