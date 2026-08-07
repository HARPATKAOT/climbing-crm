/**
 * מחיל את database/20260807_form_template_cover.sql על Supabase דרך
 * ה-Management API, ומוודא בקריאה חוזרת ששתי העמודות קיימות.
 *
 * הרצה (מתוך server/): node scripts/applyFormTemplateCoverMigration.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const PROJECT = 'xaxykjvqqhrodmseqleu';
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN חסר ב-server/.env');

const sql = fs.readFileSync(path.resolve(HERE, '../../database/20260807_form_template_cover.sql'), 'utf8');

async function query(q) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const body = await res.json();
  if (!res.ok && res.status !== 201) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
  return body;
}

await query(sql);
const check = await query(
  "select column_name from information_schema.columns where table_name='form_templates' and column_name in ('headline','cover_image')"
);
if (!Array.isArray(check) || check.length !== 2) throw new Error(`העמודות לא נוצרו: ${JSON.stringify(check)}`);
console.log('✅ headline ו-cover_image קיימות בטבלת form_templates');
