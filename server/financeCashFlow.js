/**
 * תזרים מזומנים: צפי 90 יום — FINANCE_SPEC 6.2.
 *
 * מקורות הצפי:
 *  - תשלומי אשראי עתידיים: כבר נכנסים בקליטה (source_type 'installment').
 *  - הוצאות מחזוריות: ספק שמחויב ≥3 חודשים רצופים בסכום דומה → הקרנה קדימה.
 *  - שכר: ממוצע שלושת החודשים האחרונים, יוצא ב-10 לחודש.
 *  - מע״מ: הפוזיציה של החודש שעבר, ב-15 לחודש (הערכה).
 *  - הכנסת חוגים: סך מחירי ההרשמות הפעילות, נכנס ב-5 לחודש.
 *
 * מזהים דטרמיניסטיים — ריצה חוזרת מחליפה, לא מכפילה. שורות שנוצרו כאן
 * ואינן רלוונטיות עוד מסומנות superseded_at, לא נמחקות.
 */

import crypto from 'crypto';
import { toAgorot } from './financeMoney.js';
import { enrollmentActiveInMonth } from './payrollCost.js';

const monthOf = (value) => String(value || '').slice(0, 7);
const GENERATED_SOURCES = new Set(['recurring_expense', 'payroll', 'vat', 'recurring_income']);

function forecastId(sourceType, sourceId, dueDate) {
  return `fcf_${crypto.createHash('sha1').update(`${sourceType}|${sourceId}|${dueDate}`).digest('hex').slice(0, 20)}`;
}

function addMonths(month, count) {
  const cursor = new Date(`${month}-01T00:00:00Z`);
  cursor.setUTCMonth(cursor.getUTCMonth() + count);
  return cursor.toISOString().slice(0, 7);
}

/** זיהוי מחזוריות: אותו ספק, ≥3 חודשים רצופים מתוך 4 האחרונים, סטייה ≤15%. */
export function detectRecurringExpenses({ expenses = [], now } = {}) {
  const currentMonth = monthOf(now || new Date().toISOString());
  const window = [-4, -3, -2, -1].map((offset) => addMonths(currentMonth, offset));
  const bySupplier = new Map();
  for (const expense of expenses) {
    const supplier = String(expense.supplier_name || expense.name || '').trim();
    const month = monthOf(expense.expense_date);
    const gross = Number(expense.amount_gross);
    if (!supplier || !(gross > 0) || !window.includes(month)) continue;
    if (!bySupplier.has(supplier)) bySupplier.set(supplier, new Map());
    const months = bySupplier.get(supplier);
    months.set(month, (months.get(month) || 0) + toAgorot(gross));
  }
  const recurring = [];
  for (const [supplier, months] of bySupplier) {
    // רצף: שלושת החודשים האחרונים בחלון קיימים כולם
    const streak = window.slice(-3).every((month) => months.has(month));
    if (!streak) continue;
    const amounts = window.slice(-3).map((month) => months.get(month));
    const median = amounts.slice().sort((a, b) => a - b)[1];
    const deviation = Math.max(...amounts.map((amount) => Math.abs(amount - median) / median));
    if (deviation > 0.15) continue;
    const days = expenses
      .filter((expense) => String(expense.supplier_name || expense.name || '').trim() === supplier && months.has(monthOf(expense.expense_date)))
      .map((expense) => Number(String(expense.expense_date || '').slice(8, 10)) || 1);
    recurring.push({
      supplier,
      amount_agorot: median,
      day_of_month: days.slice().sort((a, b) => a - b)[Math.floor(days.length / 2)] || 1,
    });
  }
  return recurring;
}

