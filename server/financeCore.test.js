process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toAgorot,
  toShekels,
  splitGrossAgorot,
  sumAgorot,
  assertAgorot,
} from './financeMoney.js';
import {
  FINANCE_CENTER_TABLES,
  financeFlag,
  icountRealDocsAllowed,
  transactionDedupeHash,
  documentDedupeKey,
  classifyTransactionKind,
  countsTowardProfit,
  financeId,
} from './financeCore.js';
import { OPERATIONAL_TABLES } from './supa.js';

test('toAgorot converts shekel floats without drift', () => {
  assert.equal(toAgorot(979), 97900);
  assert.equal(toAgorot(105744.5), 10574450);
  // הקלאסיקה של float: 0.1+0.2. באגורות זה חייב להישאר 30.
  assert.equal(toAgorot(0.1 + 0.2), 30);
  assert.equal(toShekels(97900), 979);
  assert.throws(() => toAgorot('לא מספר'));
});

test('splitGrossAgorot: net plus vat always equals gross', () => {
  for (const gross of [11800, 10000, 97900, 1, 3, 999999997]) {
    const { net, vat } = splitGrossAgorot(gross);
    assert.equal(net + vat, gross, `gross=${gross}`);
  }
  const { net, vat } = splitGrossAgorot(11800);
  assert.equal(net, 10000);
  assert.equal(vat, 1800);
});

test('sumAgorot rejects a float that sneaked in', () => {
  assert.equal(sumAgorot([100, 200, -50]), 250);
  assert.throws(() => sumAgorot([100, 10.5]));
  assert.throws(() => assertAgorot(1.01));
});

test('every finance table is registered as durable in supa.js', () => {
  for (const table of FINANCE_CENTER_TABLES) {
    assert.ok(OPERATIONAL_TABLES.includes(table), `${table} חסרה ב-OPERATIONAL_TABLES — כתיבות יאבדו בשקט`);
  }
});

test('dedupe hash is stable and order-independent of noise', () => {
  const base = {
    provider: 'max',
    accountKey: '1234',
    bookingDate: '2026-08-10',
    amountAgorot: -45000,
    description: 'סופר יודה  בעמ',
    externalId: 'tx-9',
  };
  const a = transactionDedupeHash(base);
  const b = transactionDedupeHash({ ...base, description: 'סופר יודה בעמ ' });
  assert.equal(a, b, 'רווחים כפולים לא אמורים לשנות זהות');
  const c = transactionDedupeHash({ ...base, amountAgorot: -45001 });
  assert.notEqual(a, c);
});

test('document dedupe key: same invoice from icount and email collapses', () => {
  const fromIcount = documentDedupeKey({ supplierTaxId: '514234567', docNumber: 'INV-88', grossAgorot: 35400 });
  const fromEmail = documentDedupeKey({ supplierTaxId: '51-4234567', docNumber: 'inv-88', grossAgorot: 35400 });
  assert.equal(fromIcount, fromEmail);
  assert.equal(documentDedupeKey({ supplierTaxId: '5', docNumber: '', grossAgorot: 1 }), '');
});

test('credit-card settlement in the bank is never an expense', () => {
  const kind = classifyTransactionKind({
    description: 'מקס איט פיננסים',
    amountAgorot: -1234500,
    accountType: 'bank',
  });
  assert.equal(kind, 'settlement');
  assert.equal(countsTowardProfit(kind), false);
});

test('the same merchant name on the card itself stays an expense', () => {
  const kind = classifyTransactionKind({
    description: 'חנות מקס ספורט',
    amountAgorot: -12000,
    accountType: 'credit_card',
  });
  assert.equal(kind, 'expense');
  assert.equal(countsTowardProfit(kind), true);
});

test('clearing deposit, self transfer and atm are cash-flow only', () => {
  assert.equal(classifyTransactionKind({
    description: 'זיכוי מ-iCount סליקה', amountAgorot: 500000, accountType: 'bank',
  }), 'settlement');
  assert.equal(classifyTransactionKind({
    description: 'הפקדת מזומן בסניף', amountAgorot: 320000, accountType: 'bank',
  }), 'transfer');
  assert.equal(classifyTransactionKind({
    description: 'עמלת דמי ניהול', amountAgorot: -2500, accountType: 'bank',
  }), 'fee');
  assert.equal(countsTowardProfit('transfer'), false);
  assert.equal(countsTowardProfit('settlement'), false);
});

test('feature flags: env kill switch wins, unknown flag throws', () => {
  process.env.FINANCE_FLAG_LEDGER = '0';
  try {
    assert.equal(financeFlag('ledger'), false);
  } finally {
    delete process.env.FINANCE_FLAG_LEDGER;
  }
  process.env.FINANCE_FLAG_LEDGER = '1';
  try {
    assert.equal(financeFlag('ledger'), true);
  } finally {
    delete process.env.FINANCE_FLAG_LEDGER;
  }
  assert.throws(() => financeFlag('no_such_flag'));
});

test('real iCount documents are blocked outside production', () => {
  const previousEnv = process.env.NODE_ENV;
  const previousOverride = process.env.ICOUNT_ALLOW_REAL_DOCS;
  try {
    delete process.env.ICOUNT_ALLOW_REAL_DOCS;
    process.env.NODE_ENV = 'development';
    assert.equal(icountRealDocsAllowed(), false);
    process.env.NODE_ENV = 'production';
    assert.equal(icountRealDocsAllowed(), true);
  } finally {
    process.env.NODE_ENV = previousEnv;
    if (previousOverride === undefined) delete process.env.ICOUNT_ALLOW_REAL_DOCS;
    else process.env.ICOUNT_ALLOW_REAL_DOCS = previousOverride;
  }
});

test('financeId is unique across a burst', () => {
  const ids = new Set(Array.from({ length: 200 }, () => financeId('ftx')));
  assert.equal(ids.size, 200);
});
