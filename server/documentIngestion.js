/**
 * צינור קליטת מסמכים אחד לכל המקורות — העלאה ידנית, מייל, צילום מהנייד.
 * FINANCE_SPEC שלב 2: אין שלושה מסלולים, יש pipeline אחד.
 *
 * המסמכים נשמרים ב-finance_ingested_documents (לא ב-finance_documents —
 * הסנכרון מ-iCount מחליף את תוכן הטבלה ההיא והיה מוחק אותם).
 * dedupe כפול: זהות קובץ (sha256) וזהות עסקית (ח.פ+מספר+סכום) גם מול
 * הוצאות iCount — אותה חשבונית מהמייל ומ-iCount = מסמך אחד.
 */

import crypto from 'crypto';
import { toAgorot } from './financeMoney.js';
import { financeId, documentDedupeKey } from './financeCore.js';
import { extractPdfText, extractInvoiceFields } from './documentParsing.js';
import { upsertInboxItem } from './bankIngestion.js';
import { cleanText } from './finance.js';

const REVIEW_THRESHOLD = 0.6;

function supplierGuess(store, fields) {
  const suppliers = store.get('finance_suppliers');
  if (fields.supplier_tax_id) {
    const byTaxId = suppliers.find((row) => String(row.vat_id || row.tax_id || '').replace(/\D/g, '') === fields.supplier_tax_id);
    if (byTaxId) return { supplier: byTaxId, method: 'tax_id' };
  }
  const wanted = cleanText(fields.supplier_name_guess || '');
  if (!wanted) return { supplier: null, method: null };
  const byName = suppliers.find((row) => {
    const names = [row.name, ...(row.aliases || [])].map((name) => cleanText(name)).filter(Boolean);
    return names.some((name) => name && (name === wanted || wanted.includes(name) || name.includes(wanted)));
  });
  return byName ? { supplier: byName, method: 'name' } : { supplier: null, method: null };
}

/** ההוצאה המסונכרנת מ-iCount שזו אותה חשבונית שלה, אם קיימת. */
function matchingIcountExpense(store, fields) {
  if (!fields.doc_number || !fields.total_gross) return null;
  const wantedNumber = String(fields.doc_number).trim().toLowerCase();
  const wantedAgorot = toAgorot(fields.total_gross);
  return store.get('finance_expenses').find((expense) =>
    expense.source === 'icount'
    && String(expense.document_number || '').trim().toLowerCase() === wantedNumber
    && toAgorot(Number(expense.amount_gross) || 0) === wantedAgorot) || null;
}

/**
 * קליטת קובץ אחד. idempotent: אותו קובץ פעמיים = רשומה אחת.
 * מחזיר {document, created, merged_with}.
 */
export function ingestDocumentFile(store, {
  fileName = 'מסמך',
  mimeType = 'application/pdf',
  base64Data = '',
  source = 'upload',
  uploadedBy = null,
  emailMessageId = null,
  now = new Date().toISOString(),
} = {}) {
  const buffer = Buffer.from(base64Data, 'base64');
  if (!buffer.length) throw new Error('קובץ ריק');
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  const existing = store.get('finance_ingested_documents').find((row) => row.file_hash === fileHash);
  if (existing) return { document: existing, created: false, merged_with: existing.matched_expense_id || null };

  const { text, method } = mimeType === 'application/pdf'
    ? extractPdfText(buffer)
    : { text: '', method: 'image' }; // OCR — חסם B4
  const fields = extractInvoiceFields(text);
  const { supplier, method: supplierMethod } = supplierGuess(store, fields);
  const icountTwin = matchingIcountExpense(store, fields);

  const needsReview = fields.confidence < REVIEW_THRESHOLD;
  const document = store.insert('finance_ingested_documents', {
    id: financeId('fdoc'),
    source,
    file_name: fileName,
    mime_type: mimeType,
    file_hash: fileHash,
    data: `data:${mimeType};base64,${base64Data}`,
    email_message_id: emailMessageId,
    extraction_method: method,
    supplier_id: supplier?.id || null,
    supplier_match_method: supplierMethod,
    supplier_name: supplier?.name || fields.supplier_name_guess || '',
    supplier_tax_id: fields.supplier_tax_id,
    doc_number: fields.doc_number,
    allocation_number: fields.allocation_number,
    issue_date: fields.issue_date,
    total_gross_agorot: fields.total_gross != null ? toAgorot(fields.total_gross) : null,
    vat_agorot: fields.vat_amount != null ? toAgorot(fields.vat_amount) : null,
    confidence: fields.confidence,
    dedupe_key: documentDedupeKey({
      supplierTaxId: fields.supplier_tax_id || '',
      docNumber: fields.doc_number || '',
      grossAgorot: fields.total_gross != null ? toAgorot(fields.total_gross) : 0,
    }),
    matched_expense_id: icountTwin?.id || null,
    status: icountTwin ? 'merged' : (needsReview ? 'needs_review' : 'parsed'),
    uploaded_by: uploadedBy,
    created_at: now,
  });

  if (!supplier && (fields.supplier_name_guess || fields.supplier_tax_id) && !icountTwin) {
    upsertInboxItem(store, {
      item_type: 'new_supplier',
      ref_table: 'finance_ingested_documents',
      ref_id: document.id,
      title: `ספק חדש לזיהוי: ${fields.supplier_name_guess || fields.supplier_tax_id}`,
      detail: 'המסמך נקלט אבל הספק אינו מוכר. הגדרה חד-פעמית תלמד את המערכת לזהות אותו בפעם הבאה.',
    });
  }
  if (needsReview && !icountTwin) {
    upsertInboxItem(store, {
      item_type: 'uncategorized_expense',
      ref_table: 'finance_ingested_documents',
      ref_id: document.id,
      title: `מסמך שנקלט חלקית: ${fileName}`,
      detail: method === 'image'
        ? 'קובץ תמונה בלי שכבת טקסט — נדרש שיוך ידני (OCR עדיין לא מחובר).'
        : `זוהו רק חלק מהשדות (ביטחון ${Math.round(fields.confidence * 100)}%). צריך השלמה ידנית.`,
    });
  }
  return { document, created: true, merged_with: icountTwin?.id || null };
}
