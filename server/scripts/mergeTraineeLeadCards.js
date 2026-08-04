// One-time heal: blank "לקוח וואטסאפ" cards that a trainee's own phone opened, before
// that trainee was imported into the CRM. Each such card — and its conversation — is
// folded into the family the phone really belongs to.
//
// Cards with a real name, an email, or children of their own are never touched.
//
// Run from the server folder:
//   node scripts/mergeTraineeLeadCards.js          (dry run — lists what would merge)
//   node scripts/mergeTraineeLeadCards.js --apply  (writes, after a JSON backup)

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { db, initDb, isBlankLeadCard, parentPhonesMatch } from '../db.js';

const apply = process.argv.includes('--apply');

await initDb();

const parents = db.get('parents') || [];
const students = db.get('students') || [];

const planned = [];
for (const student of students) {
  if (!student.phone || !student.parentId) continue;
  const family = parents.find((p) => p.id === student.parentId);
  if (!family) continue;
  const strays = parents.filter(
    (p) => p.id !== family.id
      && parentPhonesMatch(p.phone, student.phone)
      && isBlankLeadCard(p, { students })
  );
  for (const stray of strays) {
    planned.push({ strayId: stray.id, phone: stray.phone, student: student.name, family: family.name });
  }
}

if (!planned.length) {
  console.log('No blank lead cards collide with a trainee phone — nothing to merge.');
  process.exit(0);
}

console.log(`${planned.length} blank lead card(s) belong to an existing family:`);
for (const row of planned) {
  console.log(`  ${row.phone}  ${row.student}  →  ${row.family}  (drops ${row.strayId})`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to merge.');
  process.exit(0);
}

const backupPath = path.join(process.cwd(), `parents-backup-${Date.now()}.json`);
fs.writeFileSync(backupPath, JSON.stringify(parents, null, 2), 'utf8');
console.log(`\nBackup of all parent cards: ${backupPath}`);

const result = db.mergeBlankLeadCardsIntoTraineeFamilies();
console.log(`Merged ${result.count} card(s).`);
for (const row of result.merged) {
  console.log(`  ${row.student} → ${row.family} (${row.absorbed.join(', ')})`);
}

// Durable deletes are fired off asynchronously inside the merge; give them a moment.
await new Promise((resolve) => setTimeout(resolve, 4000));
console.log('Done.');
