/**
 * עץ קטגוריות, מנוע חוקים ומע״מ — FINANCE_SPEC שלב 4.
 *
 * העץ נזרע פעם אחת עם מיפוי מהתוויות החופשיות הקיימות (Notion 'סיווג
 * הוצאה' + expense_type של iCount) דרך legacy_labels. חוק נלמד מפעולת
 * משתמש: "כל חיוב מ-X → קטגוריה Y, ספק Z" — ומוחל אוטומטית מכאן והלאה.
 */

import { financeId } from './financeCore.js';
import { cleanText } from './finance.js';
import { supplierSimilarity } from './matchingEngine.js';

// ─── עץ ברירת המחדל ─────────────────────────────────────────────────────────
// id יציב (לא מזהה אקראי) כדי שחוקים ומיפויים ישרדו זריעה חוזרת.
export const DEFAULT_CATEGORIES = [
  // הכנסות
  { id: 'cat_income', name: 'הכנסות', parent_id: null, is_income: true },
  { id: 'cat_income_classes', name: 'חוגים', parent_id: 'cat_income', is_income: true },
  { id: 'cat_income_entries', name: 'כניסות ומנויים', parent_id: 'cat_income', is_income: true },
  { id: 'cat_income_pos', name: 'קופה וחנות', parent_id: 'cat_income', is_income: true },
  { id: 'cat_income_events', name: 'אירועים וימי הולדת', parent_id: 'cat_income', is_income: true },
  // עלויות ישירות
  { id: 'cat_cogs', name: 'עלויות ישירות', parent_id: null, is_cogs: true },
  { id: 'cat_cogs_goods', name: 'סחורה לקופה', parent_id: 'cat_cogs', is_cogs: true, cost_behavior: 'variable', legacy_labels: ['מוצרים למכירה', 'סחורה', 'קפה', 'מזון'] },
  { id: 'cat_cogs_gear', name: 'ציוד מתכלה', parent_id: 'cat_cogs', is_cogs: true, cost_behavior: 'variable', legacy_labels: ['ציוד טיפוס', 'מגנזיום', 'אחיזות'] },
  // תפעול
  { id: 'cat_ops', name: 'תפעול', parent_id: null },
  { id: 'cat_ops_rent', name: 'שכר דירה', parent_id: 'cat_ops', cost_behavior: 'fixed', legacy_labels: ['שכירות', 'שכ"ד', 'שכר דירה'] },
  { id: 'cat_ops_utilities', name: 'חשמל ומים', parent_id: 'cat_ops', cost_behavior: 'semi', legacy_labels: ['חשמל', 'מים', 'גז'] },
  { id: 'cat_ops_property_tax', name: 'ארנונה', parent_id: 'cat_ops', cost_behavior: 'fixed', legacy_labels: ['ארנונה'] },
  { id: 'cat_ops_insurance', name: 'ביטוח', parent_id: 'cat_ops', cost_behavior: 'fixed', legacy_labels: ['ביטוח', 'ביטוחים'] },
  { id: 'cat_ops_maintenance', name: 'תחזוקה וניקיון', parent_id: 'cat_ops', cost_behavior: 'semi', legacy_labels: ['תחזוקה', 'ניקיון', 'תיקונים'] },
  { id: 'cat_ops_equipment', name: 'ציוד קבוע', parent_id: 'cat_ops', cost_behavior: 'fixed', legacy_labels: ['ציוד', 'ריהוט', 'מחשבים'] },
  // הנהלה וכלליות
  { id: 'cat_admin', name: 'הנהלה וכלליות', parent_id: null },
  { id: 'cat_admin_accounting', name: 'הנהלת חשבונות', parent_id: 'cat_admin', cost_behavior: 'fixed', legacy_labels: ['הנהלת חשבונות', 'רואה חשבון', 'רו"ח'] },
  { id: 'cat_admin_software', name: 'תוכנה ומנויים', parent_id: 'cat_admin', cost_behavior: 'fixed', legacy_labels: ['תוכנה', 'מנויים', 'אינטרנט ותוכנות'] },
  { id: 'cat_admin_comms', name: 'תקשורת', parent_id: 'cat_admin', cost_behavior: 'fixed', legacy_labels: ['טלפון', 'תקשורת', 'אינטרנט'] },
  { id: 'cat_admin_legal', name: 'ייעוץ ומשפטי', parent_id: 'cat_admin', legacy_labels: ['עורך דין', 'ייעוץ'] },
  // שיווק
  { id: 'cat_marketing', name: 'שיווק ופרסום', parent_id: null, cost_behavior: 'variable', legacy_labels: ['שיווק', 'פרסום', 'קידום'] },
  // כוח אדם
  { id: 'cat_hr', name: 'כוח אדם', parent_id: null },
  { id: 'cat_hr_wages', name: 'שכר עובדים', parent_id: 'cat_hr', cost_behavior: 'semi', vat_deductible_rate: 0, legacy_labels: ['שכר', 'משכורות', 'עובדים'] },
  { id: 'cat_hr_social', name: 'ביטוח לאומי והפרשות', parent_id: 'cat_hr', cost_behavior: 'semi', vat_deductible_rate: 0, legacy_labels: ['ביטוח לאומי', 'פנסיה'] },
  // מימון
  { id: 'cat_finance', name: 'מימון ועמלות', parent_id: null },
  { id: 'cat_finance_bank', name: 'עמלות בנק', parent_id: 'cat_finance', cost_behavior: 'fixed', vat_deductible_rate: 0, legacy_labels: ['עמלות', 'עמלות בנק'] },
  { id: 'cat_finance_clearing', name: 'עמלות סליקה', parent_id: 'cat_finance', cost_behavior: 'variable', vat_deductible_rate: 1, legacy_labels: ['סליקה', 'עמלות אשראי'] },
];

