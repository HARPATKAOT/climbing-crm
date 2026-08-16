/**
 * מרכז ההוצאות — תמונת הוצאה אחת ויחידה לכל הוצאה כלכלית.
 *
 * הכלל: תנועות הבנק/אשראי הן השדרה. מסמך (הוצאת iCount או חשבונית שהועלתה)
 * שמקושר לתנועה — מתקפל לתוך שורת התנועה; מסמך בלי תנועה מקבל שורה משלו;
 * תנועה בלי מסמך מסומנת "חסרה חשבונית" (זו אוכלוסיית "המע״מ האבוד").
 * מסמך ingested במצב merged כבר מיוצג על ידי תאום ה-iCount שלו — לא מוצג.
 *
 * builder טהור בדפוס buildPaymentsReport: מקבל נתונים, לא ניגש ל-db.
 */

import { toAgorot } from './financeMoney.js';
import { countsTowardProfit } from './financeCore.js';
import { chooseExpenseRows, cleanText, dateInRange } from './finance.js';
import { categoryForLegacyLabel } from './financeCategories.js';

const OPEN_MATCH_STATUSES = new Set(['confirmed', 'proposed']);

const SOURCE_OF_EXPENSE = {
  icount: 'icount',
  notion: 'notion',
  manual: 'manual',
};

function categorySource(row) {
  if (!row) return null;
  const by = String(row.classified_by || '');
  if (by.startsWith('ai:')) return 'ai';
  if (by.startsWith('rule:')) return 'rule';
  if (row.category_id) return 'manual';
  return null;
}

