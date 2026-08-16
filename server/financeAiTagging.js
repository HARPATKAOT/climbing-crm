/**
 * תיוג הוצאות עם ג'מיני — FINANCE_SPEC משוב 2.
 *
 * ה-AI מייעץ, לא קובע: חוק (rule) וסיווג ידני גוברים עליו תמיד. לכן שורה
 * מתויגת-AI מקבלת category_id + classified_by 'ai:gemini' אבל *לא* status
 * 'classified' — חוק שיילמד אחר כך רשאי לדרוס אותה, ותיקון ידני עם
 * create_rule הופך לחוק קבוע.
 *
 * נשלח למודל: תיאור, שם ספק, סכום, תאריך. לא נשלחים פרטי לקוחות או כרטיסים.
 * אושר על ידי הבעלים ב-16.08.
 */

import { db } from './db.js';
import { persistCore } from './db.js';
import { callGeminiJson } from './aiActions.js';
import { isAiServiceOpen, recordAiFailure, recordAiSuccess } from './aiServiceState.js';
import { chooseExpenseRows } from './finance.js';

const CONFIDENCE_FLOOR = 0.7;

function taggingSchema(categoryIds) {
  return {
    type: 'object',
    properties: {
      assignments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            category_id: { type: 'string', enum: categoryIds },
            confidence: { type: 'number' },
          },
          required: ['id', 'category_id', 'confidence'],
        },
      },
    },
    required: ['assignments'],
  };
}

function buildPrompt(categories, batch) {
  const tree = categories
    .filter((category) => !category.is_income)
    .map((category) => {
      const parent = categories.find((item) => String(item.id) === String(category.parent_id));
      return `${category.id} — ${category.name}${parent ? ` (תחת ${parent.name})` : ''}`;
    })
    .join('\n');
  const lines = batch.map((item) =>
    `id=${item.id} | ספק: ${item.supplier || 'לא ידוע'} | תיאור: ${item.description || ''} | סכום: ${item.amount} ש"ח | תאריך: ${item.date}`);
  return [
    'אתה מסווג הוצאות של עסק קיר טיפוס (חוגי ילדים, קופה/חנות, אירועים).',
    'שייך כל הוצאה לקטגוריה המתאימה ביותר מהעץ. אם אינך בטוח — confidence נמוך.',
    '', 'עץ הקטגוריות (id — שם):', tree,
    '', 'ההוצאות:', ...lines,
  ].join('\n');
}

/** ההוצאות שעוד אין להן קטגוריה — תנועות בנק/אשראי וגם מסמכי הוצאה. */
export function untaggedExpenseItems(store) {
  const items = [];
  for (const transaction of store.get('finance_transactions')) {
    if (!['expense', 'fee'].includes(transaction.kind) || transaction.status === 'voided') continue;
    if (transaction.category_id) continue;
    items.push({
      target: 'transaction',
      id: `txn:${transaction.id}`,
      raw_id: String(transaction.id),
      supplier: transaction.merchant_raw || '',
      description: transaction.raw_description || '',
      amount: Math.round(Math.abs(transaction.amount_agorot) / 100),
      date: transaction.booking_date,
    });
  }
  for (const expense of chooseExpenseRows(store.get('finance_expenses'))) {
    if (expense.category_id || (expense.categories || []).length) continue;
    const gross = Number(expense.amount_gross);
    if (!(gross > 0)) continue;
    items.push({
      target: 'expense',
      id: `exp:${expense.id}`,
      raw_id: String(expense.id),
      supplier: expense.supplier_name || '',
      description: expense.name || '',
      amount: Math.round(gross),
      date: String(expense.expense_date || '').slice(0, 10),
    });
  }
  return items;
}

/**
 * ריצת תיוג אחת (לילית או ידנית). עד maxBatches אצוות של batchSize —
 * תקרה לילית ששומרת על המכסה של ג'מיני. שבירת מעגל: אם השירות פתוח
 * (כשלים קודמים) — מדלגים בלי לשרוף בקשות.
 */
export async function tagUntaggedExpenses(store, {
  callModel = callGeminiJson,
  apiKey = process.env.GEMINI_API_KEY,
  batchSize = 40,
  maxBatches = 5,
  now = new Date(),
} = {}) {
  if (isAiServiceOpen(db, now)) {
    return { skipped: true, reason: 'שירות ה-AI מושבת זמנית (כשלים קודמים)' };
  }
  const categories = store.get('finance_categories').filter((category) => !category.is_income);
  const categoryIds = categories.map((category) => String(category.id));
  if (!categoryIds.length) return { skipped: true, reason: 'אין עץ קטגוריות' };

  const untagged = untaggedExpenseItems(store);
  const summary = { candidates: untagged.length, tagged: 0, low_confidence: 0, invalid: 0, batches: 0 };
  if (!untagged.length) return summary;

  for (let offset = 0; offset < untagged.length && summary.batches < maxBatches; offset += batchSize) {
    const batch = untagged.slice(offset, offset + batchSize);
    const raw = await callModel(buildPrompt(store.get('finance_categories'), batch), {
      apiKey,
      responseSchema: taggingSchema(categoryIds),
    });
    if (!raw) {
      await recordAiFailure(db, persistCore, 'finance tagging: model returned nothing', { now });
      return { ...summary, error: 'המודל לא החזיר תשובה' };
    }
    summary.batches += 1;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    const assignments = Array.isArray(parsed?.assignments) ? parsed.assignments : [];
    const batchById = new Map(batch.map((item) => [item.id, item]));
    for (const assignment of assignments) {
      const item = batchById.get(String(assignment.id));
      // רשת כפולה: enum בסכימה + אימות בקוד — id לא מוכר לא נכנס לספרים.
      if (!item || !categoryIds.includes(String(assignment.category_id))) { summary.invalid += 1; continue; }
      if (!(Number(assignment.confidence) >= CONFIDENCE_FLOOR)) { summary.low_confidence += 1; continue; }
      if (item.target === 'transaction') {
        const transaction = store.get('finance_transactions').find((row) => String(row.id) === item.raw_id);
        if (!transaction || transaction.category_id) continue;
        store.update('finance_transactions', transaction.id, {
          ...transaction,
          category_id: String(assignment.category_id),
          classified_by: 'ai:gemini',
          classified_at: now.toISOString(),
        });
      } else {
        const expense = store.get('finance_expenses').find((row) => String(row.id) === item.raw_id);
        if (!expense || expense.category_id) continue;
        store.update('finance_expenses', expense.id, {
          ...expense,
          category_id: String(assignment.category_id),
          category_source: 'ai',
        });
      }
      summary.tagged += 1;
    }
  }
  await recordAiSuccess(db, persistCore, { now });
  return summary;
}