const CATEGORY_DEFAULTS = {
  cost_behavior: 'variable',
  is_cogs: false,
  is_income: false,
  vat_deductible_rate: 1,
  tax_deductible_rate: 1,
  legacy_labels: [],
};

/** זריעה idempotent: קיים לא נדרס — התאמות של המשתמש שורדות. */
export function seedCategories(store) {
  const existing = new Set(store.get('finance_categories').map((row) => row.id));
  let inserted = 0;
  DEFAULT_CATEGORIES.forEach((category, index) => {
    if (existing.has(category.id)) return;
    store.insert('finance_categories', { ...CATEGORY_DEFAULTS, sort_order: index, ...category });
    inserted += 1;
  });
  return { inserted, total: store.get('finance_categories').length };
}

/** תווית חופשית ישנה → קטגוריה בעץ, לפי legacy_labels. */
export function categoryForLegacyLabel(categories, label) {
  const wanted = cleanText(label);
  if (!wanted) return null;
  return categories.find((category) =>
    (category.legacy_labels || []).some((legacy) => cleanText(legacy) === wanted)
    || cleanText(category.name) === wanted) || null;
}

// ─── מנוע החוקים ────────────────────────────────────────────────────────────

/** האם חוק תופס תנועה. matcher: {merchant_pattern, min_agorot?, max_agorot?}. */
export function ruleMatches(rule, transaction) {
  if (rule.is_active === false) return false;
  const matcher = rule.matcher || {};
  const description = `${transaction.merchant_raw || ''} ${transaction.raw_description || ''}`;
  if (matcher.merchant_pattern) {
    if (supplierSimilarity(description, [matcher.merchant_pattern]) < 0.6) return false;
  }
  const amount = Math.abs(transaction.amount_agorot || 0);
  if (matcher.min_agorot != null && amount < matcher.min_agorot) return false;
  if (matcher.max_agorot != null && amount > matcher.max_agorot) return false;
  return true;
}

/**
 * מחיל חוקים על כל התנועות הלא מסווגות. חוק לעולם לא הופך settlement/transfer
 * להוצאה (kind נשמר), ולא דורס סיווג ידני (status 'classified' עם category).
 */
