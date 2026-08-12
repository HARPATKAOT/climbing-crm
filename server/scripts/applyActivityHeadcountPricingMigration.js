/**
 * מחיל את database/20260812_activity_headcount_pricing.sql על Supabase דרך
 * ה-Management API, ומוודא בקריאה חוזרת שכל העמודות קיימות.
 *
 * הקובץ הזה נכתב בדיעבד: המיגרציה נמסרה למשתמש להרצה ידנית ולא רצה, והשרת
 * החדש כתב `charge_basis` לעמודה שלא קיימת — כל שמירת אירוע החזירה
 * "Could not find the 'charge_basis' column of 'activities' in the schema cache"
 * עד שהיא הוחלה (12.8.2026). מיגרציה שלא הורצה מכאן היא מיגרציה שלא הורצה.
 *
 * הרצה (מתוך server/): node scripts/applyActivityHeadcountPricingMigration.js
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

const sqlPath = process.env.MIGRATION_SQL_PATH
  || path.resolve(HERE, '../../database/20260812_activity_headcount_pricing.sql');
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
  ['activities', 'charge_basis'],
  ['activities', 'min_participants'],
  ['activities', 'extra_participant_price'],
  ['activities', 'max_charge'],
  ['activities', 'price_template_id'],
  ['activities', 'host_charge_participants'],
  ['activities', 'host_charge_amount'],
  ['activity_templates', 'charge_basis'],
  ['activity_templates', 'min_participants'],
  ['activity_templates', 'extra_participant_price'],
  ['activity_templates', 'max_charge'],
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
