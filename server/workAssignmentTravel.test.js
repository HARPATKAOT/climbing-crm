/**
 * נסיעות ליום מסוים — מה שנרשם על השורה גובר על התעריף הקבוע בהסכם.
 *
 * הבדיקה מגנה על שלוש נקודות שקל לשבור בלי לשים לב: ריק אינו אפס, יום עבודה
 * הוא עדיין נסיעה אחת גם כשיש בו שתי שורות, ושורות שלא נגעו בהן ממשיכות
 * להיות מחושבות בדיוק כמו קודם.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { travelForRow, travelTotalOf, summarizeWork } from './wageRates.js';

const agreement = { travel_per_day: 30, rates: [{ role: 'הדרכת סנפלינג', mode: 'daily', amount: 700 }] };

test('שורה בלי סכום נסיעות נופלת לתעריף הקבוע', () => {
  assert.equal(travelForRow({ date: '2026-08-11' }, agreement), 30);
  assert.equal(travelForRow({ date: '2026-08-11', travel_amount: null }, agreement), 30);
  assert.equal(travelForRow({ date: '2026-08-11', travel_amount: '' }, agreement), 30);
});

test('אפס אינו ריק — יום בלי נסיעות משלם אפס', () => {
  assert.equal(travelForRow({ date: '2026-08-11', travel_amount: 0 }, agreement), 0);
});

test('סכום מיוחד ליום גובר על התעריף הקבוע', () => {
  assert.equal(travelForRow({ date: '2026-08-11', travel_amount: 120 }, agreement), 120);
});

test('יום עבודה אחד הוא נסיעה אחת גם בשתי שורות', () => {
  const rows = [
    { date: '2026-08-11', travel_amount: 120 },
    { date: '2026-08-11' },
  ];
  assert.equal(travelTotalOf(rows, agreement), 120);
});

test('שני סכומים מיוחדים באותו יום — נלקח הגבוה, לא הסכום שלהם', () => {
  const rows = [
    { date: '2026-08-11', travel_amount: 120 },
    { date: '2026-08-11', travel_amount: 80 },
  ];
  assert.equal(travelTotalOf(rows, agreement), 120);
});

test('שורות שלא נגעו בהן מחושבות כמו קודם — יום כפול התעריף', () => {
  const rows = [{ date: '2026-08-11' }, { date: '2026-08-12' }];
  assert.equal(travelTotalOf(rows, agreement), 60);
});

test('בתעריף יומי השעות אינן משנות את התשלום', () => {
  const short = { date: '2026-08-11', role: 'הדרכת סנפלינג', hours: 4 };
  const long = { date: '2026-08-12', role: 'הדרכת סנפלינג', hours: 11 };
  const summary = summarizeWork([short, long], agreement);
  assert.equal(summary.pay, 1400);
  assert.equal(summary.hours, 15);
  assert.equal(summary.travel, 60);
});
