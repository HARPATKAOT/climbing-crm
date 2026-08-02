/**
 * מתקן שני מקרי כפילות שנוצרו בייבוא Notion: מתאמן שנוצר עם שם פרטי בלבד
 * ("סמדר", "נויה") למרות שכבר היה מתאמן עם השם המלא באותה משפחה — ההתאמה
 * בייבוא דרשה שם זהה לגמרי ולא תפסה את זה.
 *
 * לכל זוג: מעביר את המבחנים וההרשמות של הרשומה החלקית לרשומה השלמה,
 * מעדכן levelGrade אם צריך, ומוחק את הרשומה החלקית.
 *
 * הרצה (מתוך server/): node scripts/fixNotionFirstNameDuplicates.js --apply
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');

const APPLY = process.argv.includes('--apply');

const PAIRS = [
  { drop: 'sn_6a691e298f1d4ce7a402a1095c0ff7c0', keep: 'st1785580132354', keepName: 'סמדר איל' },
  { drop: 'sn_65a7fe8bd50542179b5bc6c84db74edb', keep: 'sn_bbd37f8a3c564dd7ac0246d8ef330f46', keepName: 'נויה צוברי' },
];

async function run() {
  await initDb();
  if (APPLY && !supa.isEnabled()) throw new Error('Supabase לא מחובר');

  const students = db.get('students') || [];
  const tests = db.get('level_tests') || [];
  const regs = db.get('activity_registrations') || [];

  for (const { drop, keep, keepName } of PAIRS) {
    const dropStudent = students.find((s) => s.id === drop);
    const keepStudent = students.find((s) => s.id === keep);
    if (!dropStudent || !keepStudent) {
      console.log(`⏭️  דילוג ${drop} → ${keep}: אחד הצדדים לא נמצא (כבר טופל?)`);
      continue;
    }

    const myTests = tests.filter((t) => t.studentId === drop);
    const myRegs = regs.filter((r) => r.student_id === drop);
    console.log(`\n${dropStudent.name} (${drop}) → ${keepName} (${keep}): ${myTests.length} מבחנים, ${myRegs.length} הרשמות`);

    if (APPLY) {
      for (const t of myTests) {
        const updated = { ...t, studentId: keep, climber_id: keep, studentName: keepName };
        db.update('level_tests', t.id, updated);
        await supa.upsert('level_tests', { ...t, ...updated });
      }
      for (const r of myRegs) {
        const updated = { ...r, student_id: keep, participant_name: keepName };
        db.update('activity_registrations', r.id, updated);
        await supa.upsert('activity_registrations', { ...r, ...updated });
      }

      const passedLevels = myTests.filter((t) => t.test_type === 'level' && t.passed && t.level);
      const bestLevel = passedLevels.sort((a, b) => String(a.date).localeCompare(String(b.date))).pop();
      const fills = {};
      if (bestLevel && !keepStudent.levelGrade) fills.levelGrade = bestLevel.level;
      if (dropStudent.notes && !String(keepStudent.notes || '').includes(dropStudent.notes)) {
        fills.notes = (keepStudent.notes ? `${keepStudent.notes}\n` : '') +
          `מוזג עם רשומה כפולה "${dropStudent.name}" · ${dropStudent.notes}`;
      }
      if (Object.keys(fills).length) {
        const savedKeep = db.update('students', keep, fills);
        await supa.upsert('students', savedKeep);
      }

      await db.deleteDurable('students', drop);
      console.log(`   ✅ מוזג ומחק ${drop}`);
    } else {
      console.log('   (הדמיה — הרץ עם --apply כדי לבצע)');
    }
  }
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('❌ נכשל:', err?.stack || err?.message || err);
  process.exit(1);
});
