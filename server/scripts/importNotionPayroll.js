/**
 * שלב ב' של העברת „תשלומי עובדים” מ-Notion: כתיבת השורות והקבצים למערכת.
 *
 * בנושן יש שורה נפרדת לכל סוג תשלום — משכורת, פנסיה, חשבונית — לאותו עובד
 * ואותו חודש. במערכת יש שורה אחת לחודש, ולכן הסקריפט מקפל אותן: כל שורת נושן
 * תורמת את המסמכים שלה ואת הסכום שלה לאותה שורה חודשית.
 *
 * ביטוח לאומי אינו מיוחס לעובד יחיד ולכן עובר ל-company_payments.
 *
 *   node scripts/importNotionPayroll.js <תיקיית-הקבצים>          → הדמיה
 *   node scripts/importNotionPayroll.js <תיקיית-הקבצים> --apply  → ייבוא
 *
 * אידמפוטנטי: שורה שכבר יובאה (לפי מזהה עמוד ה-Notion) מדולגת, כך שאפשר
 * להריץ שוב אחרי תיקון בלי ליצור כפילויות.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const HERE = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(HERE, '../.env') });

const { db, initDb, persistCore } = await import('../db.js');
const { supa } = await import('../supa.js');

const FOLDER = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!FOLDER) {
  console.error('שימוש: node scripts/importNotionPayroll.js <תיקיית-הקבצים> [--apply]');
  process.exit(1);
}

/**
 * סוג התשלום בנושן → לאיזה סלוט כל אחד משני שדות הקבצים הולך.
 * `statement` הוא שדה „תלוש / דוח פיצול”, `transfer` הוא „העברה בנקאית”.
 */
const TYPE_MAP = {
  'משכורת': { statement: 'payslip', transfer: 'salary_transfer', amountField: 'salary_amount' },
  'חשבונית על עבודה': { statement: 'invoice', transfer: 'salary_transfer', amountField: 'salary_amount' },
  'פנסיה': { statement: 'pension_split', transfer: 'pension_deposit', amountField: 'pension_amount' },
  'קרן השתלמות': { statement: 'other', transfer: 'other' },
  '106': { statement: 'other', transfer: 'other' },
  'סיום העסקה': { statement: 'other', transfer: 'other' },
  'לא נדרש תשלום': { statement: 'other', transfer: 'other' },
};

const COMPANY_TYPES = { 'ביטוח לאומי': 'national_insurance' };

const EXT_OF_MIME = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
};

const stripDashes = (value) => String(value || '').replace(/-/g, '').toLowerCase();
const normName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/** התאמה לכרטיס במערכת לפי מזהה עמוד ה-Notion שנשמר בייבוא העובדים. */
function matchEmployee(employees, employeeNotionId) {
  if (!employeeNotionId) return null;
  const pageId = stripDashes(employeeNotionId);
  return employees.find((e) => e.notionUrl && stripDashes(e.notionUrl).endsWith(pageId)) || null;
}

/** הסוגים שדלי האחסון מקבל. כל השאר נדחה, ולכן אסור להעביר אותו כמו שהוא. */
const ALLOWED_MIME = new Set(Object.keys(EXT_OF_MIME));

/**
 * הסוג האמיתי של הקובץ, לפי הבייטים הראשונים שלו.
 *
 * הרבה קבצים ב-Notion נשמרו בלי סיומת בשם („אוריאן קריאף - העברה 3.2025”),
 * ואז ה-Content-Type שחוזר הוא text/plain — סוג שהדלי דוחה. הכותרת אינה
 * עדות; הבייטים כן.
 */
