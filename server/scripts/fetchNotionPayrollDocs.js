/**
 * שלב א' של העברת „תשלומי עובדים” מ-Notion: הורדת הקבצים עצמם.
 *
 * הקבצים ב-Notion נגישים רק דרך כתובת חתומה שתוקפה שעה, ולכן אי אפשר לשמור
 * קישור ולהוריד אחר כך — הורדה ושמירה חייבות לקרות באותה ריצה. הסקריפט מוריד
 * הכל לתיקייה זמנית וכותב manifest.json; ההעלאה למערכת היא שלב נפרד
 * (importNotionPayroll.js), כדי שאפשר יהיה לבדוק מה ירד לפני שכותבים.
 *
 *   node scripts/fetchNotionPayrollDocs.js <תיקיית-יעד>
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const OUT_DIR = process.argv[2];
if (!OUT_DIR) {
  console.error('שימוש: node scripts/fetchNotionPayrollDocs.js <תיקיית-יעד>');
  process.exit(1);
}

function notionToken() {
  if (process.env.NOTION_API_TOKEN) return process.env.NOTION_API_TOKEN.trim();
  for (const candidate of ['../../../make-integration/.env', '../../make-integration/.env']) {
    const envPath = path.resolve(HERE, candidate);
    if (!fs.existsSync(envPath)) continue;
    const match = fs.readFileSync(envPath, 'utf8').match(/^NOTION_API_TOKEN\s*=\s*(.+)$/m);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  throw new Error('NOTION_API_TOKEN לא נמצא');
}

const TOKEN = notionToken();
const PAYMENTS_DB = process.env.NOTION_EMPLOYEE_PAYMENTS_DB || '16b7b0a7-146e-4cff-918f-7e367c98ddc8';

/** שדה הקבצים ב-Notion → התפקיד שהקובץ ממלא בשורה. */
const FILE_PROPS = {
  'תלוש / דוח פיצול ': 'statement',
  'העברה בנקאית ': 'transfer',
};

async function queryAll() {
  const results = [];
  let cursor;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${PAYMENTS_DB}/query`, {
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

/** שם קובץ בטוח לדיסק — שמות הקבצים ב-Notion מכילים עברית, רווחים וסוגריים. */
const safeName = (name) => String(name).replace(/[^\w֐-׿.\-]+/g, '_').slice(0, 100);

/** שם השדה ב-Notion עלול להשתנות ברווח נגרר; מחפשים גם בלי הרווחים. */
function propOf(page, name) {
  if (page.properties[name]) return page.properties[name];
  const trimmed = name.trim();
  const key = Object.keys(page.properties).find((k) => k.trim() === trimmed);
  return key ? page.properties[key] : null;
}

const selectOf = (page, name) => propOf(page, name)?.select?.name?.trim() || '';
const numberOf = (page, name) => {
  const value = propOf(page, name)?.number;
  return Number.isFinite(value) ? value : null;
};

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const pages = await queryAll();
  const manifest = [];
  let downloaded = 0;
  let failed = 0;

  for (const page of pages) {
    const year = selectOf(page, 'שנה');
    const month = selectOf(page, 'חודש ');
    const type = selectOf(page, 'סוג');
    // שורה בלי שנה או חודש אי אפשר לשייך לתקופה, ולכן היא לא ניתנת לייבוא.
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
      manifest.push({ notionPageId: page.id, skipped: 'חסרים שנה או חודש', year, month, type });
      continue;
    }

    const relation = Object.values(page.properties).find((prop) => prop?.type === 'relation' && prop.relation?.length);
    const employeeNotionId = page.properties['💪🏽 עובד']?.relation?.[0]?.id
      || (relation?.relation?.[0]?.id ?? null);

    const files = [];
    for (const [prop, slot] of Object.entries(FILE_PROPS)) {
      const entries = propOf(page, prop)?.files || [];
      for (const [idx, file] of entries.entries()) {
        const url = file.file?.url || file.external?.url;
        if (!url) continue;
        const label = safeName(file.name || `${slot}_${idx}`);
        const target = path.join(OUT_DIR, `${page.id}__${slot}__${idx}__${label}`);
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buffer = Buffer.from(await res.arrayBuffer());
          fs.writeFileSync(target, buffer);
          files.push({
            slot,
            file: path.basename(target),
            originalName: file.name || label,
            bytes: buffer.length,
            contentType: res.headers.get('content-type') || '',
          });
          downloaded += 1;
        } catch (err) {
          console.error(`❌ ${year}-${month} / ${type} / ${file.name}: ${err.message}`);
          failed += 1;
        }
      }
    }

    manifest.push({
      notionPageId: page.id,
      employeeNotionId,
      period: `${year}-${month}`,
      year,
      month,
      type,
      total: numberOf(page, '🪙 סה"כ תשלומים '),
      statusNote: selectOf(page, 'הערות '),
      notes: (propOf(page, 'הערות')?.rich_text || []).map((t) => t.plain_text).join('').trim(),
      files,
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const withFiles = manifest.filter((row) => row.files?.length).length;
  const skipped = manifest.filter((row) => row.skipped).length;
  console.log(`✅ ${manifest.length} שורות, ${withFiles} עם קבצים · ירדו ${downloaded} קבצים (${failed} נכשלו)`);
  if (skipped) console.log(`⚠️  ${skipped} שורות בלי שנה/חודש — לא ניתנות לייבוא`);
  const byType = manifest.reduce((acc, row) => ({ ...acc, [row.type || '—']: (acc[row.type || '—'] || 0) + 1 }), {});
  for (const [type, count] of Object.entries(byType)) console.log(`   • ${type}: ${count}`);
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
