/**
 * שלב א' של העברת תיקי העובדים מ-Notion: הורדת הקבצים עצמם.
 *
 * הקבצים ב-Notion נגישים רק דרך כתובת חתומה שתוקפה שעה, ולכן צריך לשלוף אותם
 * דרך ה-API עם NOTION_API_TOKEN (יושב ב-make-integration/.env, כמו ב-migrate-notion.js).
 * הסקריפט מוריד הכל לתיקייה זמנית וכותב manifest.json — ההעלאה למערכת היא
 * שלב נפרד (uploadNotionEmployeeDocs.js), כדי שאפשר יהיה לבדוק מה ירד לפני שכותבים.
 *
 *   node scripts/fetchNotionEmployeeDocs.js <תיקיית-יעד>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  console.error('שימוש: node scripts/fetchNotionEmployeeDocs.js <תיקיית-יעד>');
  process.exit(1);
}

function notionToken() {
  if (process.env.NOTION_API_TOKEN) return process.env.NOTION_API_TOKEN;
  const envPath = path.resolve(HERE, '../../../make-integration/.env');
  const match = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').match(/NOTION_API_TOKEN\s*=\s*(.+)/)
    : null;
  if (!match) throw new Error('NOTION_API_TOKEN לא נמצא');
  return match[1].trim();
}

const TOKEN = notionToken();
const EMPLOYEES_DB = '4d576ada-9f25-4263-846a-d4b4a75762b6';

/** שדה הקבצים ב-Notion → סוג המסמך בכרטיס העובד במערכת. */
const DOC_TYPE_OF_PROP = {
  '📄 טופס 101': 'form101',
  'צילום תעודת זהות': 'idPhoto',
  '📄 תעודות רלוונטיות': 'certificates',
  'אישור משטרה ': 'police',
  'חוזה העסקה ': 'contract',
};

async function queryAll() {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${EMPLOYEES_DB}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
    });
    if (!res.ok) throw new Error(`Notion query נכשל: ${res.status} ${await res.text()}`);
    const body = await res.json();
    results.push(...body.results);
    cursor = body.has_more ? body.next_cursor : undefined;
  } while (cursor);
  return results;
}

const titleOf = (page, prop) =>
  (page.properties[prop]?.title || []).map((t) => t.plain_text).join('').trim();

/** שם קובץ בטוח לדיסק — שמות הקבצים ב-Notion מכילים עברית, רווחים וסוגריים. */
const safeName = (name) => String(name).replace(/[^\w֐-׿.\-]+/g, '_').slice(0, 100);

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pages = await queryAll();
  const manifest = [];
  let downloaded = 0;
  let failed = 0;

  for (const page of pages) {
    const name = titleOf(page, 'שם מלא');
    const status = page.properties['🙋🏽‍♂️ סטטוס']?.select?.name || '';
    if (status === 'ארכיון' || status === 'מועמד' || name === 'טלפון מערכת') continue;

    for (const [prop, docType] of Object.entries(DOC_TYPE_OF_PROP)) {
      const files = page.properties[prop]?.files || [];
      if (!files.length) continue;

      const saved = [];
      for (const [idx, file] of files.entries()) {
        const url = file.file?.url || file.external?.url;
        if (!url) continue;
        const label = safeName(file.name || `${docType}_${idx}`);
        const target = path.join(OUT_DIR, `${page.id}__${docType}__${idx}__${label}`);
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(target, buf);
          saved.push({
            file: path.basename(target),
            originalName: file.name || label,
            bytes: buf.length,
            contentType: res.headers.get('content-type') || '',
          });
          downloaded += 1;
        } catch (err) {
          console.error(`❌ ${name} / ${docType} / ${file.name}: ${err.message}`);
          failed += 1;
        }
      }
      if (saved.length) {
        manifest.push({ notionPageId: page.id, name, status, docType, files: saved });
      }
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✅ ירדו ${downloaded} קבצים (${failed} נכשלו) עבור ${new Set(manifest.map((m) => m.name)).size} עובדים`);
  for (const row of manifest) {
    console.log(`   • ${row.name} / ${row.docType}: ${row.files.length} קבצים`);
  }
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
