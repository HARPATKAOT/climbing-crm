/**
 * חיבור תיק העובד לתיק המתאמן שלו, לפי התאמת שם חד-משמעית.
 *
 * הרצה:
 *   node scripts/linkEmployeesToStudents.js           → הדמיה
 *   node scripts/linkEmployeesToStudents.js --apply   → כתיבה
 *
 * `customer_student_id` הוא מה שמאפשר לקופה לזהות שהלקוח שעומד מולה הוא גם
 * עובד, ולהחיל את כללי ההנחה למדריכים ולעוזרי מדריך. השדה היה ריק אצל כל
 * העובדים, ולכן הכללים היו פעילים ולא נתפסו אף פעם.
 *
 * מחבר **רק** כשיש בדיוק תיק מתאמן אחד עם אותו שם. שם שמופיע פעמיים, או שלא
 * מופיע כלל, נשאר לטיפול ידני — קישור שגוי נותן הנחה לאדם אחר, וזו לא טעות
 * שמישהו יבחין בה.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');

const APPLY = process.argv.includes('--apply');
const norm = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');

await initDb();

const students = db.get('students') || [];
const byName = new Map();
for (const student of students) {
  const key = norm(student.name);
  if (!key) continue;
  byName.set(key, [...(byName.get(key) || []), student]);
}

const employees = (db.get('employees') || []).filter((employee) => (
  employee.is_active !== false && employee.active !== false && !employee.customer_student_id
));

const linkable = [];
const ambiguous = [];
const unmatched = [];
for (const employee of employees) {
  const matches = byName.get(norm(employee.name)) || [];
  if (matches.length === 1) linkable.push({ employee, student: matches[0] });
  else if (matches.length > 1) ambiguous.push({ employee, matches });
  else unmatched.push(employee);
}

console.log(`עובדים פעילים ללא קישור: ${employees.length}`);
console.log(`  התאמה חד-משמעית: ${linkable.length}`);
console.log(`  דו-משמעי (לא נוגעים): ${ambiguous.length}`);
console.log(`  בלי תיק מתאמן: ${unmatched.length}\n`);
for (const { employee, student } of linkable) console.log(`  ${employee.name} → ${student.id}`);
for (const { employee, matches } of ambiguous) {
  console.log(`  ⚠ ${employee.name}: ${matches.length} תיקים באותו שם — ידני`);
}

if (!APPLY) {
  console.log('\nהדמיה בלבד. להרצה אמיתית: --apply');
  process.exit(0);
}

let saved = 0;
for (const { employee, student } of linkable) {
  const updated = { ...employee, customer_student_id: student.id, updated_at: new Date().toISOString() };
  const result = await supa.upsert('employees', updated);
  if (result?.ok === false) {
    console.error(`  ✗ ${employee.name}: ${result.error}`);
    continue;
  }
  db.update('employees', employee.id, { customer_student_id: student.id });
  saved += 1;
}
console.log(`\nחוברו: ${saved}`);
process.exit(saved === linkable.length ? 0 : 1);