export function rebuildCashFlowForecast(store, { now = new Date().toISOString(), horizonMonths = 3 } = {}) {
  const nowMonth = monthOf(now);
  const today = now.slice(0, 10);
  const existing = new Map(store.get('finance_cash_flow_items').map((row) => [row.id, row]));
  const touched = new Set();
  const put = (item) => {
    const id = forecastId(item.source_type, item.source_id, item.due_date);
    const row = { id, settled_transaction_id: null, superseded_at: null, ...item };
    if (existing.has(id)) store.update('finance_cash_flow_items', id, { ...existing.get(id), ...row });
    else store.insert('finance_cash_flow_items', row);
    existing.set(id, row);
    touched.add(id);
  };
  const futureMonths = Array.from({ length: horizonMonths }, (_v, index) => addMonths(nowMonth, index + 1));
  const summary = { recurring_expenses: 0, payroll: 0, vat: 0, income: 0 };

  // הוצאות מחזוריות
  const recurring = detectRecurringExpenses({ expenses: store.get('finance_expenses'), now });
  for (const item of recurring) {
    for (const month of futureMonths) {
      put({
        due_date: `${month}-${String(item.day_of_month).padStart(2, '0')}`,
        amount_agorot: -item.amount_agorot,
        direction: 'out',
        confidence: 'recurring',
        recurrence_rule: 'monthly',
        source_type: 'recurring_expense',
        source_id: item.supplier,
        description: `הוצאה מחזורית: ${item.supplier}`,
      });
      summary.recurring_expenses += 1;
    }
  }

  // שכר: ממוצע שלושת החודשים הסגורים האחרונים מספר החשבונות (accrual)
  const ledger = store.get('finance_ledger_entries').filter((entry) => !entry.voided_at);
  const wageMonths = [-3, -2, -1].map((offset) => addMonths(nowMonth, offset));
  const wageTotal = ledger
    .filter((entry) => entry.basis === 'accrual' && entry.source_type === 'payroll' && wageMonths.includes(entry.period))
    .reduce((sum, entry) => sum + Math.abs(entry.amount_agorot), 0);
  const monthlyWage = Math.round(wageTotal / wageMonths.length);
  if (monthlyWage > 0) {
    for (const month of futureMonths) {
      put({
        due_date: `${month}-10`,
        amount_agorot: -monthlyWage,
        direction: 'out',
        confidence: 'recurring',
        recurrence_rule: 'monthly',
        source_type: 'payroll',
        source_id: 'monthly-average',
        description: 'שכר משוער (ממוצע 3 חודשים)',
      });
      summary.payroll += 1;
    }
  }

  // מע״מ: הכנסות פחות תשומות של החודש הקודם, ב-15 לחודש הנוכחי/הבא
  const lastMonth = addMonths(nowMonth, -1);
  const outputVat = ledger
    .filter((entry) => entry.basis === 'accrual' && entry.source_type === 'document' && entry.period === lastMonth)
    .reduce((sum, entry) => sum + (entry.vat_agorot || 0), 0);
  if (outputVat > 0) {
    const dueDate = `${nowMonth}-15` >= today ? `${nowMonth}-15` : `${addMonths(nowMonth, 1)}-15`;
    put({
      due_date: dueDate,
      amount_agorot: -outputVat,
      direction: 'out',
      confidence: 'estimated',
      recurrence_rule: 'monthly',
      source_type: 'vat',
      source_id: lastMonth,
      description: `מע״מ משוער לתקופת ${lastMonth} (לפני קיזוז תשומות)`,
    });
    summary.vat += 1;
  }

  // הכנסת חוגים צפויה: מחירי ההרשמות הפעילות
  const enrollments = store.get('enrollments');
  for (const month of futureMonths) {
    const expected = enrollments
      .filter((enrollment) => enrollmentActiveInMonth(enrollment, month))
      .reduce((sum, enrollment) => sum + toAgorot(Number(enrollment.price) || 0), 0);
    if (!expected) continue;
    put({
      due_date: `${month}-05`,
      amount_agorot: expected,
      direction: 'in',
      confidence: 'recurring',
      recurrence_rule: 'monthly',
      source_type: 'recurring_income',
      source_id: 'enrollments',
      description: 'הכנסת חוגים צפויה (הרשמות פעילות)',
    });
    summary.income += 1;
  }

  // שורות שנוצרו כאן בעבר ואינן רלוונטיות עוד
  let superseded = 0;
  for (const [id, row] of existing) {
    if (touched.has(id) || !GENERATED_SOURCES.has(row.source_type) || row.superseded_at) continue;
    if (String(row.due_date) >= today) {
      store.update('finance_cash_flow_items', id, { ...row, superseded_at: now });
      superseded += 1;
    }
  }
  return { ...summary, items: touched.size, superseded };
}

/** ציר הזמן לתצוגה: פריטים עתידיים + מצטבר + יתרת מינימום יחסית. */
export function cashFlowTimeline({ items = [], from, days = 90 } = {}) {
  const start = from || new Date().toISOString().slice(0, 10);
  const end = new Date(new Date(`${start}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  const relevant = items
    .filter((item) => !item.superseded_at && !item.settled_transaction_id)
    .filter((item) => item.due_date >= start && item.due_date <= end)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  let running = 0;
  let minimum = { amount_agorot: 0, date: start };
  const timeline = relevant.map((item) => {
    running += item.amount_agorot;
    if (running < minimum.amount_agorot) minimum = { amount_agorot: running, date: item.due_date };
    return { ...item, cumulative_agorot: running };
  });
  return {
    from: start,
    to: end,
    items: timeline,
    total_in_agorot: relevant.filter((item) => item.amount_agorot > 0).reduce((sum, item) => sum + item.amount_agorot, 0),
    total_out_agorot: relevant.filter((item) => item.amount_agorot < 0).reduce((sum, item) => sum - item.amount_agorot, 0),
    net_agorot: running,
    minimum,
    note: 'המצטבר יחסי להיום — יתרת הבנק עצמה תתווסף כשמשיכת הבנק תופעל (חסם B1).',
  };
}
