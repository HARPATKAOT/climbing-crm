/**
 * מחיל את database/20260813_activity_price_book.sql על Supabase דרך
 * ה-Management API, ומוודא בקריאה חוזרת ששלוש העמודות קיימות.
 *
 * ⚠️ חייב לרוץ לפני שהשרת החדש עולה: מרגע ש-mappers.activities מונה עמודה
 * שאין ב-Postgres, PostgREST דוחה כל שורת אירוע וכל שמירה נכשלת. בפועל
 * הדיפלוי הקדים אותו (12.8.2026) והשמירות נשברו לכשתי דקות.
 *
 * הרצה (מתוך server/): node scripts/applyActivityPriceBookMigration.js
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

// ברירת המחדל היא הקובץ שבמאגר. MIGRATION_SQL_PATH קיים כי עותק העבודה כאן
// משותף לכמה סשנים ולא תמיד מעודכן — אפשר להצביע על הקובץ שנשלף מ-git.
const sqlPath = process.env.MIGRATION_SQL_PATH
  || path.resolve(HERE, '../../database/20260813_activity_price_book.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

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

const expected = [
  ['activities', 'price_rule_id'],
  ['activities', 'price_rule_version'],
  ['activity_templates', 'price_rule_id'],
];
for (const [table, column] of expected) {
  const check = await query(
    `select column_name from information_schema.columns `
    + `where table_name='${table}' and column_name='${column}'`
  );
  if (!Array.isArray(check) || !check.length) {
    throw new Error(`העמודה ${table}.${column} לא נוצרה`);
  }
  console.log(`✅ ${table}.${column}`);
}
console.log('המיגרציה הוחלה.');
