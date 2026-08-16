process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPdfText, extractInvoiceFields, findInvoiceLinks } from './documentParsing.js';
import { ingestDocumentFile } from './documentIngestion.js';
import { createMockEmailProvider, runEmailIngestion } from './emailIngestion.js';

process.env.FINANCE_FLAG_DOC_INGESTION = '1';

function makeStore(seed = {}) {
  const tables = { ...seed };
  return {
    tables,
    get: (table) => tables[table] || [],
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      tables[table].push(record);
      return record;
    },
    update: (table, id, record) => {
      const list = tables[table] || [];
      const index = list.findIndex((row) => String(row.id) === String(id));
      if (index >= 0) list[index] = record;
      return record;
    },
  };
}

function buildPdf(streams) {
  const parts = ['%PDF-1.4\n'];
  streams.forEach((content, index) => {
    parts.push(`${index + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });
  parts.push('%%EOF');
  return Buffer.from(parts.join(''), 'latin1');
}

test('pdf text layer: literal strings and TJ arrays are extracted', () => {
  const pdf = buildPdf([
    'BT (Climb Supplies Ltd) Tj ET',
    'BT (Invoice No. INV-123) Tj [(Date 10/08/2026) (Total 354.00)] TJ (VAT 54.00) Tj (Tax ID 514234567) Tj ET',
  ]);
  const { text, method } = extractPdfText(pdf);
  assert.equal(method, 'text_layer');
  for (const expected of ['Climb Supplies Ltd', 'INV-123', '10/08/2026', '354.00', '514234567']) {
    assert.ok(text.includes(expected), `חסר בטקסט: ${expected}`);
  }
});

test('pdf hebrew: ToUnicode map decodes CID hex strings and restores order', () => {
  const cmap = 'begincmap beginbfchar <0001> <05D7> <0002> <05E9> endbfchar endcmap';
  const pdf = buildPdf([cmap, 'BT <00020001> Tj ET']);
  const { text } = extractPdfText(pdf);
  assert.ok(text.includes('חש'), `העברית לא פוענחה: "${text}"`);
});

test('extractPdfText refuses a non-pdf quietly', () => {
  assert.equal(extractPdfText(Buffer.from('hello')).method, 'not_pdf');
});

test('hebrew invoice fields are all extracted with high confidence', () => {
  const text = [
    'קליימב ציוד טיפוס בע״מ',
    'חשבונית מס 4478',
    'ח.פ 514234567',
    'מספר הקצאה 123456789',
    'תאריך 10.08.2026',
    'סה"כ לתשלום 354.00 ₪',
    'מע"מ 54.00',
  ].join('\n');
  const fields = extractInvoiceFields(text);
  assert.equal(fields.doc_number, '4478');
  assert.equal(fields.supplier_tax_id, '514234567');
  assert.equal(fields.allocation_number, '123456789');
  assert.equal(fields.issue_date, '2026-08-10');
  assert.equal(fields.total_gross, 354);
  assert.equal(fields.vat_amount, 54);
  assert.equal(fields.supplier_name_guess, 'קליימב ציוד טיפוס בע״מ');
  assert.ok(fields.confidence >= 0.9, `confidence נמוך: ${fields.confidence}`);
});

test('empty text yields zero confidence, never a guess', () => {
  const fields = extractInvoiceFields('');
  assert.equal(fields.total_gross, null);
  assert.equal(fields.confidence, 0);
});

test('invoice links: only known billing domains pass', () => {
  const body = [
    'החשבונית שלך: https://app.icount.co.il/docs/abc123',
    'קידום: https://spam.example.com/invoice.pdf',
    'https://www.greeninvoice.co.il/d/xyz',
  ].join('\n');
  assert.deepEqual(findInvoiceLinks(body), [
    'https://app.icount.co.il/docs/abc123',
    'https://www.greeninvoice.co.il/d/xyz',
  ]);
});

const invoicePdfBase64 = buildPdf([
  'BT (Climb Supplies Ltd) Tj ET',
  'BT (Invoice No. INV-123) Tj (Date 10/08/2026) Tj (Total 354.00) Tj (VAT 54.00) Tj (Tax ID 514234567) Tj ET',
]).toString('base64');

test('ingesting the same file twice keeps one document', () => {
  const store = makeStore();
  const first = ingestDocumentFile(store, { fileName: 'inv.pdf', base64Data: invoicePdfBase64 });
  const second = ingestDocumentFile(store, { fileName: 'inv-copy.pdf', base64Data: invoicePdfBase64 });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(store.get('finance_ingested_documents').length, 1);
});

test('the same invoice already synced from iCount merges instead of duplicating', () => {
  const store = makeStore({
    finance_expenses: [{
      id: 'icount:900', source: 'icount', document_number: 'INV-123', amount_gross: 354,
    }],
  });
  const result = ingestDocumentFile(store, { fileName: 'inv.pdf', base64Data: invoicePdfBase64 });
  assert.equal(result.merged_with, 'icount:900');
  assert.equal(result.document.status, 'merged');
  // מסמך שמוזג לא מייצר רעש בתיבת הנכנס
  assert.equal(store.get('finance_inbox_items').length, 0);
});

test('an unknown supplier raises a new_supplier inbox item; a known one does not', () => {
  const unknown = makeStore();
  ingestDocumentFile(unknown, { fileName: 'inv.pdf', base64Data: invoicePdfBase64 });
  assert.ok(unknown.get('finance_inbox_items').some((row) => row.item_type === 'new_supplier'));

  const known = makeStore({
    finance_suppliers: [{ id: 'sup1', name: 'Climb Supplies Ltd', vat_id: '514234567' }],
  });
  const result = ingestDocumentFile(known, { fileName: 'inv.pdf', base64Data: invoicePdfBase64 });
  assert.equal(result.document.supplier_id, 'sup1');
  assert.equal(result.document.supplier_match_method, 'tax_id');
  assert.ok(!known.get('finance_inbox_items').some((row) => row.item_type === 'new_supplier'));
});

test('an image without text lands in review with an inbox item', () => {
  const store = makeStore();
  const result = ingestDocumentFile(store, {
    fileName: 'scan.jpg',
    mimeType: 'image/jpeg',
    base64Data: Buffer.from('fake-image').toString('base64'),
  });
  assert.equal(result.document.status, 'needs_review');
  assert.equal(result.document.confidence, 0);
  const item = store.get('finance_inbox_items').find((row) => row.item_type === 'uncategorized_expense');
  assert.match(item.detail, /OCR/);
});

test('email ingestion is idempotent per message and downloads known links', async () => {
  const store = makeStore();
  const provider = createMockEmailProvider([{
    id: 'msg1',
    bodyText: 'מצורפת חשבונית. עותק: https://app.icount.co.il/doc/1',
    attachments: [{ fileName: 'inv.pdf', mimeType: 'application/pdf', base64Data: invoicePdfBase64 }],
  }]);
  const linkPdf = buildPdf(['BT (Linked Invoice 777) Tj (Total 100.00) Tj ET']).toString('base64');
  const downloadLink = async () => linkPdf;

  const first = await runEmailIngestion(store, { provider, downloadLink });
  assert.equal(first.ingested, 2); // הקובץ המצורף + הקישור
  assert.equal(first.link_downloads, 1);
  const second = await runEmailIngestion(store, { provider, downloadLink });
  assert.equal(second.ingested, 0);
  assert.equal(second.duplicates, 1); // ההודעה כולה מדולגת
  assert.equal(store.get('finance_ingested_documents').length, 2);
});

test('a provider auth failure becomes an inbox item, not a crash', async () => {
  const store = makeStore();
  const failing = {
    key: 'gmail',
    async listInvoiceMessages() {
      const error = new Error('token expired');
      error.code = 'auth_required';
      throw error;
    },
  };
  const summary = await runEmailIngestion(store, { provider: failing });
  assert.equal(summary.error, 'token expired');
  assert.ok(store.get('finance_inbox_items').some((row) => row.item_type === 'auth_required'));
});
