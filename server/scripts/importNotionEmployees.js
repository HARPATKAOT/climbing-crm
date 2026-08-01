/**
 * ייבוא העובדים הפעילים מ-Notion למערכת, יחד עם הסכמי השכר שלהם.
 *
 * המקור הוא צילום מצב ב-notion-active-employees.json — נשלף מ-Notion ב-1.8.2026
 * ונשמר בקובץ כדי שהייבוא יהיה ניתן לבדיקה ולהרצה חוזרת בלי טוקן של Notion.
 *
 * הרצה:
 *   node scripts/importNotionEmployees.js          → הדמיה בלבד, לא נכתב כלום
 *   node scripts/importNotionEmployees.js --apply  → כתיבה בפועל (Supabase + db.json)
 *
 * הסקריפט מוסיף בלבד: עובד שכבר קיים במערכת (לפי טלפון, ת"ז או שם) לא נוגעים
 * בו ולא בהסכם שלו, כדי שעריכה שנעשתה במערכת החדשה לא תידרס על ידי Notion.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb } = await import('../db.js');
const { supa } = await import('../supa.js');

const APPLY = process.argv.includes('--apply');
const SNAPSHOT = path.resolve(HERE, 'notion-active-employees.json');

/** מספרי טלפון מגיעים מ-Notion גם כ-+972 וגם כ-05, וצריך צורה אחת להשוואה. */
function normPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('972')) return `0${digits.slice(3)}`;
  return digits;
}

/** ת"ז נשמרת ב-Notion כמספר, כך שאפס מוביל נעלם. */
function normId(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits ? digits.padStart(9, '0') : '';
}

const normName = (raw) => String(raw || '').replace(/\s+/g, ' ').trim();

/** סוג שכר ב-Notion → התפקיד שהתעריף שלו במערכת. */
const ROLE_OF_STATUS = { סנפלינג: 'הדרכת סנפלינג' };

/**
 * התפקידים של העובד. מלבד ההסמכות שסומנו ב-Notion, כל תפקיד שיש לו תעריף
 * בהסכם מסומן גם הוא — מסך העובד שומר תעריף רק לתפקיד מסומן, ובלי זה
 * התעריף שיובא היה נמחק בעריכה הראשונה של הכרטיס.
 */
function certificationsOf(emp) {
  const list = [];
  const add = (value) => {
    const v = normName(value);
    if (v && !list.includes(v)) list.push(v);
  };
  (emp.notionCerts || []).forEach(add);
  (emp.rates || []).forEach((r) => add(r.role));
  add(ROLE_OF_STATUS[emp.status]);
  return list;
}

function notesOf(emp) {
  const parts = [];
  if (emp.notionNotes) parts.push(emp.notionNotes);
  if (emp.notionClass) parts.push(`סיווג ב-Notion: ${emp.notionClass}`);
  parts.push(`יובא מ-Notion (${emp.status || 'ללא סטטוס'})`);
  return parts.join(' · ');
}

function toEmployee(emp) {
  const files = emp.notionFiles || [];
  return {
    name: normName(emp.name),
    phone: normPhone(emp.phone),
    email: emp.email || '',
    address: emp.address || '',
    gender: emp.gender || '',
    birthDate: emp.birthDate || '',
    idNumber: normId(emp.idNumber),
    payment_method: emp.paymentMethod === 'חשבונית' ? 'invoice' : 'slip',
    bank_account_details: emp.bankAccount || '',
    pensionCompany: emp.pensionCompany || '',
    pensionNumber: emp.pensionNumber || '',
    mobility: !!emp.mobility,
    notes: notesOf(emp),
    is_active: true,
    certifications: certificationsOf(emp),
    documents: {},
    // הקבצים עצמם נשארו ב-Notion. הסימונים כאן אומרים מה כבר נמסר, כדי
    // שרשימת המסמכים החסרים במערכת תהיה נכונה מהרגע הראשון.
    hasForm101: files.includes('form101'),
    hasIdPhoto: files.includes('idPhoto'),
    hasCertificates: files.includes('certificates'),
    policeClearance: files.includes('police'),
    contractSigned: files.includes('contract'),
    salaryTransferred: false,
    source: 'notion_import',
    notionUrl: emp.notionUrl,
  };
}