function detectMime(buffer, contentType) {
  if (buffer.length >= 4) {
    const head = buffer.subarray(0, 4);
    if (head.toString('latin1') === '%PDF') return 'application/pdf';
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG') return 'image/png';
    if (buffer.length >= 12 && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  }
  const declared = String(contentType || '').split(';')[0].trim().toLowerCase();
  return ALLOWED_MIME.has(declared) ? declared : 'application/pdf';
}

const extensionOf = (mimeType) => EXT_OF_MIME[mimeType] || 'pdf';

async function run() {
  await initDb();

  const manifestPath = path.join(FOLDER, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest.json לא נמצא ב-${FOLDER}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const employees = db.get('employees') || [];
  const existingPeriods = db.get('payroll_periods') || [];
  const existingCompany = db.get('company_payments') || [];
  const alreadyImported = new Set(
    [...existingPeriods, ...existingCompany].flatMap((row) => row.source_ids || (row.source_id ? [row.source_id] : []))
  );

  console.log(APPLY ? '✍️  מצב ייבוא\n' : '🔍 הדמיה בלבד — הרץ עם --apply כדי לייבא\n');

  const unmatched = [];
  const skippedRows = [];
  const oversized = [];
  let importedRows = 0;
  let importedDocs = 0;
  let importedCompany = 0;

  // קיפול: כל שורות נושן של אותו עובד ואותו חודש מתלכדות לשורה חודשית אחת.
  const buckets = new Map();
  const companyRows = [];

  for (const row of manifest) {
    if (row.skipped) { skippedRows.push(`${row.notionPageId} — ${row.skipped}`); continue; }

    const type = String(row.type || '').trim();
    if (COMPANY_TYPES[type]) { companyRows.push({ ...row, companyType: COMPANY_TYPES[type] }); continue; }

    const mapping = TYPE_MAP[type];
    if (!mapping) { skippedRows.push(`${row.period} / ${type || '—'} — סוג לא מוכר`); continue; }

    const employee = matchEmployee(employees, row.employeeNotionId);
    if (!employee) { unmatched.push(`${row.period} / ${type}`); continue; }

    const key = `${employee.id}|${row.period}`;
    const bucket = buckets.get(key) || { employee, period: row.period, sourceIds: [], docs: [], notes: [], fields: {} };
    bucket.sourceIds.push(row.notionPageId);
    if (row.notes) bucket.notes.push(`${type}: ${row.notes}`);
    if (row.statusNote) bucket.notes.push(`${type}: ${row.statusNote}`);
    if (mapping.amountField && Number.isFinite(row.total)) bucket.fields[mapping.amountField] = row.total;
    for (const file of row.files || []) {
      const docType = mapping[file.slot];
      if (!docType) continue;
      bucket.docs.push({ ...file, docType, sourceType: type });
    }
    buckets.set(key, bucket);
  }

  /**
   * כתיבה אחת לכל עובד, ולא אחת לכל חודש.
   *
   * db.update שולח את השמירה ל-Supabase בלי להמתין לה. עובד עם עשרים חודשים
   * קיבל עשרים כתיבות רודפות, ושמירה מוקדמת נחתה אחרי מאוחרת ודרסה אותה עם
   * רשימה קצרה יותר — כך אבדו כשליש מהמסמכים בריצה הראשונה.
   */
  const byEmployee = new Map();
  for (const bucket of buckets.values()) {
    const list = byEmployee.get(bucket.employee.id) || { employee: bucket.employee, buckets: [] };
    list.buckets.push(bucket);
    byEmployee.set(bucket.employee.id, list);
  }

  /** מסמך מזוהה לפי סוג, חודש ושם הקובץ המקורי — כך ריצה חוזרת לא מכפילה. */
  const docKey = (type, period, title) => `${type}|${period}|${title}`;

  for (const { employee, buckets: employeeBuckets } of byEmployee.values()) {
    const fresh = (db.get('employees') || []).find((e) => e.id === employee.id) || employee;
    const current = Array.isArray(fresh.payroll_documents) ? fresh.payroll_documents : [];
    const have = new Set(current.map((d) => docKey(d.type, d.period, d.title)));
    const saved = [];

    for (const bucket of employeeBuckets) {
      const { period, docs, fields } = bucket;
      const pending = docs.filter((doc) => !have.has(docKey(doc.docType, period, doc.originalName)));
      const label = pending.length === docs.length ? `${docs.length} קבצים` : `${pending.length}/${docs.length} חסרים`;
      console.log(`• ${employee.name} / ${period} — ${label}${fields.pension_amount ? `, פנסיה ₪${fields.pension_amount}` : ''}`);
      if (!APPLY) { importedDocs += pending.length; continue; }

      for (const doc of pending) {
        const filePath = path.join(FOLDER, doc.file);
        if (!fs.existsSync(filePath)) { console.error(`  ❌ קובץ חסר: ${doc.file}`); continue; }
        const buffer = fs.readFileSync(filePath);
        if (buffer.length > 10 * 1024 * 1024) {
          oversized.push(`${employee.name} / ${period} / ${doc.originalName} — ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
          continue;
        }
        const id = `paydoc-${crypto.randomUUID()}`;
        const mimeType = detectMime(buffer, doc.contentType);
        const storagePath = `${employee.id}/payroll/${period}/${id}.${extensionOf(mimeType)}`;
        const uploaded = await supa.uploadEmployeeDocument(storagePath, buffer, mimeType);
        if (!uploaded.ok) { console.error(`  ❌ העלאה נכשלה: ${doc.originalName} — ${uploaded.error}`); continue; }
        saved.push({
          id,
          employee_id: employee.id,
          type: doc.docType,
          period,
          title: doc.originalName,
          file_name: String(doc.originalName).replace(/[^\w֐-׿.\-]+/g, '_').slice(0, 120),
          mime_type: mimeType,
          storage_path: storagePath,
          source: 'notion',
          uploaded_at: new Date().toISOString(),
        });
        have.add(docKey(doc.docType, period, doc.originalName));
        importedDocs += 1;
      }
    }

    if (APPLY && saved.length) {
      const latest = (db.get('employees') || []).find((e) => e.id === employee.id) || fresh;
      const updated = db.update('employees', employee.id, {
        payroll_documents: [...saved, ...(Array.isArray(latest.payroll_documents) ? latest.payroll_documents : [])],
      });
      await persistCore('employees', updated);
    }
  }

  for (const bucket of buckets.values()) {
    const { employee, period, fields, notes, sourceIds } = bucket;
    // שורה חודשית שכבר נוצרה לא נוצרת שוב — רק המסמכים החסרים הושלמו למעלה.
    if (sourceIds.some((id) => alreadyImported.has(id))) { skippedRows.push(`${employee.name} / ${period} — השורה כבר קיימת`); continue; }
    if (!APPLY) { importedRows += 1; continue; }

    const periodRow = db.insert('payroll_periods', {
      employee_id: employee.id,
      period,
      status: 'sealed',
      // אין שורות עבודה היסטוריות לחודשים האלה, ולכן אין מה לצרוב מהחישוב.
      // הסכום שיובא הוא מה שנושן ידע, והוא נשמר כפי שהוא.
      summary: null,
      sealed_at: new Date().toISOString(),
      notes: notes.join(' · ').slice(0, 2000),
      source: 'notion',
      source_ids: sourceIds,
      ...fields,
    });
    await persistCore('payroll_periods', periodRow);
    importedRows += 1;
  }

  for (const row of companyRows) {
    if (alreadyImported.has(row.notionPageId)) { skippedRows.push(`ביטוח לאומי / ${row.period} — כבר יובא`); continue; }
    console.log(`• ביטוח לאומי / ${row.period}${Number.isFinite(row.total) ? ` — ₪${row.total}` : ''}`);
    if (!APPLY) { importedCompany += 1; continue; }
    const saved = db.insert('company_payments', {
      period: row.period,
      type: row.companyType,
      type_label: 'ביטוח לאומי',
      amount: Number.isFinite(row.total) ? row.total : null,
      paid_at: null,
      notes: [row.notes, row.statusNote].filter(Boolean).join(' · ').slice(0, 2000),
      document: null,
      source: 'notion',
      source_id: row.notionPageId,
    });
    await persistCore('company_payments', saved);
    importedCompany += 1;
  }

  console.log(`\n${APPLY ? '✅ יובאו' : '🔍 יובאו בהרצה אמיתית'}: ${importedRows} שורות חודשיות, ${importedDocs} מסמכים, ${importedCompany} תשלומי ביטוח לאומי`);
  if (unmatched.length) {
    console.log(`\n❓ ${unmatched.length} שורות בלי עובד תואם במערכת:`);
    unmatched.forEach((line) => console.log(`   • ${line}`));
  }
  if (oversized.length) {
    console.log(`\n⚠️  ${oversized.length} קבצים מעל 10MB לא הועלו:`);
    oversized.forEach((line) => console.log(`   • ${line}`));
  }
  if (skippedRows.length) console.log(`\n⏭️  ${skippedRows.length} שורות דולגו (כבר יובאו או חסרות נתונים)`);
}

run().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