export function buildExpenseCenter({
  expenses = [],
  transactions = [],
  matches = [],
  ingested = [],
  deliveries = [],
  categories = [],
  suppliers = [],
  accounts = [],
  from,
  to,
} = {}) {
  const categoryById = new Map(categories.map((category) => [String(category.id), category]));
  const supplierById = new Map(suppliers.map((supplier) => [String(supplier.id), supplier]));
  const accountById = new Map(accounts.map((account) => [String(account.id), account]));
  const deliveryByExpense = new Map(deliveries
    .filter((delivery) => delivery.status === 'sent')
    .map((delivery) => [String(delivery.expense_id), delivery]));

  const openMatches = matches.filter((match) => OPEN_MATCH_STATUSES.has(match.status));
  const matchesByTxn = new Map();
  const matchesByDoc = new Map();
  for (const match of openMatches) {
    if (!matchesByTxn.has(String(match.transaction_id))) matchesByTxn.set(String(match.transaction_id), []);
    matchesByTxn.get(String(match.transaction_id)).push(match);
    if (!matchesByDoc.has(String(match.document_id))) matchesByDoc.set(String(match.document_id), []);
    matchesByDoc.get(String(match.document_id)).push(match);
  }

  const dedupedExpenses = chooseExpenseRows(expenses);
  const expenseById = new Map(dedupedExpenses.map((expense) => [String(expense.id), expense]));
  const ingestedById = new Map(ingested.map((doc) => [String(doc.id), doc]));

  const categoryName = (categoryId) => categoryById.get(String(categoryId || ''))?.name || null;

  const documentSideOf = (documentId) => {
    const expense = expenseById.get(String(documentId));
    if (expense) {
      return {
        kind: 'expense',
        expense,
        source_tag: SOURCE_OF_EXPENSE[expense.source] || 'icount',
        supplier_name: expense.supplier_name || expense.name || '',
        doc_number: expense.document_number || '',
        has_file: Boolean(expense.attachment_metadata?.length) || expense.source === 'icount',
        download_url: expense.attachment_metadata?.length
          ? `/api/finance/expenses/${expense.id}/attachments/${expense.attachment_metadata[expense.attachment_metadata.length - 1].id}/download`
          : null,
      };
    }
    const doc = ingestedById.get(String(documentId));
    if (doc) {
      return {
        kind: 'ingested',
        ingested: doc,
        source_tag: doc.source === 'email' ? 'email' : 'manual',
        supplier_name: doc.supplier_name || '',
        doc_number: doc.doc_number || '',
        has_file: true,
        download_url: `/api/finance/documents/${doc.id}/download`,
      };
    }
    return null;
  };

  const rows = [];
  const representedExpenseIds = new Set();
  const representedIngestedIds = new Set();

  // ── השדרה: תנועות בנק/אשראי ──────────────────────────────────────────────
  for (const transaction of transactions) {
    if (!['expense', 'fee'].includes(transaction.kind) || !countsTowardProfit(transaction.kind)) continue;
    if (transaction.status === 'voided') continue;
    if (!dateInRange(transaction.booking_date, from, to)) continue;
    const account = accountById.get(String(transaction.account_id));
    const txnMatches = matchesByTxn.get(String(transaction.id)) || [];
    const documentSides = txnMatches
      .map((match) => ({ match, side: documentSideOf(match.document_id) }))
      .filter((entry) => entry.side);
    for (const entry of documentSides) {
      if (entry.side.kind === 'expense') representedExpenseIds.add(String(entry.side.expense.id));
      else representedIngestedIds.add(String(entry.side.ingested.id));
    }
    const best = documentSides[0] || null;
    const confirmed = documentSides.some((entry) => entry.match.status === 'confirmed');
    const supplier = supplierById.get(String(transaction.supplier_id || ''));
    rows.push({
      id: `txn:${transaction.id}`,
      date: transaction.booking_date,
      supplier_id: transaction.supplier_id || null,
      supplier_name: supplier?.name || best?.side.supplier_name || transaction.merchant_raw || transaction.raw_description || '',
      description: transaction.raw_description || '',
      amount_agorot: -Math.abs(transaction.amount_agorot),
      source_tags: [...new Set([
        account?.type === 'bank' ? 'bank' : 'credit_card',
        ...documentSides.map((entry) => entry.side.source_tag),
      ])],
      invoice_status: best ? (confirmed ? 'matched' : 'proposed') : 'missing',
      invoice: best ? {
        document_id: String(best.match.document_id),
        doc_number: best.side.doc_number,
        download_url: best.side.download_url,
      } : null,
      category_id: transaction.category_id || null,
      category_name: categoryName(transaction.category_id),
      category_source: categorySource(transaction),
      refs: {
        transaction_id: String(transaction.id),
        expense_id: best?.side.kind === 'expense' ? String(best.side.expense.id) : null,
        ingested_document_id: best?.side.kind === 'ingested' ? String(best.side.ingested.id) : null,
      },
      accountant_delivery: best?.side.kind === 'expense'
        ? deliveryByExpense.get(String(best.side.expense.id)) || null
        : null,
    });
  }

  // ── מסמכים בלי תנועה מכסה ────────────────────────────────────────────────
  for (const expense of dedupedExpenses) {
    if (representedExpenseIds.has(String(expense.id))) continue;
    const gross = Number(expense.amount_gross);
    if (!(gross > 0)) continue;
    if (!dateInRange(expense.expense_date, from, to)) continue;
    const side = documentSideOf(expense.id);
    const category = expense.category_id
      ? categoryById.get(String(expense.category_id))
      : (expense.categories?.length ? categoryForLegacyLabel(categories, expense.categories[0]) : null);
    rows.push({
      id: `exp:${expense.id}`,
      date: String(expense.expense_date || '').slice(0, 10),
      supplier_id: expense.supplier_id || null,
      supplier_name: expense.supplier_name || expense.name || '',
      description: expense.name || '',
      amount_agorot: -toAgorot(gross),
      source_tags: [side.source_tag],
      invoice_status: side.has_file ? 'attached' : 'missing',
      invoice: side.has_file ? { document_id: String(expense.id), doc_number: side.doc_number, download_url: side.download_url } : null,
      category_id: category?.id || null,
      category_name: category?.name || null,
      category_source: expense.category_source || (expense.category_id ? 'manual' : (category ? 'rule' : null)),
      refs: { transaction_id: null, expense_id: String(expense.id), ingested_document_id: null },
      accountant_delivery: deliveryByExpense.get(String(expense.id)) || null,
    });
  }

  for (const doc of ingested) {
    if (doc.status === 'merged' || representedIngestedIds.has(String(doc.id))) continue;
    if (!(doc.total_gross_agorot > 0)) continue;
    const date = String(doc.issue_date || doc.created_at || '').slice(0, 10);
    if (!dateInRange(date, from, to)) continue;
    rows.push({
      id: `doc:${doc.id}`,
      date,
      supplier_id: doc.supplier_id || null,
      supplier_name: doc.supplier_name || '',
      description: doc.file_name || '',
      amount_agorot: -Math.abs(doc.total_gross_agorot),
      source_tags: [doc.source === 'email' ? 'email' : 'manual'],
      invoice_status: 'attached',
      invoice: { document_id: String(doc.id), doc_number: doc.doc_number || '', download_url: `/api/finance/documents/${doc.id}/download` },
      category_id: null,
      category_name: null,
      category_source: null,
      refs: { transaction_id: null, expense_id: null, ingested_document_id: String(doc.id) },
      accountant_delivery: null,
    });
  }

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const summary = {
    count: rows.length,
    total_agorot: rows.reduce((sum, row) => sum + Math.abs(row.amount_agorot), 0),
    missing_invoice: rows.filter((row) => row.invoice_status === 'missing').length,
    missing_invoice_agorot: rows.filter((row) => row.invoice_status === 'missing')
      .reduce((sum, row) => sum + Math.abs(row.amount_agorot), 0),
    untagged: rows.filter((row) => !row.category_id).length,
    sent_to_accountant: rows.filter((row) => row.accountant_delivery).length,
  };
  return { rows, summary };
}

/** חיפוש חופשי בשורות המרכז — לצד הלקוח אין את הטקסטים המנורמלים. */
export function filterExpenseRows(rows, query) {
  const wanted = cleanText(query);
  if (!wanted) return rows;
  return rows.filter((row) =>
    cleanText(`${row.supplier_name} ${row.description} ${row.invoice?.doc_number || ''}`).includes(wanted));
}
