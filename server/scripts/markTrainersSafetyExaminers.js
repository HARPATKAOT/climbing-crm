/**
 * סימון מדריכי החוגים כמורשים להעביר תדריך ומבחן אבטחה.
 *
 * הרצה:
 *   node scripts/markTrainersSafetyExaminers.js           → הדמיה, מדפיס ולא נוגע
 *   node scripts/markTrainersSafetyExaminers.js --apply   → כתיבה ל-Supabase + db.json
 *
 * ההסמכה `can_test_safety` נוספה כשדה ריק לכל העובדים, ולכן ברגע שהיא נאכפה
 * איש לא יכול היה לחתום על מבחן אבטחה. מי שמדריך חוגים כבר מעביר בפועל את
 * התדריך והמבחן, ולכן הוא נקודת ההתחלה הנכונה.
 *
 * הסימון אינו קובע לבדו: `employeeCanTestSafety` דורש גם עובד פעיל וגם עובד
 * קיר, כך שסימון של מי שיצא מהמערכת אינו פותח לו דבר — הוא רק שומר את הכוונה
 * למקרה שיחזור.
 *
 * העובדים הם אוסף kv, ולכן אין צורך במיגרציית SQL — שדה חדש נשמר מעצמו.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');

const APPLY = process.argv.includes('--apply');
const TRAINER_LABEL = 'מדריך חוג';

await initDb();

const employees = db.get('employees') || [];
const targets = employees.filter((employee) => (
  Array.isArray(employee.certifications)
  && employee.certifications.includes(TRAINER_LABEL)
  && employee.can_test_safety !== true
));

console.log(`עובדים במערכת: ${employees.length}`);
console.log(`מסומנים כ"${TRAINER_LABEL}" וטרם הוסמכו: ${targets.length}\n`);
for (const employee of targets) {
  const active = employee.is_active !== false && employee.active !== false;
  console.log(`  ${employee.name}${active ? '' : '  (לא פעיל — הסימון נשמר אך אינו מפעיל דבר)'}`);
}

if (!APPLY) {
  console.log('\nהדמיה בלבד. להרצה אמיתית: --apply');
  process.exit(0);
}

let saved = 0;
let failed = 0;
for (const employee of targets) {
  const updated = { ...employee, can_test_safety: true, updated_at: new Date().toISOString() };
  const result = await supa.upsert('employees', updated);
  if (result?.ok === false) {
    failed += 1;
    console.error(`  ✗ ${employee.name}: ${result.error}`);
    continue;
  }
  db.update('employees', employee.id, { can_test_safety: true });
  saved += 1;
}

console.log(`\nנשמרו: ${saved}${failed ? ` · נכשלו: ${failed}` : ''}`);
process.exit(failed ? 1 : 0);
