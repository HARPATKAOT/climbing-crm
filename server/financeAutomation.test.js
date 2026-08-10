import test from 'node:test';
import assert from 'node:assert/strict';
import { matchExpenseTransactions, parseFinanceCsv, scoreExpenseTransaction } from './financeAutomation.js';

test('parseFinanceCsv reads Hebrew bank export and deduplicates with stable IDs', () => {
  const csv = '\uFEFFתאריך,בית עסק,סכום חיוב,אסמכתא\n08/08/2026,ארנונה ירושלים,"1,240.50",abc';
  const first = parseFinanceCsv(csv, { provider: 'visa', account_type: 'credit_card', account_last4: '1234' });
  const second = parseFinanceCsv(csv, { provider: 'visa', account_type: 'credit_card', account_last4: '1234' });
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].amount, 1240.5);
  assert.equal(first.rows[0].transaction_date, '2026-08-08');
  assert.equal(first.rows[0].id, second.rows[0].id);
});

test('matching requires exact amount, nearby date and supplier evidence for auto match', () => {
  const expense = { id: 'e1', expense_date: '2026-08-08', amount_gross: 1240.5, supplier_name: 'עיריית ירושלים', name: 'ארנונה' };
  const transaction = { id: 't1', transaction_date: '2026-08-09', amount: 1240.5, description: 'עיריית ירושלים ארנונה' };
  const scored = scoreExpenseTransaction(expense, transaction);
  assert.ok(scored.score >= 85);
  assert.equal(matchExpenseTransactions([expense], [transaction])[0].status, 'matched');
});

test('ambiguous equal candidates stay in review', () => {
  const expense = { id: 'e1', expense_date: '2026-08-08', amount_gross: 100, supplier_name: 'ספק' };
  const transactions = [
    { id: 't1', transaction_date: '2026-08-08', amount: 100, description: 'ספק' },
    { id: 't2', transaction_date: '2026-08-08', amount: 100, description: 'ספק' },
  ];
  assert.equal(matchExpenseTransactions([expense], transactions)[0].status, 'review');
});
