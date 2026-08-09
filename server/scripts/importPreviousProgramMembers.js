/**
 * One-time previous-season advanced/squad importer.
 *
 * Preferred input contains only the student and eligibility program:
 *   [{ "student_name": "...", "program": "young_squad" }]
 * Legacy group-name rows are accepted too, but group details are never stored:
 *   [{ "name": "...", "group_name": "נבחרת צעירה" }]
 *
 * Dry-run is the default and writes nothing:
 *   node scripts/importPreviousProgramMembers.js path/to/export.json
 * Apply only exact unique-name matches:
 *   node scripts/importPreviousProgramMembers.js path/to/export.json --apply
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const inputArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (!inputArg) throw new Error('Missing Notion JSON export path');
const inputPath = path.resolve(process.cwd(), inputArg);
const rows = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const { db, initDb, persistCore } = await import('../db.js');
const { buildPreviousProgramImportReport, applyPreviousProgramImport } = await import('../previousProgramImport.js');
await initDb();

const report = buildPreviousProgramImportReport(db, rows);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--apply')) {
  const saved = await applyPreviousProgramImport(db, persistCore, report);
  console.log(`Imported ${saved.length} exact previous-season membership row(s).`);
} else {
  console.log('Dry-run only. Add --apply after reviewing every unresolved row.');
}
