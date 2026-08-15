process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCandidate,
  proposeMatches,
  matchableDocuments,
  learnAlias,
  supplierSimilarity,
  unmatchedExpenseSummary,
  AUTO_THRESHOLD,
  SUGGEST_THRESHOLD,
} from './matchingEngine.js';

const txn = (over = {}) => ({
  id: over.id ?? 't1',
  kind: over.kind ?? 'expense',
  status: over.status ?? 'new',
  booking_date: over.booking_date ?? '2026-08-05',
  amount_agorot: over.amount_agorot ?? -35400,
  raw_description: over.raw_description ?? 'קליימב ציוד טיפוס',
  merchant_raw: over.merchant_raw ?? over.raw_description ?? 'קליימב ציוד טיפוס',
});

const doc = (over = {}) => ({
  id: over.id ?? 'd1',
  source: 'expense',
  date: over.date ?? '2026-08-01',
  gross_agorot: over.gross_agorot ?? 35400,
  doc_number: over.doc_number ?? '4478',
  supplier_id: over.supplier_id ?? 'sup1',
  supplier_names: over.supplier_names ?? ['קליימב ציוד טיפוס בע"מ'],
});

test('perfect pair scores above the auto threshold', () => {
  const { score, breakdown } = scoreCandidate(txn({ raw_description: 'קליימב ציוד טיפוס 4478' }), doc());
  assert.equal(breakdown.amount, 40);
  assert.equal(breakdown.date, 25);
  assert.ok(breakdown.supplier >= 20);
  assert.equal(breakdown.identifiers, 10);
  assert.ok(score >= AUTO_THRESHOLD);
});

test('amount scoring: exact, small gap, vat gap, partial, none', () => {
  const base = txn();
  assert.equal(scoreCandidate(base, doc()).breakdown.amount, 40);
  assert.equal(scoreCandidate(txn({ amount_agorot: -35700 }), doc()).breakdown.amount, 30); // ₪3 פער
  assert.equal(scoreCandidate(txn({ amount_agorot: -30000 }), doc()).breakdown.amount, 20); // הנטו של 354
  assert.equal(scoreCandidate(txn({ amount_agorot: -10000 }), doc()).breakdown.amount, 12); // חלקי
  assert.equal(scoreCandidate(txn({ amount_agorot: -99900 }), doc()).breakdown.amount, 0);
});

test('date window: linear decay, dead outside -7/+45', () => {
  assert.equal(scoreCandidate(txn({ booking_date: '2026-08-02' }), doc()).breakdown.date, 25);
  const decayed = scoreCandidate(txn({ booking_date: '2026-09-05' }), doc()).breakdown.date;
  assert.ok(decayed > 0 && decayed < 25, `decay: ${decayed}`);
  assert.equal(scoreCandidate(txn({ booking_date: '2026-09-30' }), doc()).breakdown.date, 0); // +60
  assert.equal(scoreCandidate(txn({ booking_date: '2026-07-20' }), doc()).breakdown.date, 0); // -12
});

test('supplier similarity uses aliases and survives legal-suffix noise', () => {
  assert.ok(supplierSimilarity('קליימב ציוד', ['קליימב ציוד טיפוס בע"מ']) >= 0.5);
  assert.equal(supplierSimilarity('משהו אחר לגמרי', ['קליימב ציוד']), 0);
  assert.ok(supplierSimilarity('PAZ GAS STATION', ['פז', 'PAZ GAS']) >= 0.5);
});

test('a 60-89 pair becomes a proposal, not an auto match', () => {
  const proposals = proposeMatches({
    transactions: [txn({ raw_description: 'קליימב ציוד', booking_date: '2026-08-20' })],
    documents: [doc({ doc_number: '' })],
  });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].status, 'proposed');
  assert.ok(proposals[0].confidence >= SUGGEST_THRESHOLD && proposals[0].confidence < AUTO_THRESHOLD,
    `score: ${proposals[0].confidence}`);
});

test('guard: settlement and transfer transactions are never matched', () => {
  const proposals = proposeMatches({
    transactions: [
      txn({ id: 's1', kind: 'settlement' }),
      txn({ id: 's2', kind: 'transfer' }),
      txn({ id: 's3', kind: 'installment_future' }),
    ],
    documents: [doc()],
  });
  assert.equal(proposals.length, 0);
});

