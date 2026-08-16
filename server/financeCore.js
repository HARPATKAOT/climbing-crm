/**
 * ליבת המרכז הפיננסי — FINANCE_SPEC.md שלב 0.
 *
 * כאן חיים: דגלי הפיצ'רים, רשימת הטבלאות החדשות, מזהים, dedupe_hash,
 * וסיווג התנועות (kind). הכול טהור חוץ מקריאת הדגלים; שום I/O אחר.
 */

import crypto from 'crypto';
import { db } from './db.js';

// ─── Feature flags ──────────────────────────────────────────────────────────
// ברירת מחדל: כבוי בפרודקשן, דלוק בפיתוח. הפעלה בפרודקשן: שורת settings
// (finance_center_settings, id 'default', flags: {name: true}) או env
// FINANCE_FLAG_<NAME>=1. כיבוי חירום: FINANCE_FLAG_<NAME>=0 גובר על הכול.
export const FINANCE_FLAGS = [
  'bank_ingestion',   // שלב 1 — משיכת בנק/אשראי
  'icount_outbox',    // שלב 1.5 — רשת ביטחון להנפקות
  'reconciliation',   // שלב 1.5 — יישוב לילי מול iCount
  'doc_ingestion',    // שלב 2 — קליטת חשבוניות מקבצים/מייל
  'matching_v2',      // שלב 3 — מנוע התאמה רבים-לרבים
  'rules_engine',     // שלב 4
  'ai_tagging',       // תיוג הוצאות עם ג'מיני (משוב 2)
  'payroll_cost',     // שלב 5
  'ledger',           // שלב 6
  'dashboard_v2',     // שלב 7
];

export function financeFlag(name) {
  if (!FINANCE_FLAGS.includes(name)) throw new Error(`דגל פיננסי לא מוכר: ${name}`);
  const env = process.env[`FINANCE_FLAG_${name.toUpperCase()}`];
  if (env === '0' || env === 'false') return false;
  if (env === '1' || env === 'true') return true;
  const settings = db.get('finance_center_settings').find((row) => row.id === 'default');
  if (settings?.flags && typeof settings.flags[name] === 'boolean') return settings.flags[name];
  return process.env.NODE_ENV !== 'production';
}

/**
 * שער ההנפקה: מסמך iCount אמיתי נוצר רק בפרודקשן. בכל סביבה אחרת מחזירים
 * false והקורא חייב לרשום ל-log במקום להנפיק. ההגנה בקונפיג, לא במשמעת
 * (FINANCE_SPEC 4.3.5). ICOUNT_ALLOW_REAL_DOCS=1 קיים לצורך בדיקה מבוקרת.
 */
export function icountRealDocsAllowed() {
  if (process.env.ICOUNT_ALLOW_REAL_DOCS === '1') return true;
  return process.env.NODE_ENV === 'production';
}

// ─── הטבלאות החדשות (kv collections; התאום המנורמל ב-database/20260815) ────
export const FINANCE_CENTER_TABLES = [
  'financial_accounts',       // חשבון בנק / כרטיס / קופה / סליקה
  'finance_transactions',     // כל תנועה גולמית, מכל מקור, באגורות
  'finance_matches',          // רבים-לרבים תנועה↔מסמך עם הקצאה חלקית
  'finance_categories',       // עץ קטגוריות
  'finance_cost_centers',     // מרכזי רווח/עלות
  'finance_cost_allocations', // פיצול שורת ledger בין מרכזים
  'finance_ledger_entries',   // שורת הספר הראשית — המקור לכל דוח
  'finance_cash_flow_items',  // צפי תזרים (תשלומים עתידיים, שכר, מע״מ)
  'finance_cc_cycles',        // מחזורי חיוב אשראי, לאימות settlement
  'finance_rules',            // מנוע חוקים: ספק→קטגוריה/מרכז
  'finance_inbox_items',      // תיבת הנכנס הפיננסית
  'finance_ingested_documents', // חשבוניות שנקלטו מקובץ/מייל (שלב 2)
  'finance_center_settings',  // דגלים והגדרות
  'icount_outbox',            // תור הנפקות עם idempotency
  'icount_links',             // מיפוי ישות מקומית ↔ מזהה iCount
];

// ─── מזהים ──────────────────────────────────────────────────────────────────
/** מזהה בסגנון הריפו (prefix+timestamp) עם סיומת אקראית נגד התנגשות באצווה. */
export function financeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

// ─── Dedupe ─────────────────────────────────────────────────────────────────
/**
 * חתימה יציבה לתנועה: אותה תנועה שמגיעה שוב (חלון משיכה חופף, ייבוא כפול,
 * scraper שרץ פעמיים) מקבלת אותו hash ונבלמת. external_id של הספק נכנס
 * כשקיים; בלעדיו הזהות היא המרכיבים העסקיים.
 */
