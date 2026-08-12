/**
 * מחיל את database/20260812_activity_ideas.sql על Supabase דרך ה-Management API,
 * ומוודא בקריאה חוזרת שהעמודה קיימת.
 *
 * הרצה (מתוך server/): node scripts/applyActivityIdeasMigration.js
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

const sql = fs.readFileSync(path.resolve(HERE, '../../database/20260812_activity_ideas.sql'), 'utf8');

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
  "select column_name from information_schema.columns where table_name='activities' and column_name='collect_interest'"
);
if (!Array.isArray(check) || !check.length) throw new Error('העמודה לא נוצרה');
console.log('✅ collect_interest קיימת בטבלת activities');
