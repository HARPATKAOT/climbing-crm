/**
 * Move catalog photos out of the rows and into the product-images bucket.
 *
 * Run once. It is safe to run again: a row whose `image` is already a URL is
 * skipped, so an interrupted run simply carries on where it stopped.
 *
 *   node scripts/migrateCatalogImagesToStorage.js --dry-run
 *   node scripts/migrateCatalogImagesToStorage.js
 *
 * Every row it is about to touch is written to a backup file first. To undo,
 * feed that file back with --restore <file>.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { supa } from '../supa.js';
import { persistCore } from '../db.js';
import { decodeInlineImage, storeImageValue } from '../productImages.js';

const TABLES = [
  { table: 'pricelist', prefix: 'products' },
  { table: 'product_categories', prefix: 'categories' },
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const restoreAt = args.indexOf('--restore');
const restoreFile = restoreAt === -1 ? '' : args[restoreAt + 1];

const kb = (n) => `${Math.round(n / 1024)} KB`;

async function loadRows(table) {
  const rows = await supa.getAll(table);
  if (!Array.isArray(rows)) throw new Error(`could not read ${table} from the durable store`);
  return rows;
}

async function restore(file) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
  console.log(`Restoring ${saved.rows.length} row(s) from ${path.basename(file)}`);
  for (const { table, row } of saved.rows) {
    const result = await persistCore(table, row);
    if (result?.ok === false) throw new Error(`restore of ${table}/${row.id} failed: ${result.error}`);
    console.log(`  ${table}/${row.id} ← inline image restored`);
  }
  console.log('Done. The rows carry their pictures inline again.');
}

async function migrate() {
  const backup = { created_at: new Date().toISOString(), rows: [] };
  const plan = [];

  for (const { table, prefix } of TABLES) {
    for (const row of await loadRows(table)) {
      const decoded = decodeInlineImage(row?.image);
      if (!decoded) continue;
      plan.push({ table, prefix, row, bytes: decoded.buffer.length });
      backup.rows.push({ table, row });
    }
  }

  if (plan.length === 0) {
    console.log('Nothing to do — no catalog row still holds its picture inline.');
    return;
  }

  const total = plan.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(`${plan.length} image(s) inline, ${kb(total)} of row data:`);
  for (const entry of plan) {
    console.log(`  ${entry.table.padEnd(19)} ${kb(entry.bytes).padStart(8)}  ${entry.row.name || entry.row.id}`);
  }
  if (dryRun) {
    console.log('\n--dry-run: nothing was written.');
    return;
  }

  const backupFile = path.join(process.cwd(), `catalog-images-backup-${Date.now()}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf-8');
  console.log(`\nBackup of the original rows: ${path.basename(backupFile)}`);

  let moved = 0;
  for (const entry of plan) {
    const url = await storeImageValue(entry.row.image, entry.prefix);
    if (!url || url === entry.row.image) {
      console.error(`  ✗ ${entry.row.name || entry.row.id} — upload failed, row left as it was`);
      continue;
    }
    const result = await persistCore(entry.table, { ...entry.row, image: url });
    if (result?.ok === false) {
      console.error(`  ✗ ${entry.row.name || entry.row.id} — save failed: ${result.error}`);
      continue;
    }
    moved += 1;
    console.log(`  ✓ ${entry.row.name || entry.row.id} → ${url.split('/').pop()}`);
  }

  console.log(`\n${moved}/${plan.length} moved. Rows are ${kb(total)} lighter.`);
  if (moved < plan.length) {
    console.log('Some rows kept their inline picture — run again to retry just those.');
  }
  console.log('Restart the API so it re-reads the catalog.');
}

try {
  if (restoreFile) await restore(restoreFile);
  else await migrate();
  process.exit(0);
} catch (error) {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
}
