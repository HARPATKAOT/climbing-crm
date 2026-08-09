/**
 * שני השדות של ההרשמה ליום בודד עוברים את נרמול מטען האירוע.
 *
 * `normalizeActivityPayload` בונה את המטען מאפס ולא משכפל את הגוף שנשלח, ולכן
 * כל שדה חדש שלא נרשם בו נופל בשקט — נשמר במסך, נעלם בשמירה. הבדיקה הזאת
 * קיימת כדי שזה לא יקרה שוב.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mappers } from './supa.js';

test('העמודות החדשות ברשימת העמודות של activities', () => {
  const row = mappers.activities.toRow({
    id: 'a1', name: 'קייטנה', allow_single_day: true, single_day_price: 120,
  });
  assert.equal(row.allow_single_day, true);
  assert.equal(row.single_day_price, 120);
});

test('ימי ההרשמה ברשימת העמודות של ההרשמות ושל ההזמנות', () => {
  const reg = mappers.activity_registrations.toRow({
    id: 'r1', attending_dates: ['2026-08-11'],
  });
  assert.deepEqual(reg.attending_dates, ['2026-08-11']);

  const order = mappers.activity_registration_orders.toRow({
    id: 'o1', attending_dates: ['2026-08-11', '2026-08-12'],
  });
  assert.deepEqual(order.attending_dates, ['2026-08-11', '2026-08-12']);
});

test('הרשמה מלאה נשמרת עם null ולא נופלת מהמיפוי', () => {
  const reg = mappers.activity_registrations.toRow({ id: 'r1', attending_dates: null });
  assert.equal(reg.attending_dates, null);
  assert.equal('attending_dates' in reg, true);
});