function findExisting(existing, candidate) {
  const phone = candidate.phone;
  const id = candidate.idNumber;
  const name = candidate.name;
  for (const row of existing) {
    if (phone && normPhone(row.phone) === phone) return { row, by: 'טלפון' };
    if (id && normId(row.idNumber) === id) return { row, by: 'ת"ז' };
    if (name && normName(row.name) === name) return { row, by: 'שם' };
  }
  // כרטיס ותיק שנפתח עם שם פרטי בלבד — "יונתן" מול "יונתן ברזילי". שני שמות
  // מלאים שחולקים שם פרטי ("עומר גזית" ו"עומר בזר") הם אנשים שונים, ולכן
  // החשד קם רק כששם אחד מהם הוא מילה בודדת.
  const first = name.split(' ')[0];
  for (const row of existing) {
    const other = normName(row.name);
    if (!other || !first) continue;
    const oneIsSingleWord = !other.includes(' ') || !name.includes(' ');
    if (oneIsSingleWord && other.split(' ')[0] === first) {
      return { row, by: 'שם פרטי', suspect: true };
    }
  }
  return null;
}

async function run() {
  await initDb();

  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  // עותק, לא המערך של המטמון: הרשימה גדלה תוך כדי ריצה כדי לזהות כפילויות
  // בתוך הייבוא עצמו, ובהדמיה אסור שהתוספות האלה ידלפו ל-db.json.
  const existing = [...(db.get('employees') || [])];
  const agreements = db.get('wage_agreements') || [];

  console.log(`📖 ${snapshot.employees.length} עובדים בצילום המצב מ-Notion (${snapshot.fetchedAt})`);
  console.log(`📇 ${existing.length} עובדים כבר במערכת`);
  console.log(APPLY ? '✍️  מצב כתיבה\n' : '🔍 הדמיה בלבד — הרץ עם --apply כדי לכתוב\n');

  const added = [];
  const skipped = [];
  const suspects = [];
  const idBase = Date.now();

  for (const raw of snapshot.employees) {
    const candidate = toEmployee(raw);
    const match = findExisting(existing, candidate);

    if (match) {
      const line = `${candidate.name} — קיים במערכת (התאמה לפי ${match.by}: ${match.row.name})`;
      if (match.suspect) suspects.push(line);
      else skipped.push(line);
      continue;
    }

    const rates = (raw.rates || []).filter((r) => r?.role && Number(r.amount) > 0);
    const travel = Math.max(0, Number(raw.travelPerDay) || 0);

    if (APPLY) {
      // מזהה מפורש: db.insert בונה אותו מ-Date.now(), ולולאה שלמה רצה באותה
      // אלפית שנייה הייתה נותנת לכמה עובדים את אותו מזהה.
      const stamp = idBase + added.length;
      const saved = db.insert('employees', { ...candidate, id: `em${stamp}` });
      existing.push(saved);
      // db.insert שולח ל-Supabase ברקע ולא ממתין. סקריפט שמסיים מיד היה נסגר
      // לפני שהכתיבה יצאה, ורק db.json המקומי היה מתעדכן — לכן כותבים כאן שוב
      // ובהמתנה, אל החנות הקבועה שממנה המערכת החיה קוראת.
      await supa.upsert('employees', saved);
      if (rates.length || travel) {
        const agreement = db.insert('wage_agreements', {
          id: `wa${stamp}`,
          employee_id: saved.id,
          rates: rates.map((r) => ({
            role: String(r.role),
            mode: r.mode || 'hourly',
            amount: Math.max(0, Number(r.amount) || 0),
          })),
          travel_per_day: travel,
        });
        await supa.upsert('wage_agreements', agreement);
      }
    } else {
      existing.push(candidate);
    }

    const rateText = rates.length
      ? rates.map((r) => `${r.role} ${r.amount}₪`).join(', ') + (travel ? `, נסיעות ${travel}₪/יום` : '')
      : travel
        ? `נסיעות ${travel}₪/יום`
        : 'ללא הסכם שכר';
    added.push(`${candidate.name} — ${rateText}`);
  }

  console.log(`✅ נוספו ${added.length}:`);
  added.forEach((l) => console.log(`   • ${l}`));
  if (skipped.length) {
    console.log(`\n⏭️  דולגו ${skipped.length} (כבר קיימים):`);
    skipped.forEach((l) => console.log(`   • ${l}`));
  }
  if (suspects.length) {
    console.log(`\n⚠️  ${suspects.length} חשד לכפילות — לא יובאו, כדאי לבדוק ידנית:`);
    suspects.forEach((l) => console.log(`   • ${l}`));
  }
  const before = { emp: existing.length - added.length, wage: agreements.length };
  console.log(`\n📊 עובדים: ${before.emp} → ${existing.length}`);
  console.log(`📊 הסכמי שכר: ${before.wage} → ${(APPLY ? (db.get('wage_agreements') || []).length : before.wage)}`);
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('❌ הייבוא נכשל:', err?.message || err);
  process.exit(1);
});