export function applyRules(store, { now = new Date().toISOString() } = {}) {
  const rules = store.get('finance_rules').filter((rule) => rule.is_active !== false);
  const summary = { scanned: 0, classified: 0 };
  for (const transaction of store.get('finance_transactions')) {
    if (!['income', 'expense', 'fee'].includes(transaction.kind)) continue;
    if (transaction.status === 'voided' || transaction.category_id) continue;
    summary.scanned += 1;
    const rule = rules.find((candidate) => ruleMatches(candidate, transaction));
    if (!rule) continue;
    store.update('finance_transactions', transaction.id, {
      ...transaction,
      category_id: rule.set_category_id || transaction.category_id,
      supplier_id: rule.set_supplier_id || transaction.supplier_id,
      cost_center_id: rule.set_cost_center_id || transaction.cost_center_id || null,
      status: 'classified',
      classified_by: `rule:${rule.id}`,
      classified_at: now,
    });
    store.update('finance_rules', rule.id, { ...rule, hits: (rule.hits || 0) + 1 });
    summary.classified += 1;
  }
  return summary;
}

/** יצירת חוק מפעולת משתמש — "מהיום, כל חיוב כזה מסווג כך". idempotent. */
export function learnRule(store, {
  merchantPattern,
  categoryId = null,
  supplierId = null,
  costCenterId = null,
  createdBy = null,
} = {}) {
  const pattern = String(merchantPattern || '').trim();
  if (!pattern) throw new Error('חסר דפוס בית עסק לחוק');
  if (!categoryId && !supplierId && !costCenterId) throw new Error('חוק חייב לקבוע לפחות קטגוריה, ספק או מרכז עלות');
  const existing = store.get('finance_rules').find((rule) =>
    cleanText(rule.matcher?.merchant_pattern) === cleanText(pattern)
    && rule.set_category_id === categoryId && rule.set_supplier_id === supplierId);
  if (existing) return { rule: existing, created: false };
  const rule = store.insert('finance_rules', {
    id: financeId('frl'),
    matcher: { merchant_pattern: pattern },
    set_category_id: categoryId,
    set_supplier_id: supplierId,
    set_cost_center_id: costCenterId,
    learned_from: null,
    created_by: createdBy,
    hits: 0,
    is_active: true,
  });
  return { rule, created: true };
}

// ─── מע״מ ───────────────────────────────────────────────────────────────────

/**
 * תמונת מע״מ לתקופה: עסקאות (מהמסמכים), תשומות שניתן לקזז (הוצאות מסווגות
 * לפי שיעור הקיזוז של הקטגוריה), ותשומות אבודות (חיובים בלי חשבונית).
 * הכול באגורות.
 */
export function vatSummary({
  documentsVatAgorot = 0,
  transactions = [],
  matches = [],
  categories = [],
  vatRate = 0.18,
} = {}) {
  const categoryById = new Map(categories.map((category) => [String(category.id), category]));
  const confirmed = new Map();
  for (const match of matches.filter((row) => row.status === 'confirmed')) {
    confirmed.set(String(match.transaction_id),
      (confirmed.get(String(match.transaction_id)) || 0) + Math.abs(match.allocated_agorot || 0));
  }
  let deductible = 0;
  let lost = 0;
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense' || transaction.status === 'voided') continue;
    const amount = Math.abs(transaction.amount_agorot);
    const vatPortion = Math.round(amount - amount / (1 + vatRate));
    const rate = categoryById.get(String(transaction.category_id || ''))?.vat_deductible_rate ?? 1;
    const covered = Math.min(confirmed.get(String(transaction.id)) || 0, amount);
    // מע״מ מתקזז רק על החלק שיש לו מסמך, ולפי שיעור הקיזוז של הקטגוריה.
    deductible += Math.round(vatPortion * (covered / amount) * rate);
    lost += Math.round(vatPortion * ((amount - covered) / amount) * rate);
  }
  return {
    output_vat_agorot: documentsVatAgorot,       // מע״מ עסקאות (מהמסמכים שלנו)
    input_vat_deductible_agorot: deductible,     // תשומות מגובות מסמך
    input_vat_lost_agorot: lost,                 // "כסף על הרצפה"
    net_position_agorot: documentsVatAgorot - deductible,
  };
}
