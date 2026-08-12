import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentPurchaseRows } from './equipmentPurchases.js';

const paidShoes = {
  id: 'pay1',
  parent_id: 'pr1',
  student_id: 'sn1',
  amount: 150,
  status: 'paid',
  description: 'נעלי טיפוס',
  equipment_payment: true,
  created_at: '2026-08-12T09:00:00Z',
  icount_doc_number: '4021',
};

test('תשלום ציוד ששולם מופיע כרכישה בכרטיס התלמיד', () => {
  const rows = equipmentPurchaseRows({ payments: [paidShoes], studentId: 'sn1' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'paid');
  assert.equal(rows[0].total, 150);
  assert.equal(rows[0].items[0].description, 'נעלי טיפוס');
  assert.equal(rows[0].source, 'equipment_payment');
  assert.equal(rows[0].payment_id, 'pay1');
});

test('תשלום של ההורה נספר גם בכרטיס שנפתח לפי ההורה', () => {
  const rows = equipmentPurchaseRows({ payments: [paidShoes], parentId: 'pr1' });
  assert.equal(rows.length, 1);
});

test('תלמיד אחר במשפחה אחרת לא רואה את הרכישה', () => {
  assert.equal(equipmentPurchaseRows({ payments: [paidShoes], studentId: 'sn2' }).length, 0);
  assert.equal(equipmentPurchaseRows({ payments: [paidShoes], parentId: 'pr2' }).length, 0);
});

test('בלי תלמיד ובלי הורה אין שורות — מסך הקופה לא מושפע', () => {
  assert.deepEqual(equipmentPurchaseRows({ payments: [paidShoes] }), []);
});

test('תשלום שכבר תלוי במכירה לא נספר פעמיים', () => {
  const rows = equipmentPurchaseRows({
    payments: [{ ...paidShoes, pos_sale_id: 'ps1' }],
    studentId: 'sn1',
  });
  assert.equal(rows.length, 0);
});

test('חיוב שאינו ציוד נשאר מחוץ לתיק הרכישות', () => {
  const rows = equipmentPurchaseRows({
    payments: [{ id: 'pay2', student_id: 'sn1', amount: 400, status: 'paid' }],
    studentId: 'sn1',
  });
  assert.equal(rows.length, 0);
});

test('שדרוג נעליים הוא רכישת ציוד לכל דבר', () => {
  const rows = equipmentPurchaseRows({
    payments: [
      {
        id: 'pay3',
        student_id: 'sn1',
        amount: 60,
        status: 'pending',
        description: 'שדרוג נעליים',
        equipment_shoes_upgrade: true,
        payment_url: 'https://pay/3',
      },
    ],
    studentId: 'sn1',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].payment_url, 'https://pay/3');
});

test('סטטוס שאינו מוכר נקרא כממתין לתשלום, לא כמשהו אחר', () => {
  const rows = equipmentPurchaseRows({
    payments: [{ ...paidShoes, status: 'created' }],
    studentId: 'sn1',
  });
  assert.equal(rows[0].status, 'pending');
});
