/**
 * שלב ב' של העברת תיקי העובדים מ-Notion: העלאת הקבצים שירדו אל כרטיסי העובדים.
 *
 * מריצים אחרי fetchNotionEmployeeDocs.js ואחרי merge_docs.py (שמאחד משבצת עם
 * כמה קבצים ל-PDF אחד, כי בכרטיס העובד יש מקום לקובץ אחד לכל סוג מסמך).
 *
 *   node scripts/uploadNotionEmployeeDocs.js <תיקיית-הקבצים>          → הדמיה
 *   node scripts/uploadNotionEmployeeDocs.js <תיקיית-הקבצים> --apply  → העלאה
 *
 * משבצת שכבר תפוסה בכרטיס לא נדרסת: הסקריפט מדלג עליה ומדווח, כדי שקובץ
 * שהועלה במערכת החדשה לא ייעלם מתחת לידיים.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');

const FOLDER = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!FOLDER) {
  console.error('שימוש: node scripts/uploadNotionEmployeeDocs.js <תיקיית-הקבצים> [--apply]');
  process.exit(1);
}

const DOC_FLAG = {
  contract: 'contractSigned',
  police: 'policeClearance',
  certificates: 'hasCertificates',
  idPhoto: 'hasIdPhoto',
  form101: 'hasForm101',
};

const EXT_OF_MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

const stripDashes = (value) => String(value || '').replace(/-/g, '').toLowerCase();
const normName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** התאמה לכרטיס במערכת: קודם לפי מזהה עמוד ה-Notion שנשמר בייבוא, אחרת לפי שם. */
function matchEmployee(employees, row) {
  const pageId = stripDashes(row.notionPageId);
  const byNotion = employees.find((e) => e.notionUrl && stripDashes(e.notionUrl).endsWith(pageId));
  if (byNotion) return byNotion;
  return employees.find((e) => normName(e.name) === normName(row.name)) || null;
}

async function run() {
  await initDb();

  const ready = JSON.parse(fs.readFileSync(path.join(FOLDER, 'ready.json'), 'utf8'));
  const employees = db.get('employees') || [];

  console.log(APPLY ? '✍️  מצב העלאה\n' : '🔍 הדמיה בלבד — הרץ עם --apply כדי להעלות\n');

  const uploaded = [];
  const occupied = [];
  const unmatched = [];
  const missing = [];

  for (const row of ready) {
    if (!row.ready) {
      missing.push(`${row.name} / ${row.docType} — ${row.dropped.join(', ')}`);
      continue;
    }
    const emp = matchEmployee(employees, row);
    if (!emp) {
      unmatched.push(`${row.name} / ${row.docType}`);
      continue;
    }
    if (emp.documents?.[row.docType]?.storagePath) {
      occupied.push(`${emp.name} / ${row.docType} — כבר יש קובץ בכרטיס`);
      continue;
    }

    const source = path.join(FOLDER, row.ready);
    const buffer = fs.readFileSync(source);
    const mime = row.contentType || 'application/pdf';
    const ext = EXT_OF_MIME[mime] || 'bin';
    const storagePath = `${emp.id}/${row.docType}_${Date.now()}.${ext}`;
    const fileName = String(row.fileName || `${row.docType}.${ext}`)
      .replace(/[^\w֐-׿.\-]+/g, '_')
      .slice(0, 120);

    if (APPLY) {
      const up = await supa.uploadEmployeeDocument(storagePath, buffer, mime);
      if (!up.ok) {
        console.error(`❌ ${emp.name} / ${row.docType}: ${up.error}`);
        continue;
      }
      const documents = {
        ...(emp.documents || {}),
        [row.docType]: { fileName, storagePath, mimeType: mime, uploadedAt: new Date().toISOString() },
      };
      const updated = db.update('employees', emp.id, {
        documents,
        [DOC_FLAG[row.docType]]: true,
      });
      // db.update מסנכרן ברקע בלי להמתין — סקריפט שמסתיים מיד היה משאיר את
      // הכרטיס במערכת החיה בלי המסמך.
      await supa.upsert('employees', updated);
      emp.documents = documents;
    }

    uploaded.push(
      `${emp.name} / ${row.docType} — ${(buffer.length / 1024).toFixed(0)}KB` +
        (row.merged > 1 ? ` (איחוד של ${row.merged} קבצים)` : '')
    );
  }

  console.log(`✅ הועלו ${uploaded.length} מסמכים:`);
  uploaded.forEach((l) => console.log(`   • ${l}`));
  if (occupied.length) {
    console.log(`\n⏭️  ${occupied.length} משבצות תפוסות — לא נדרסו:`);
    occupied.forEach((l) => console.log(`   • ${l}`));
  }
  if (missing.length) {
    console.log(`\n⚠️  ${missing.length} קבצים לא ניתנים להורדה מ-Notion (קישור חיצוני שפג):`);
    missing.forEach((l) => console.log(`   • ${l}`));
  }
  if (unmatched.length) {
    console.log(`\n❓ ${unmatched.length} לא נמצא להם עובד במערכת:`);
    unmatched.forEach((l) => console.log(`   • ${l}`));
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('❌', err?.message || err);
  process.exit(1);
});
