/**
 * מנוע ההתאמה — FINANCE_SPEC סעיף 5. הרכיב שבו באג עולה כסף אמיתי,
 * ולכן הכול כאן טהור וכל כלל מכוסה בטסט.
 *
 * ניקוד 0–100 לכל זוג (תנועה, מסמך):
 *   סכום 40 · תאריך 25 (חלון −7/+45, דעיכה ליניארית) · ספק 25 (fuzzy מול
 *   aliases, נלמד מאישורים ידניים) · מזהים 10 (מספר מסמך בתיאור התנועה).
 * ספים: ≥90 אוטומטי · 60–89 הצעה · <60 נשאר בתיבת הנכנס.
 *
 * רבים-לרבים אמיתי: חשבונית נפרעת בכמה חיובים (הקצאה חלקית), וחיוב אחד
 * מכסה כמה חשבוניות של אותו ספק (צרור subset-sum).
 *
 * שומר הספירה הכפולה: settlement / transfer / installment_future לעולם
 * אינם מועמדים להתאמה — הם לא הוצאה.
 */

import { toAgorot } from './financeMoney.js';
import { financeId, countsTowardProfit } from './financeCore.js';
import { cleanText } from './finance.js';

export const AUTO_THRESHOLD = 90;
export const SUGGEST_THRESHOLD = 60;
const DATE_BEFORE_DAYS = 7;   // מסמך אחרי החיוב — עד שבוע
const DATE_AFTER_DAYS = 45;   // אשראי מחייב באיחור — עד 45 יום
const SMALL_GAP_AGOROT = 500; // ״עד ₪5״
const VAT_FACTOR = 1.18;

// ─── עזרי טקסט ──────────────────────────────────────────────────────────────

// 'בע' — מה שנשאר מ'בע"מ' אחרי שהניקוד מוריד את הגרשיים.
const STOP_WORDS = new Set(['בעמ', 'בע', 'ltd', 'inc', 'ישראל', 'חיוב', 'תשלום']);

function tokens(value) {
  return new Set(cleanText(value).split(/\s+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word)));
}

/** דמיון ספק 0–1 בין תיאור התנועה לשמות/כינויי הספק. */
export function supplierSimilarity(merchantRaw, supplierNames = []) {
  const merchant = tokens(merchantRaw);
  if (!merchant.size) return 0;
  let best = 0;
  for (const name of supplierNames) {
    const supplier = tokens(name);
    if (!supplier.size) continue;
    const overlap = [...supplier].filter((word) => merchant.has(word)).length;
    best = Math.max(best, overlap / Math.min(supplier.size, merchant.size));
  }
  return Math.min(1, best);
}

// ─── מסמכים ברי-התאמה ───────────────────────────────────────────────────────

/**
 * מאחד את שני מקורות המסמכים לצורת התאמה אחת: הוצאות מסונכרנות (iCount/
 * Notion, אחרי chooseExpenseRows) ומסמכים שנקלטו (שלב 2, בלי memoized —
 * מסמך שמוזג לתאום iCount כבר מיוצג בהוצאה שלו).
 */
export function matchableDocuments({ expenses = [], ingested = [], suppliers = [] } = {}) {
  const supplierById = new Map(suppliers.map((row) => [String(row.id), row]));
  const namesOf = (supplierId, fallbackName) => {
    const supplier = supplierById.get(String(supplierId || ''));
    return [supplier?.name, ...(supplier?.aliases || []), fallbackName].filter(Boolean);
  };
  const docs = [];
  for (const expense of expenses) {
    const gross = Number(expense.amount_gross);
    if (!(gross > 0) || !expense.expense_date) continue;
    docs.push({
      id: String(expense.id),
      source: 'expense',
      date: String(expense.expense_date).slice(0, 10),
      gross_agorot: toAgorot(gross),
      doc_number: String(expense.document_number || ''),
      supplier_id: expense.supplier_id || null,
      supplier_names: namesOf(expense.supplier_id, expense.supplier_name || expense.name),
    });
  }
  for (const document of ingested) {
    if (document.status === 'merged' || !(document.total_gross_agorot > 0) || !document.issue_date) continue;
    docs.push({
      id: String(document.id),
      source: 'ingested',
      date: String(document.issue_date).slice(0, 10),
      gross_agorot: document.total_gross_agorot,
      doc_number: String(document.doc_number || ''),
      supplier_id: document.supplier_id || null,
      supplier_names: namesOf(document.supplier_id, document.supplier_name),
    });
  }
  return docs;
}

// ─── ניקוד ──────────────────────────────────────────────────────────────────

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

