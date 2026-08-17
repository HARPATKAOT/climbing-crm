import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adoptEmvCharge,
  chargeEmvForSale,
  emvFailureMessage,
  enrichEmvCharge,
  isUnlinkedCharge,
  listOrphanEmvCharges,
} from './emvCharge.js';

const charge = (over = {}) => ({
  ccBillLogId: '9001',
  confirmationCode: '123456',
  charged: 120,
  cardLast4: '4398',
  cardType: 'VISA',
  holderName: 'לקוח',
  numOfPayments: 1,
  chargeDate: '2026-08-17',
  docnumber: null,
  alreadyRefunded: false,
  ...over,
});

test('חיוב רגיל נשלח למסוף ומוחזר עם פרטי הכרטיס', async () => {
  const calls = [];
  const icount = {
    async chargeEmv(args) {
      calls.push(args);
      return { confirmationCode: '123456', cardType: null, cardLast4: null, ccBillLogId: null };
    },
    async findCcChargeByConfirmation() {
      return charge();
    },
  };

  const result = await chargeEmvForSale({ icount, total: 120, clientId: '55' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sum, 120);
  assert.equal(calls[0].clientId, '55');
  assert.equal(result.confirmationCode, '123456');
  // מזהה החיוב וארבע הספרות מגיעים מיומן החיובים, ובלעדיהם אין זיכוי חלקי בהמשך.
  assert.equal(result.ccBillLogId, '9001');
  assert.equal(result.cardLast4, '4398');
  assert.equal(result.adopted, false);
});

test('כישלון בהשלמת פרטי הכרטיס אינו מפיל את המכירה — הכסף כבר נגבה', async () => {
  const icount = {
    async chargeEmv() {
      return { confirmationCode: '777', cardType: 'MASTERCARD', cardLast4: null, ccBillLogId: null };
    },
    async findCcChargeByConfirmation() {
      throw new Error('iCount לא זמין');
    },
  };

  const result = await chargeEmvForSale({ icount, total: 50 });
  assert.equal(result.confirmationCode, '777');
  assert.equal(result.cardLast4, null);
});

test('מספר אישור קיים משלים מכירה ואינו שולח חיוב חדש למסוף', async () => {
  let charged = 0;
  const icount = {
    async chargeEmv() { charged += 1; return {}; },
    async findCcChargeByConfirmation() { return charge(); },
  };

  const result = await chargeEmvForSale({
    icount,
    total: 120,
    confirmationCode: '123456',
  });

  assert.equal(charged, 0, 'אימוץ חיוב קיים חייב לא לחייב שוב');
  assert.equal(result.adopted, true);
  assert.equal(result.ccBillLogId, '9001');
});

test('אימוץ נדחה כשהסכום, הזיכוי או המסמך אינם מתאימים', async () => {
  const withRow = (row) => ({ async findCcChargeByConfirmation() { return row; } });

  await assert.rejects(
    () => adoptEmvCharge({ icount: withRow(null), confirmationCode: '1', total: 10 }),
    (err) => err.code === 'charge_not_found'
  );
  await assert.rejects(
    () => adoptEmvCharge({ icount: withRow(charge({ alreadyRefunded: true })), confirmationCode: '123456', total: 120 }),
    (err) => err.code === 'already_refunded'
  );
  await assert.rejects(
    () => adoptEmvCharge({ icount: withRow(charge({ docnumber: '4200' })), confirmationCode: '123456', total: 120 }),
    (err) => err.code === 'already_documented'
  );
  await assert.rejects(
    () => adoptEmvCharge({ icount: withRow(charge()), confirmationCode: '123456', total: 90 }),
    (err) => err.code === 'amount_mismatch'
  );
  // הפרשי עיגול של אגורה אינם אי-התאמה.
  const ok = await adoptEmvCharge({
    icount: withRow(charge({ charged: 120.004 })),
    confirmationCode: '123456',
    total: 120,
  });
  assert.equal(ok.adopted, true);
});

test('סכום אפס נדחה לפני שהמסוף נדלק', async () => {
  let charged = 0;
  const icount = { async chargeEmv() { charged += 1; return {}; } };
  await assert.rejects(
    () => chargeEmvForSale({ icount, total: 0 }),
    (err) => err.code === 'bad_sum' && err.indeterminate === false
  );
  assert.equal(charged, 0);
});

test('רשימת חיובים ללא מסמך מסננת לפי סכום, זיכוי ומסמך קיים', async () => {
  const icount = {
    async listCcCharges() {
      return [
        charge({ confirmationCode: 'a', charged: 120 }),
        charge({ confirmationCode: 'b', charged: 120, docnumber: '4200' }),
        charge({ confirmationCode: 'c', charged: 120, alreadyRefunded: true }),
        charge({ confirmationCode: 'd', charged: 80 }),
      ];
    },
  };
  const rows = await listOrphanEmvCharges({ icount, amount: 120 });
  assert.deepEqual(rows.map((r) => r.confirmationCode), ['a']);

  const all = await listOrphanEmvCharges({ icount });
  assert.deepEqual(all.map((r) => r.confirmationCode), ['a', 'd']);
});

test('יום בלי חיובים אינו שגיאה', async () => {
  const icount = {
    async listCcCharges() { throw new Error('אין תוצאות'); },
  };
  assert.deepEqual(await listOrphanEmvCharges({ icount, amount: 10 }), []);
});

test('הודעת כישלון מבחינה בין „לא חויב” לבין „לא ידוע”', () => {
  const unknown = emvFailureMessage({ indeterminate: true, message: 'timeout' });
  assert.match(unknown, /אל תחייבו שוב/);
  const declined = emvFailureMessage({ indeterminate: false, message: 'כרטיס נדחה' });
  assert.match(declined, /כרטיס נדחה/);
  assert.doesNotMatch(declined, /אל תחייבו שוב/);
});

test('חיוב שכבר יש עליו מסמך אינו נחשב יתום', () => {
  assert.equal(isUnlinkedCharge(charge()), true);
  assert.equal(isUnlinkedCharge(charge({ docnumber: '1' })), false);
  assert.equal(isUnlinkedCharge(charge({ alreadyRefunded: true })), false);
  assert.equal(isUnlinkedCharge(null), false);
});

test('פרטים שכבר קיימים אינם גוררים קריאה נוספת ליומן החיובים', async () => {
  let looked = 0;
  const icount = {
    async findCcChargeByConfirmation() { looked += 1; return charge(); },
  };
  const full = { confirmationCode: '1', ccBillLogId: '5', cardLast4: '1111' };
  assert.deepEqual(await enrichEmvCharge({ icount, charge: full }), full);
  assert.equal(looked, 0);
});
