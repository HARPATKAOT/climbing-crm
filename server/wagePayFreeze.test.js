import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountForWorkRow,
  applyRoleLabels,
  frozenAmountOf,
  summarizeWork,
  summarizeByRole,
  workTypeRole,
} from './wageRates.js';

const agreement = {
  rates: [
    { role: 'מדריך חוג', mode: 'hourly', amount: 60 },
    { role: 'הדרכת סנפלינג', mode: 'daily', amount: 500 },
  ],
  travel_per_day: 20,
};

describe('חתימת שכר על שורת עבודה', () => {
  it('שורה שלא נחתמה מתומחרת לפי ההסכם הנוכחי', () => {
    const row = { role: 'מדריך חוג', hours: 2, pay_mode: 'hourly' };
    assert.equal(frozenAmountOf(row), null);
    assert.equal(amountForWorkRow(row, agreement), 120);
  });

  it('שורה חתומה שומרת על הסכום גם כשהתעריף עלה', () => {
    const row = {
      role: 'מדריך חוג',
      hours: 2,
      pay_mode: 'hourly',
      pay_amount: 120,
      pay_rate: 60,
      pay_frozen_at: '2026-07-01T00:00:00.000Z',
    };
    const raised = { ...agreement, rates: [{ role: 'מדריך חוג', mode: 'hourly', amount: 90 }] };
    assert.equal(amountForWorkRow(row, raised), 120);
  });

  it('שורה חתומה שומרת על הסכום גם אחרי ששם התפקיד השתנה או נמחק', () => {
    const row = {
      role: 'בונה מסלולים רמה 1',
      hours: 3,
      pay_mode: 'hourly',
      pay_amount: 150,
      pay_frozen_at: '2026-07-01T00:00:00.000Z',
    };
    assert.equal(amountForWorkRow(row, agreement), 150);
    assert.equal(amountForWorkRow(row, { rates: [] }), 150);
  });

  it('חותמת בלי סכום תקין אינה נחשבת חתימה', () => {
    const row = { role: 'מדריך חוג', hours: 1, pay_frozen_at: '2026-07-01T00:00:00.000Z' };
    assert.equal(frozenAmountOf(row), null);
    assert.equal(amountForWorkRow(row, agreement), 60);
  });

  it('שורה ותיקה בלי תפקיד רשום מתומחרת לפי השם העדכני של התפקיד', () => {
    // הקטלוג אומר שתפקיד ה-trainer נקרא היום „מדריך חוג”.
    applyRoleLabels([
      { key: 'trainer', label: 'מדריך חוג' },
      { key: 'wall_operator', label: 'הפעלת קיר' },
    ]);
    assert.equal(workTypeRole('class_shift'), 'מדריך חוג');
    const row = { work_type: 'class_shift', hours: 2, pay_mode: 'hourly' };
    assert.equal(amountForWorkRow(row, agreement), 120);

    // שינוי שם נוסף — אותה שורה ממשיכה להיות מתומחרת, בלי לגעת בה.
    applyRoleLabels([{ key: 'trainer', label: 'אימון קבוצה' }]);
    const renamed = { rates: [{ role: 'אימון קבוצה', mode: 'hourly', amount: 55 }] };
    assert.equal(amountForWorkRow(row, renamed), 110);
  });

  it('הסיכום החודשי סוכם סכומים חתומים ולא מחשב אותם מחדש', () => {
    const rows = [
      { date: '2026-07-01', role: 'מדריך חוג', hours: 2, pay_amount: 120, pay_frozen_at: 'x' },
      { date: '2026-07-02', role: 'הדרכת סנפלינג', hours: 8, pay_amount: 500, pay_frozen_at: 'x' },
    ];
    const emptied = { rates: [], travel_per_day: 20 };
    const sum = summarizeWork(rows, emptied);
    assert.equal(sum.pay, 620);
    assert.equal(sum.days, 2);
    assert.equal(sum.travel, 40);
    assert.equal(sum.total, 660);

    const byRole = summarizeByRole(rows, emptied);
    assert.deepEqual(byRole.map((r) => [r.role, r.amount]), [
      ['הדרכת סנפלינג', 500],
      ['מדריך חוג', 120],
    ]);
  });
});
