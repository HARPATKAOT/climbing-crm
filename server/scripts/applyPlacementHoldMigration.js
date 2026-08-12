/**
 * מחיל את database/20260811_placement_hold.sql על Supabase דרך ה-Management API,
 * ומוודא בקריאה חוזרת שהעמודות קיימות.
 *
 * הרצה (מתוך server/): node scripts/applyPlacementHoldMigration.js
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

const sql = fs.readFileSync(path.resolve(HERE, '../../database/20260811_placement_hold.sql'), 'utf8');

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
  "select column_name from information_schema.columns where table_name='students' "
  + "and column_name in ('placement_hold_until','placement_hold_firm','placement_reported_at')"
);
const found = Array.isArray(check) ? check.map((r) => r.column_name).sort() : [];
if (found.length !== 3) throw new Error(`חסרות עמודות: ${JSON.stringify(found)}`);
console.log('✅ placement_hold_until / placement_hold_firm / placement_reported_at קיימות בטבלת students');
