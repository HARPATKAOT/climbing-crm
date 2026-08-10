/**
 * מאחד תיקי מתאמן כפולים לתיק אחד.
 *
 * הזוגות למטה אותרו בסריקה שדורשת גם שם כמעט-זהה, גם אותו הורה/טלפון וגם
 * אותו תאריך לידה — כפילות איות מייבוא Notion, לא שני אחים.
 *
 * לכל זוג: כל רשומה שמצביעה על התיק שנמחק (הרשמות, מבחני דרגה, ציוד, יומן
 * סטטוסים, זכאות תוכנית) עוברת לתיק שנשאר, שדות ריקים בתיק שנשאר מתמלאים
 * מהתיק שנמחק, ואז התיק הכפול נמחק.
 *
 * הרצה (מתוך server/):
 *   node scripts/mergeDuplicateStudents.js            # הדמיה בלבד
 *   node scripts/mergeDuplicateStudents.js --apply    # מבצע
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa, CORE_TABLES } = await import('../supa.js');

const APPLY = process.argv.includes('--apply');

const PAIRS = [
  {
    keep: 'sn_42d03c110b9d4250b0fbdb47e55ac0b9', // יונתן ברזילי — סטטוס past_registered, יש טלפון
    drop: 'sn_0134cf870c4a41bfa9334c4e5203ccc1', // יונתן ברזילאי — "נמחק בנושן"
    keepName: 'יונתן ברזילי',
  },
  {
    keep: 'sn_8d69a92c40dc47b8bcb9a39f0d60197e', // נעה קינג — עדיין קיים בנושן
    drop: 'sn_1516e7911d944cb2920c83a7df43205a', // נועה קינג — "נמחק בנושן"
    keepName: 'נעה קינג',
  },
];

/** בכל טבלה: אילו שדות מחזיקים מזהה מתאמן, ואיזה שדה מחזיק את שמו. */
const ID_FIELDS = ['student_id', 'studentId', 'climber_id', 'climberId', 'entity_id'];
const NAME_FIELDS = ['participant_name', 'studentName', 'climber_name', 'student_name'];

const rowsPointingAt = (table, id) =>
  (Array.isArray(db.get(table)) ? db.get(table) : []).filter((r) =>
    ID_FIELDS.some((f) => r?.[f] === id),
  );

async function run() {
  await initDb();
  if (APPLY && !supa.isEnabled()) throw new Error('Supabase לא מחובר — לא מריצים');

  const backup = [];

  for (const { keep, drop, keepName } of PAIRS) {
    const students = db.get('students') || [];
    const keepStudent = students.find((s) => s.id === keep);
    const dropStudent = students.find((s) => s.id === drop);
    if (!keepStudent || !dropStudent) {
      console.log(`⏭️  ${drop} → ${keep}: אחד הצדדים לא נמצא (כבר טופל?)`);
      continue;
    }

    console.log(`\n=== ${dropStudent.name} (${drop})  →  ${keepName} (${keep})`);
    backup.push({ pair: [drop, keep], students: [dropStudent, keepStudent] });

    for (const table of CORE_TABLES) {
      if (table === 'students') continue;
      const moving = rowsPointingAt(table, drop);
      if (!moving.length) continue;

      const existing = rowsPointingAt(table, keep);
      for (const row of moving) {
        backup.push({ table, row });

        // ציוד: לתיק שנשאר כבר יש שורה לכל פריט — משאירים את שלו ומוחקים כפילות,
        // אלא אם השורה הנמחקת שילמה או נמסרה.
        if (table === 'student_equipment') {
          const twin = existing.find((r) => r.item_type === row.item_type);
          const worthKeeping = row.payment_status === 'paid' || row.fulfillment_status === 'given';
          if (twin && !worthKeeping) {
            console.log(`  · ${table}: מוחק כפילות ${row.item_type} (${row.id})`);
            if (APPLY) await db.deleteDurable(table, row.id);
            continue;
          }
        }

        // הרשמה לאותה פעילות שכבר קיימת בתיק שנשאר — מוחקים ולא מכפילים.
        if (table === 'activity_registrations') {
          const twin = existing.find((r) => r.activity_id === row.activity_id);
          if (twin) {
            console.log(`  · ${table}: מוחק הרשמה כפולה לאותה פעילות (${row.id})`);
            if (APPLY) await db.deleteDurable(table, row.id);
            continue;
          }
        }

        const updates = {};
        for (const f of ID_FIELDS) if (row[f] === drop) updates[f] = keep;
        for (const f of NAME_FIELDS) if (row[f]) updates[f] = keepName;
        console.log(`  · ${table}: מעביר ${row.id} (${Object.keys(updates).join(', ')})`);
        if (APPLY) {
          const saved = db.update(table, row.id, updates);
          await supa.upsert(table, saved || { ...row, ...updates });
        }
      }
    }

    // שדות שחסרים בתיק שנשאר ויש בתיק הנמחק.
    const fills = {};
    const carry = [
      'phone', 'birthDate', 'gender', 'idNumber', 'levelGrade', 'groupId',
      'healthSignedAt', 'waiverSignedAt', 'parentId',
    ];
    for (const f of carry) {
      if (!keepStudent[f] && dropStudent[f]) fills[f] = dropStudent[f];
    }
    const mergeNote = `אוחד עם תיק כפול "${dropStudent.name}" (${drop})`;
    if (!String(keepStudent.notes || '').includes(mergeNote)) {
      fills.notes = (keepStudent.notes ? `${keepStudent.notes}\n` : '') + mergeNote;
    }
    console.log(`  · students: משלים בתיק שנשאר ${JSON.stringify(fills)}`);
    if (APPLY) {
      const saved = db.update('students', keep, fills);
      await supa.upsert('students', saved);
      const res = await db.deleteDurable('students', drop);
      if (!res.ok) throw new Error(`מחיקת ${drop} נכשלה: ${JSON.stringify(res)}`);
      console.log(`  ✅ נמחק ${drop}`);
    }
  }

  const file = path.resolve(HERE, `../../.merge-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`\nגיבוי הרשומות שנגעו בהן: ${file}`);
  if (!APPLY) console.log('הדמיה בלבד — הרץ עם --apply כדי לבצע.');
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('❌ נכשל:', err?.stack || err?.message || err);
  process.exit(1);
});