export function transactionDedupeHash({
  provider = '',
  accountKey = '',
  bookingDate = '',
  amountAgorot = 0,
  description = '',
  externalId = '',
} = {}) {
  const base = [
    String(provider).trim().toLowerCase(),
    String(accountKey).trim(),
    String(bookingDate).slice(0, 10),
    String(amountAgorot),
    String(description).trim().toLowerCase().replace(/\s+/g, ' '),
    String(externalId).trim(),
  ].join('|');
  return `ftx-${crypto.createHash('sha256').update(base).digest('hex').slice(0, 32)}`;
}

/** זהות מסמך לצורך dedupe הפוך (iCount + מייל = מסמך אחד): ח.פ+מספר+סכום. */
export function documentDedupeKey({ supplierTaxId = '', docNumber = '', grossAgorot = 0 } = {}) {
  const tax = String(supplierTaxId).replace(/\D/g, '');
  const num = String(docNumber).trim().toLowerCase();
  if (!num) return '';
  return `doc|${tax}|${num}|${grossAgorot}`;
}

// ─── סיווג kind ─────────────────────────────────────────────────────────────
export const TRANSACTION_KINDS = [
  'income', 'expense', 'transfer', 'settlement', 'fee', 'refund', 'installment_future',
];

// חיוב חברת אשראי בחשבון הבנק — תקבול מרוכז, לא הוצאה. הרשימה מכסה את
// המנפיקים הישראליים; Max הוא הכרטיס העסקי בפועל.
// זהירות: \b ב-JavaScript עובד רק מול אותיות לטיניות — מול עברית הוא מת.
// לכן מילים עבריות קצרות נבדקות עם גבולות רווח/קצה מפורשים.
const SETTLEMENT_PATTERNS = [
  /מקס\s?איט|max\s?it|לאומי\s?קארד|leumi\s?card/i,
  /(^|\s)מקס(\s|$)|\bmax\b/i,
  /ישראכרט|isracard/i,
  /כרטיסי אשראי|(^|\s)כאל(\s|$)|\bcal\b/i,
  /דיינרס|diners|אמריקן אקספרס|american express|amex/i,
];

// העברת משכורות מהבנק. השכר עצמו נרשם בספר מתוך payroll_periods (הסכומים
// הפר-עובדיים), ולכן שורת הבנק היא סילוק ההתחייבות — transfer, לא הוצאה —
// אחרת אותה משכורת נספרת פעמיים. בכוונה בלי המילה 'שכר' לבדה: היא תופסת
// גם 'שכר דירה'.
const SALARY_TRANSFER_PATTERNS = [
  /משכורת|משכורות/,
  /מס[\"׳']?ב|masav/i,
];

// הפקדות סליקה של iCount / מסליקה כלשהי לחשבון — תקבול מרוכז של קבלות.
const CLEARING_DEPOSIT_PATTERNS = [
  /icount|איקאונט/i,
  /גביה|סליקה|clearing/i,
];

// תנועות בין חשבונות של אותו עסק — תזרים כן, רווחיות לא.
const TRANSFER_PATTERNS = [
  /העברה עצמית|העברה בין חשבונות/i,
  /הפקדת מזומן|הפקדה עצמית|הפקדת שיקים/i,
  /משיכת מזומן|כספומט|atm/i,
];

const FEE_PATTERNS = [
  /עמל[הת]|דמי ניהול|דמי כרטיס|ריבית חובה/i,
];

/**
 * סיווג ראשוני של תנועה גולמית. הכלל הקשיח: settlement/transfer לעולם לא
 * ייכנסו לרווח והפסד — הם קיימים בתזרים בלבד (FINANCE_SPEC 5.3).
 * חיוב מנפיק אשראי מזוהה רק בחשבון בנק (בתדפיס הכרטיס עצמו "מקס" לא מופיע
 * כבית עסק). מנוע החוקים (שלב 4) רשאי לעדן, לעולם לא להפוך settlement להוצאה.
 */
export function classifyTransactionKind({
  description = '',
  amountAgorot = 0,
  accountType = 'bank',
} = {}) {
  const text = String(description);
  if (accountType === 'bank' && amountAgorot < 0 && SETTLEMENT_PATTERNS.some((p) => p.test(text))) {
    return 'settlement';
  }
  if (accountType === 'bank' && amountAgorot > 0 && CLEARING_DEPOSIT_PATTERNS.some((p) => p.test(text))) {
    return 'settlement';
  }
  if (accountType === 'bank' && amountAgorot < 0 && SALARY_TRANSFER_PATTERNS.some((p) => p.test(text))) {
    return 'transfer';
  }
  if (TRANSFER_PATTERNS.some((p) => p.test(text))) return 'transfer';
  if (FEE_PATTERNS.some((p) => p.test(text))) return 'fee';
  // זיכוי מבית עסק על הכרטיס — כסף שחוזר, מקטין הוצאות (נכנס לרווחיות).
  if (accountType === 'credit_card' && amountAgorot > 0) return 'refund';
  return amountAgorot >= 0 ? 'income' : 'expense';
}

/** רק אלה נכנסים לרווח והפסד. settlement/transfer — תזרים בלבד. */
export function countsTowardProfit(kind) {
  return ['income', 'expense', 'fee', 'refund'].includes(kind);
}
