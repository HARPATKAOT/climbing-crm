/**
 * מעקב תשלומי עובדים: שורה אחת לכל עובד לכל חודש.
 *
 * המערכת כבר יודעת לחשב כמה מגיע לעובד — `summarizeWork` ו-`summarizeByRole`
 * עושים בדיוק את זה. מה שחסר הוא הצד השני: האם התשלום באמת בוצע, ואילו
 * מסמכים התקבלו עליו. הקובץ הזה מחזיק את הידע הזה בלבד, ואת חישוב הכסף הוא
 * צורך מ-wageRates.js ולא משכפל.
 *
 * שורה פתוחה מציגה סיכום חי מתוך שורות העבודה; שורה סגורה מציגה את הסיכום
 * שנצרב עליה ברגע הסגירה. חודש שנסגר הוא האמת ההיסטורית שלו, ושינוי תעריף
 * בהסכם אחריו לא מזיז אותו.
 */

import { summarizeWork, summarizeByRole } from './wageRates.js';

export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** סוגי המסמכים שהמעקב החודשי עוקב אחריהם, לפי סדר ההצגה במסך. */
export const PERIOD_DOC_TYPES = Object.freeze([
  'payslip',
  'invoice',
  'salary_transfer',
  'pension_split',
  'pension_deposit',
]);

export const COMPANY_PAYMENT_TYPES = Object.freeze({
  national_insurance: 'ביטוח לאומי',
});

export function isValidPeriod(value) {
  return PERIOD_PATTERN.test(String(value || ''));
}

/** גבולות התאריכים של חודש, לסינון שורות עבודה. */
export function periodBounds(period) {
  if (!isValidPeriod(period)) return null;
  const [year, month] = String(period).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/** שורות העבודה של עובד בחודש מסוים. */
export function rowsForPeriod(workAssignments, employeeId, period) {
  const bounds = periodBounds(period);
  if (!bounds) return [];
  return (workAssignments || []).filter((row) => (
    row?.employee_id === employeeId && row.date >= bounds.from && row.date <= bounds.to
  ));
}

/**
 * הסיכום החודשי: שעות, שכר, ימי עבודה, נסיעות וסה"כ, ולצידם פירוט לפי תפקיד.
 * כל המספרים מגיעים מ-wageRates — כאן רק מרכיבים אותם לאובייקט אחד.
 */
export function buildPeriodSummary(rows, agreement) {
  return { ...summarizeWork(rows, agreement), by_role: summarizeByRole(rows, agreement) };
}

/**
 * המסמכים שנדרשים מהעובד הזה.
 *
 * מי שמקבל בחשבונית לא מוציא תלוש, ולהיפך; ומי שאין לו קופת פנסיה לא אמור
 * לקבל דף פיצול. סלוט שלא נדרש לא מוצג במסך ולא נספר כחוסר.
 */
export function requiredDocTypes(employee) {
  const types = [employee?.payment_method === 'invoice' ? 'invoice' : 'payslip', 'salary_transfer'];
  if (String(employee?.pensionCompany || '').trim()) types.push('pension_split', 'pension_deposit');
  return types;
}

/** המסמכים ששייכים לחודש מסוים, מתוך כל מסמכי העובד. */
export function documentsForPeriod(documents, period) {
  return (documents || []).filter((doc) => doc?.period === period);
}

/**
 * מה חסר בחודש הזה. „חסר” הוא סוג מסמך שנדרש מהעובד ואין עליו קובץ.
 * סכום הפקדה לפנסיה נספר גם הוא כפריט חסר — בלעדיו אין מה להשוות מול הפיצול.
 */
export function periodCompleteness({ employee, documents, period, stored } = {}) {
  const required = requiredDocTypes(employee);
  const present = new Set(documentsForPeriod(documents, period).map((doc) => doc.type));
  const missing = required.filter((type) => !present.has(type));
  const needsPension = required.includes('pension_deposit');
  const pensionAmount = Number(stored?.pension_amount);
  const missingPensionAmount = needsPension && !(Number.isFinite(pensionAmount) && pensionAmount > 0);
  return {
    required,
    present: [...present],
    missing,
    missing_pension_amount: missingPensionAmount,
    complete: missing.length === 0 && !missingPensionAmount,
  };
}

/**
 * מה להציג לחודש: שורה סגורה מחזירה את הסיכום הצרוב שלה, שורה פתוחה את החי.
 * זה הכלל היחיד שקובע, ולכן הוא יושב בפונקציה אחת ולא מפוזר בין המסכים.
 */
export function mergeStoredWithLive(stored, liveSummary) {
  if (stored?.status === 'sealed' && stored.summary) return stored.summary;
  return liveSummary;
}

/** שורה ריקה לחודש שעוד לא נגעו בו — כדי שהמסך תמיד יקבל אותו מבנה. */
export function emptyPeriodRow(employeeId, period) {
  return {
    id: null,
    employee_id: employeeId,
    period,
    status: 'open',
    summary: null,
    sealed_at: null,
    salary_paid_at: null,
    salary_amount: null,
    pension_amount: null,
    pension_paid_at: null,
    notes: '',
  };
}

/** השדות שמותר לעדכן ידנית על שורה חודשית. שאר השדות נגזרים או נצרבים. */
export const EDITABLE_PERIOD_FIELDS = Object.freeze([
  'salary_paid_at',
  'salary_amount',
  'pension_amount',
  'pension_paid_at',
  'notes',
]);

const isBlank = (value) => value === undefined || value === null || value === '';

/** ניקוי גוף בקשה: רק שדות מותרים, מספרים כמספרים ותאריכים בפורמט תקין. */
export function sanitizePeriodPatch(body = {}) {
  const patch = {};
  for (const field of EDITABLE_PERIOD_FIELDS) {
    if (!(field in body)) continue;
    const value = body[field];
    if (field === 'notes') {
      patch.notes = String(value || '').slice(0, 2000);
      continue;
    }
    if (field.endsWith('_at')) {
      if (isBlank(value)) { patch[field] = null; continue; }
      const date = String(value).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw Object.assign(new Error('תאריך אינו תקין'), { statusCode: 400 });
      }
      patch[field] = date;
      continue;
    }
    if (isBlank(value)) { patch[field] = null; continue; }
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw Object.assign(new Error('סכום אינו תקין'), { statusCode: 400 });
    }
    patch[field] = Math.round(amount * 100) / 100;
  }
  return patch;
}

