/**
 * בדיקה שההנחה לפי תפקיד באמת נתפסת — על הנתונים החיים, בלי לשנות דבר.
 *
 * הרצה:
 *   node scripts/checkStaffDiscount.js
 *
 * הכלל תלוי בשרשרת שלמה: לעובד יש התפקיד, לעובד יש `customer_student_id`,
 * תיק המתאמן קיים, והמוצר שההטבה מכוונת אליו עדיין במחירון. די בחוליה אחת
 * שנופלת כדי שההנחה תהיה פעילה במסך ההגדרות ולא תיראה לעולם בקופה — וזה בדיוק
 * מה שקרה כאן עד שהקישור מולא.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { matchingDiscountRules, employeeForStudent, offerForDiscountRule } = await import('../discountRules.js');

await initDb();

const rules = db.get('discount_rules') || [];
const employees = db.get('employees') || [];
const pricelist = db.get('pricelist') || [];

console.log(`כללי הנחה: ${rules.length}\n`);

for (const rule of rules.filter((r) => r.audience === 'employee_role')) {
  console.log(`■ ${rule.name}  (תפקיד: ${rule.role})`);

  const holders = employees.filter((employee) => (
    employee.is_active !== false
    && (employee.certifications || []).map(String).includes(String(rule.role))
  ));
  const linked = holders.filter((employee) => employee.customer_student_id);
  console.log(`   עובדים פעילים בתפקיד: ${holders.length} · מתוכם מקושרים לתיק מתאמן: ${linked.length}`);

  for (const benefit of rule.benefits || []) {
    const targets = (benefit.pricelistIds || []).map((id) => pricelist.find((item) => item.id === id));
    for (const [index, item] of targets.entries()) {
      const id = benefit.pricelistIds[index];
      if (!item) { console.log(`   ✗ ההטבה מכוונת למוצר ${id} שאינו קיים במחירון`); continue; }
      if (item.active === false) { console.log(`   ✗ המוצר "${item.name}" אינו פעיל`); continue; }
      const off = benefit.type === 'amount' ? `₪${benefit.value}` : `${benefit.value}%`;
      console.log(`   הטבה: ${off} על "${item.name}" (₪${item.price})`);
    }
  }

  if (!linked.length) {
    console.log('   ✗ אף עובד בתפקיד אינו מקושר — הכלל לא ייתפס בקופה אף פעם\n');
    continue;
  }

  let matched = 0;
  const failures = [];
  for (const employee of linked) {
    const studentId = employee.customer_student_id;
    const student = db.getOne('students', studentId);
    if (!student) { failures.push(`${employee.name}: תיק המתאמן ${studentId} לא נמצא`); continue; }
    if (employeeForStudent(db, studentId)?.id !== employee.id) {
      failures.push(`${employee.name}: הקישור ההפוך לא מחזיר את העובד`);
      continue;
    }
    const hit = matchingDiscountRules(db, studentId).some((r) => r.name === rule.name);
    if (hit) matched += 1;
    else failures.push(`${employee.name}: הכלל לא נתפס עבור ${student.name}`);
  }
  console.log(`   נתפס עבור ${matched}/${linked.length} מהמקושרים`);
  for (const failure of failures) console.log(`   ✗ ${failure}`);

  const offer = offerForDiscountRule(rule);
  console.log(`   ההצעה שנוצרת: ${offer.label} · ${offer.parts.length} חלקים\n`);
}

process.exit(0);