test('one invoice paid in three charges: partial allocations never exceed the gross', () => {
  const bigDoc = doc({ gross_agorot: 90000, doc_number: '' });
  const charges = [
    txn({ id: 'c1', amount_agorot: -30000, booking_date: '2026-08-03', raw_description: 'קליימב ציוד טיפוס' }),
    txn({ id: 'c2', amount_agorot: -30000, booking_date: '2026-09-03', raw_description: 'קליימב ציוד טיפוס' }),
    txn({ id: 'c3', amount_agorot: -30000, booking_date: '2026-09-10', raw_description: 'קליימב ציוד טיפוס' }),
  ];
  let matches = [];
  for (const charge of charges) {
    const proposals = proposeMatches({
      transactions: [charge],
      documents: [bigDoc],
      existingMatches: matches,
    });
    // מאשרים את ההצעה כדי שההקצאה תיספר בריצה הבאה
    matches = [...matches, ...proposals.map((row) => ({ ...row, status: 'confirmed' }))];
  }
  const allocated = matches.reduce((sum, row) => sum + row.allocated_agorot, 0);
  assert.equal(matches.length, 3);
  assert.equal(allocated, 90000);
  // מסמך שמוצה — אין הצעה רביעית
  const extra = proposeMatches({
    transactions: [txn({ id: 'c4', amount_agorot: -30000, booking_date: '2026-09-12' })],
    documents: [bigDoc],
    existingMatches: matches,
  });
  assert.equal(extra.length, 0);
});

test('one charge covering five invoices of the same supplier: bundle subset-sum', () => {
  const invoices = [1, 2, 3, 4, 5].map((index) => doc({
    id: `d${index}`,
    gross_agorot: index * 10000,
    date: '2026-08-01',
    doc_number: `900${index}`,
  }));
  const charge = txn({ amount_agorot: -150000, booking_date: '2026-08-10' });
  const proposals = proposeMatches({ transactions: [charge], documents: invoices });
  assert.ok(proposals.length >= 2, 'צרור חייב לפחות שני מסמכים');
  const total = proposals.reduce((sum, row) => sum + row.allocated_agorot, 0);
  assert.equal(total, 150000);
  assert.ok(proposals.every((row) => row.score_breakdown.bundle === true));
});

test('running the engine twice never duplicates a proposal', () => {
  const first = proposeMatches({ transactions: [txn()], documents: [doc()] });
  const second = proposeMatches({ transactions: [txn()], documents: [doc()], existingMatches: first });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);
});

test('manual confirmation learns the merchant as a supplier alias', () => {
  const supplier = { id: 'sup1', name: 'פז חברת נפט', aliases: [] };
  const { supplier: updated, learned } = learnAlias(supplier, 'PAZ YELLOW TLV');
  assert.equal(learned, true);
  assert.deepEqual(updated.aliases, ['PAZ YELLOW TLV']);
  // הלמידה משפיעה מיד על הניקוד
  const before = supplierSimilarity('PAZ YELLOW TLV', ['פז חברת נפט']);
  const after = supplierSimilarity('PAZ YELLOW TLV', [updated.name, ...updated.aliases]);
  assert.ok(after > before);
  // אותו alias פעמיים — לא נלמד שוב
  assert.equal(learnAlias(updated, 'paz yellow tlv').learned, false);
});

test('matchableDocuments merges both sources and skips merged ingested docs', () => {
  const docs = matchableDocuments({
    expenses: [{ id: 'icount:1', amount_gross: 354, expense_date: '2026-08-01', supplier_name: 'פז', document_number: '1' }],
    ingested: [
      { id: 'fdoc1', total_gross_agorot: 20000, issue_date: '2026-08-02', supplier_name: 'ספק', status: 'parsed' },
      { id: 'fdoc2', total_gross_agorot: 30000, issue_date: '2026-08-03', supplier_name: 'ספק', status: 'merged' },
    ],
    suppliers: [],
  });
  assert.deepEqual(docs.map((row) => row.id), ['icount:1', 'fdoc1']);
  assert.equal(docs[0].gross_agorot, 35400);
});

test('unmatched expenses report the lost VAT in agorot', () => {
  const summary = unmatchedExpenseSummary({
    transactions: [
      txn({ id: 'u1', amount_agorot: -11800 }),
      txn({ id: 'u2', amount_agorot: -23600 }),
      txn({ id: 'u3', kind: 'settlement', amount_agorot: -99999 }),
    ],
    matches: [{ transaction_id: 'u2', allocated_agorot: 23600, status: 'confirmed' }],
  });
  assert.equal(summary.count, 1);
  assert.equal(summary.total_agorot, 11800);
  assert.equal(summary.lost_vat_agorot, 1800);
});