/**
 * התצוגה המלאה של חודש אחד: הסיכום שיש להציג, המסמכים, ומה חסר.
 * זו הצורה שכל ה-routes מחזירים, כדי שהמסכים לא יבנו אותה כל אחד לעצמו.
 */
export function buildPeriodView({ employee, period, stored, workAssignments, agreement, documents } = {}) {
  const rows = rowsForPeriod(workAssignments, employee?.id, period);
  const live = buildPeriodSummary(rows, agreement);
  const row = stored || emptyPeriodRow(employee?.id, period);
  return {
    ...row,
    employee_id: employee?.id,
    employee_name: employee?.name || '',
    payment_method: employee?.payment_method || 'slip',
    period,
    summary: mergeStoredWithLive(stored, live),
    live_summary: live,
    documents: documentsForPeriod(documents, period),
    completeness: periodCompleteness({ employee, documents, period, stored }),
  };
}

/** כל החודשים שיש עליהם משהו לעובד — עבודה, שורה שמורה או מסמך. */
export function periodsForEmployee({ employeeId, workAssignments, storedRows, documents } = {}) {
  const periods = new Set();
  for (const row of workAssignments || []) {
    if (row?.employee_id !== employeeId || !row.date) continue;
    periods.add(String(row.date).slice(0, 7));
  }
  for (const row of storedRows || []) {
    if (row?.employee_id === employeeId && isValidPeriod(row.period)) periods.add(row.period);
  }
  for (const doc of documents || []) {
    if (isValidPeriod(doc?.period)) periods.add(doc.period);
  }
  return [...periods].filter(isValidPeriod).sort().reverse();
}