function amountPoints(txnAgorot, remainingAgorot) {
  const amount = Math.abs(txnAgorot);
  if (!remainingAgorot) return 0;
  const gap = Math.abs(amount - remainingAgorot);
  if (gap === 0) return 40;
  if (gap <= Math.max(SMALL_GAP_AGOROT, Math.round(remainingAgorot * 0.01))) return 30;
  const net = Math.round(remainingAgorot / VAT_FACTOR);
  if (Math.abs(amount - net) <= Math.max(SMALL_GAP_AGOROT, Math.round(net * 0.01))) return 20;
  if (amount < remainingAgorot) return 12; // פירעון חלקי — הקצאה חלקית תכסה
  return 0;
}

function datePoints(docDate, txnDate) {
  const delta = daysBetween(docDate, txnDate); // חיובי: החיוב אחרי המסמך
  if (delta < -DATE_BEFORE_DAYS || delta > DATE_AFTER_DAYS) return 0;
  if (delta >= 0 && delta <= 7) return 25; // שבוע עיבוד של כרטיס — עדיין שיא
  if (delta > 7) return Math.round(25 * (DATE_AFTER_DAYS - delta) / (DATE_AFTER_DAYS - 7));
  return Math.round(25 * (DATE_BEFORE_DAYS + delta) / DATE_BEFORE_DAYS);
}

function identifierPoints(transaction, doc) {
  const description = `${transaction.raw_description || ''} ${transaction.merchant_raw || ''}`;
  const number = String(doc.doc_number || '').replace(/\D/g, '');
  if (number.length >= 4 && description.includes(number)) return 10;
  return 0;
}

/** הניקוד המלא לזוג. remaining — כמה מהמסמך עוד לא הוקצה. */
export function scoreCandidate(transaction, doc, remainingAgorot = doc.gross_agorot) {
  const breakdown = {
    amount: amountPoints(transaction.amount_agorot, remainingAgorot),
    date: datePoints(doc.date, transaction.booking_date),
    supplier: Math.round(supplierSimilarity(
      transaction.merchant_raw || transaction.raw_description,
      doc.supplier_names,
    ) * 25),
    identifiers: identifierPoints(transaction, doc),
  };
  return { score: breakdown.amount + breakdown.date + breakdown.supplier + breakdown.identifiers, breakdown };
}

// ─── צרורות: חיוב אחד שמכסה כמה מסמכים של אותו ספק ─────────────────────────

function findBundle(transaction, candidates) {
  const amount = Math.abs(transaction.amount_agorot);
  const relevant = candidates
    .filter((candidate) => candidate.remaining > 0
      && candidate.pair.breakdown.supplier >= 13
      && candidate.pair.breakdown.date > 0
      && candidate.remaining <= amount)
    .slice(0, 12);
  // subset-sum קטן: עד 6 מסמכים, פער עד ₪5.
  let best = null;
  const search = (index, chosen, sum) => {
    if (chosen.length > 6 || sum > amount + SMALL_GAP_AGOROT) return;
    if (chosen.length >= 2 && Math.abs(sum - amount) <= SMALL_GAP_AGOROT) {
      if (!best || Math.abs(sum - amount) < Math.abs(best.sum - amount)) best = { chosen: [...chosen], sum };
      return;
    }
    for (let next = index; next < relevant.length; next += 1) {
      chosen.push(relevant[next]);
      search(next + 1, chosen, sum + relevant[next].remaining);
      chosen.pop();
    }
  };
  search(0, [], 0);
  return best;
}

// ─── ההצעה עצמה ─────────────────────────────────────────────────────────────

const OPEN_MATCH_STATUSES = new Set(['proposed', 'confirmed']);

/**
 * מריץ את המנוע על כל התנועות הפתוחות. idempotent: זוג שכבר יש לו התאמה
 * פתוחה לא מוצע שוב, וההקצאות הקיימות מקטינות את היתרה של כל מסמך.
 */
