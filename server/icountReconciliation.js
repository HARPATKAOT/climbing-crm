/**
 * יישוב יתרות מול iCount — FINANCE_SPEC 4.3.7.
 *
 * ג'וב לילי שמשווה פר חודש: גבייה תפעולית (payments) מול מסמכי iCount,
 * ספירת מסמכים, מע״מ, ותשלומים בלי מסמך. כל פער הופך לפריט בתיבת הנכנס
 * עם הסבר — לא שורת לוג. פירוט מלא נשמר ב-finance_reconciliation_items.
 *
 * טהור: store מוזרק, אפס I/O.
 */

import { toAgorot } from './financeMoney.js';
import { financeId } from './financeCore.js';
import { classifyDocument, normalizePaymentStatus } from './finance.js';
import { upsertInboxItem } from './bankIngestion.js';

const monthOf = (value) => String(value || '').slice(0, 7);

/** סכום שנחשב "מיושב": פער עד שקל — עיגולים, לא בעיה אמיתית. */
const TOLERANCE_AGOROT = 100;

function monthsBack(count, now) {
  const result = [];
  const cursor = new Date(`${(now || new Date().toISOString()).slice(0, 7)}-01T00:00:00Z`);
  for (let index = 0; index < count; index += 1) {
    result.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return result;
}

function paidPaymentDate(payment) {
  return (payment.paid_at || payment.completed_at || payment.updated_at || payment.created_at || '').slice(0, 10);
}

/**
 * משווה חודש אחד. מחזיר את שורות הפירוט; פריטי inbox נוצרים רק על פער אמיתי.
 */
export function reconcileMonth(store, { month, payments = [], documents = [], now }) {
  const monthPayments = payments.filter((payment) => {
    const status = normalizePaymentStatus(payment.status, { amount: payment.amount });
    return status === 'paid' && monthOf(paidPaymentDate(payment)) === month;
  });
  const monthDocs = documents.filter((doc) => monthOf(doc.document_date) === month);
  const recognized = monthDocs.filter((doc) =>
    classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).recognized);

  const collectedAgorot = monthPayments.reduce((sum, payment) => sum + toAgorot(Math.abs(Number(payment.amount) || 0)), 0);
  const documentedAgorot = recognized.reduce((sum, doc) => {
    const sign = classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).sign;
    return sum + toAgorot(Math.abs(Number(doc.total_gross) || 0)) * sign;
  }, 0);
  const vatAgorot = recognized.reduce((sum, doc) => {
    const sign = classifyDocument(doc.doctype, { isStorno: doc.is_storno, total: doc.total_gross }).sign;
    return sum + toAgorot(Math.abs(Number(doc.vat_amount) || 0)) * sign;
  }, 0);
  const undocumented = monthPayments.filter((payment) => !payment.icount_doc_number);
  const undocumentedAgorot = undocumented.reduce((sum, payment) => sum + toAgorot(Math.abs(Number(payment.amount) || 0)), 0);

  // הפער המוסבר: גבייה בלי מסמך היא הסבר ידוע — מה שנשאר אחריו הוא הבעיה.
  const rawGap = collectedAgorot - documentedAgorot;
  const unexplainedGap = rawGap - undocumentedAgorot;

  const detail = {
    id: `recon:${month}`,
    month,
    computed_at: (now || new Date().toISOString()),
    payments_count: monthPayments.length,
    documents_count: recognized.length,
    collected_agorot: collectedAgorot,
    documented_agorot: documentedAgorot,
    vat_agorot: vatAgorot,
    undocumented_count: undocumented.length,
    undocumented_agorot: undocumentedAgorot,
    gap_agorot: rawGap,
    unexplained_gap_agorot: unexplainedGap,
    undocumented_payment_ids: undocumented.map((payment) => payment.id),
    status: Math.abs(unexplainedGap) <= TOLERANCE_AGOROT && undocumented.length === 0 ? 'balanced' : 'gap',
  };
  const existing = store.get('finance_reconciliation_items').find((row) => row.id === detail.id);
  if (existing) store.update('finance_reconciliation_items', detail.id, { ...existing, ...detail });
  else store.insert('finance_reconciliation_items', detail);

  if (undocumented.length) {
    upsertInboxItem(store, {
      item_type: 'charge_without_document',
      ref_table: 'finance_reconciliation_items',
      ref_id: detail.id,
      title: `${month}: ${undocumented.length} תשלומים שנגבו בלי מסמך iCount`,
      detail: `סכום כולל ${(undocumentedAgorot / 100).toLocaleString('he-IL')} ש״ח. לכל תשלום כזה מגיעה קבלה — אחרת הספרים לא יסגרו מול הרו״ח.`,
      amount_agorot: undocumentedAgorot,
    });
  }
  if (Math.abs(unexplainedGap) > TOLERANCE_AGOROT) {
    upsertInboxItem(store, {
      item_type: 'reconciliation_gap',
      ref_table: 'finance_reconciliation_items',
      ref_id: detail.id,
      title: `${month}: פער לא מוסבר בין הגבייה למסמכים`,
      detail: `נגבה ${(collectedAgorot / 100).toLocaleString('he-IL')} ש״ח, תועד ${(documentedAgorot / 100).toLocaleString('he-IL')} ש״ח, ` +
        `מתוכו ${(undocumentedAgorot / 100).toLocaleString('he-IL')} ש״ח ידוע כחסר מסמך. נשאר פער של ${(unexplainedGap / 100).toLocaleString('he-IL')} ש״ח שדורש בירור.`,
      amount_agorot: unexplainedGap,
    });
  }
  return detail;
}

/** ריצה מלאה על N חודשים אחורה. */
export function runIcountReconciliation(store, { months = 3, now } = {}) {
  const payments = store.get('payments');
  const documents = store.get('finance_documents');
  const results = monthsBack(months, now).map((month) =>
    reconcileMonth(store, { month, payments, documents, now }));
  return {
    months: results.length,
    balanced: results.filter((row) => row.status === 'balanced').length,
    gaps: results.filter((row) => row.status !== 'balanced').length,
    results,
  };
}
