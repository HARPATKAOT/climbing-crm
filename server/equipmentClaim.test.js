import test from 'node:test';
import assert from 'node:assert/strict';
import { unbackedReplyClaims } from './botToolTurn.js';

const OPEN = [{
  name: 'getEquipmentPaymentLink',
  result: {
    מתאמן: 'ארבל שפירא',
    פריטים: 'שק מגנזיום ומגנזיום',
    קישור: 'https://app.kirboaz.co.il/api/e/tok1',
  },
}];

const SETTLED = [{
  name: 'getEquipmentPaymentLink',
  result: { קישור: '', הערה: 'אין ציוד שטרם שולם עבור ארבל שפירא' },
}];

test('„הכול מעודכן” ליד פריט שלא הוסדר אינו נשלח', () => {
  // ארבל: נעליים וחולצה שולמו, המגנזיום לא — והבוט אמר שהכול מסודר.
  assert.deepEqual(
    unbackedReplyClaims('מעולה! הכול מעודכן אצלנו, שיהיה בהצלחה באימונים', OPEN),
    ['equipment_settled']
  );
  assert.deepEqual(
    unbackedReplyClaims('אין צורך בפעולות נוספות מבחינת הציוד', OPEN),
    ['equipment_settled']
  );
});

test('כשבאמת הכול הוסדר — המשפט מותר', () => {
  assert.deepEqual(unbackedReplyClaims('מעולה, הכול מסודר!', SETTLED), []);
});

test('«טרם נסגר» בתוך תוצאה מקוננת נתפס גם הוא', () => {
  const nested = [{
    name: 'reportCentreRegistration',
    result: { נרשם_לבדיקה: 'ארבל', ציוד: { מצב: 'טרם נסגר', קישור: 'https://app.kirboaz.co.il/api/e/x' } },
  }];
  assert.deepEqual(unbackedReplyClaims('הכול תקין, אין צורך בפעולות נוספות', nested), ['equipment_settled']);
});

test('הודעה שאינה מצהירה שהכול סגור אינה נחסמת', () => {
  assert.deepEqual(unbackedReplyClaims('נשאר להסדיר את המגנזיום, הנה הקישור', OPEN), []);
});