export function proposeMatches({
  transactions = [],
  documents = [],
  existingMatches = [],
} = {}) {
  const open = existingMatches.filter((match) => OPEN_MATCH_STATUSES.has(match.status));
  const allocatedByDoc = new Map();
  const partiallyPaidDocs = new Set();
  const matchedTxnIds = new Set();
  const pairSeen = new Set();
  for (const match of open) {
    allocatedByDoc.set(String(match.document_id),
      (allocatedByDoc.get(String(match.document_id)) || 0) + Math.abs(match.allocated_agorot || 0));
    pairSeen.add(`${match.transaction_id}|${match.document_id}`);
    if (match.status === 'confirmed') {
      matchedTxnIds.add(String(match.transaction_id));
      partiallyPaidDocs.add(String(match.document_id));
    }
  }

  const candidatesTxns = transactions.filter((transaction) =>
    transaction.kind === 'expense'
    && countsTowardProfit(transaction.kind)
    && transaction.status !== 'voided'
    && !matchedTxnIds.has(String(transaction.id)));

  const remainingOf = (doc) => Math.max(0, doc.gross_agorot - (allocatedByDoc.get(String(doc.id)) || 0));
  const proposals = [];
  const propose = (transaction, doc, allocated, pair) => {
    const key = `${transaction.id}|${doc.id}`;
    if (pairSeen.has(key)) return;
    pairSeen.add(key);
    allocatedByDoc.set(String(doc.id), (allocatedByDoc.get(String(doc.id)) || 0) + allocated);
    proposals.push({
      id: financeId('fmt'),
      transaction_id: String(transaction.id),
      document_id: String(doc.id),
      document_source: doc.source,
      allocated_agorot: allocated,
      confidence: pair.score,
      score_breakdown: pair.breakdown,
      method: 'auto',
      status: pair.score >= AUTO_THRESHOLD ? 'confirmed' : 'proposed',
      matched_by: null,
      matched_at: pair.score >= AUTO_THRESHOLD ? new Date().toISOString() : null,
    });
  };

  for (const transaction of candidatesTxns) {
    const scored = documents
      .map((doc) => {
        const remaining = remainingOf(doc);
        const pair = scoreCandidate(transaction, doc, remaining);
        // המשכיות: מסמך שכבר נפרע חלקית + עוד חיוב מאותו ספק שנכנס ביתרה.
        // תשלום 2 ו-3 של פריסה נופלים מעבר לחלון התאריכים — זה המנגנון
        // שמחזיר אותם לשולחן, תמיד כהצעה לאישור, לא כהתאמה אוטומטית.
        if (partiallyPaidDocs.has(String(doc.id))
          && pair.breakdown.supplier >= 13
          && Math.abs(transaction.amount_agorot) <= remaining) {
          pair.breakdown.continuation = 30;
          pair.score = Math.min(AUTO_THRESHOLD - 1, pair.score + 30);
        }
        return { doc, remaining, pair };
      })
      .filter((candidate) => candidate.remaining > 0)
      .sort((a, b) => b.pair.score - a.pair.score);
    if (!scored.length) continue;

    const best = scored[0];
    if (best.pair.score >= SUGGEST_THRESHOLD) {
      const allocated = Math.min(Math.abs(transaction.amount_agorot), best.remaining);
      propose(transaction, best.doc, allocated, best.pair);
      continue;
    }
    // אין מועמד יחיד — אולי צרור של אותו ספק שסכומו בדיוק החיוב
    const bundle = findBundle(transaction, scored);
    if (bundle) {
      for (const part of bundle.chosen) {
        const pair = {
          score: Math.min(100, part.pair.score + 40 - part.pair.breakdown.amount),
          breakdown: { ...part.pair.breakdown, amount: 40, bundle: true },
        };
        propose(transaction, part.doc, part.remaining, pair);
      }
    }
  }
  return proposals;
}

// ─── למידת כינויים ──────────────────────────────────────────────────────────

/**
 * אישור ידני מלמד את המערכת: תיאור בית העסק מהתנועה נשמר כ-alias של הספק,
 * וההתאמה הבאה מולו מקבלת את נקודות הספק אוטומטית.
 */
export function learnAlias(supplier, merchantRaw) {
  const alias = String(merchantRaw || '').trim();
  if (!supplier || !alias) return { supplier, learned: false };
  const existing = [supplier.name, ...(supplier.aliases || [])].map((name) => cleanText(name));
  if (existing.includes(cleanText(alias))) return { supplier, learned: false };
  return {
    supplier: { ...supplier, aliases: [...(supplier.aliases || []), alias] },
    learned: true,
  };
}

// ─── ספירה לתיבת הנכנס ─────────────────────────────────────────────────────

/** חיובים בלי מסמך: הבסיס למונה "מע״מ אבוד" (סעיף 9.1 במפרט). */
export function unmatchedExpenseSummary({ transactions = [], matches = [], vatRate = 0.18 } = {}) {
  const confirmed = new Map();
  for (const match of matches.filter((row) => row.status === 'confirmed')) {
    confirmed.set(String(match.transaction_id),
      (confirmed.get(String(match.transaction_id)) || 0) + Math.abs(match.allocated_agorot || 0));
  }
  let count = 0;
  let totalAgorot = 0;
  for (const transaction of transactions) {
    if (transaction.kind !== 'expense' || transaction.status === 'voided') continue;
    const amount = Math.abs(transaction.amount_agorot);
    const covered = confirmed.get(String(transaction.id)) || 0;
    if (covered >= amount) continue;
    count += 1;
    totalAgorot += amount - covered;
  }
  const lostVat = Math.round(totalAgorot - totalAgorot / (1 + vatRate));
  return { count, total_agorot: totalAgorot, lost_vat_agorot: lostVat };
}
