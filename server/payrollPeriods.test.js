import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPeriodSummary,
  buildPeriodView,
  emptyPeriodRow,
  mergeStoredWithLive,
  periodBounds,
  periodCompleteness,
  periodsForEmployee,
  requiredDocTypes,
  rowsForPeriod,
  sanitizePeriodPatch,
} from './payrollPeriods.js';

const agreement = {
  rates: [
    { role: 'הדרכת חוג', mode: 'hourly', amount: 60 },
    { role: 'הדרכת סנפלינג', mode: 'daily', amount: 500 },
  ],
  travel_per_day: 20,
};

const slipEmployee = { id: 'emp1', name: 'דנה', payment_method: 'slip', pensionCompany: 'מנורה' };
const invoiceEmployee = { id: 'emp2', name: 'יואב', payment_method: 'invoice' };

describe('גבולות חודש', () => {
  it('חודש רגיל ננעל על היום האחרון שלו', () => {
    assert.deepEqual(periodBounds('2026-04'), { from: '2026-04-01', to: '2026-04-30' });
  });

  it('פברואר בשנה מעוברת נגמר ב-29', () => {
    assert.deepEqual(periodBounds('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  });

  it('חודש לא תקין מחזיר null ולא זורק', () => {
    assert.equal(periodBounds('2026-13'), null);
    assert.equal(periodBounds(''), null);
  });
});

describe('שורות העבודה של החודש', () => {
  const rows = [
    { employee_id: 'emp1', date: '2026-03-31', role: 'הדרכת חוג', hours: 2 },
    { employee_id: 'emp1', date: '2026-04-01', role: 'הדרכת חוג', hours: 2 },
    { employee_id: 'emp1', date: '2026-04-30', role: 'הדרכת חוג', hours: 2 },
    { employee_id: 'emp1', date: '2026-05-01', role: 'הדרכת חוג', hours: 2 },
    { employee_id: 'emp2', date: '2026-04-10', role: 'הדרכת חוג', hours: 2 },
  ];

  it('לוקח רק את החודש הנכון ורק את העובד הנכון', () => {
    const found = rowsForPeriod(rows, 'emp1', '2026-04');
    assert.equal(found.length, 2);
    assert.deepEqual(found.map((r) => r.date), ['2026-04-01', '2026-04-30']);
  });
});

describe('סיכום חודשי', () => {
  it('מחזיר שעות, ימים, נסיעות וסה"כ, ולצידם פירוט לפי תפקיד', () => {
    const rows = [
      { date: '2026-04-01', role: 'הדרכת חוג', hours: 2, pay_mode: 'hourly' },
      { date: '2026-04-02', role: 'הדרכת חוג', hours: 1.5, pay_mode: 'hourly' },
    ];
    const summary = buildPeriodSummary(rows, agreement);
    assert.equal(summary.hours, 3.5);
    assert.equal(summary.pay, 210);
    assert.equal(summary.days, 2);
    assert.equal(summary.travel, 40);
    assert.equal(summary.total, 250);
    assert.equal(summary.by_role.length, 1);
    assert.equal(summary.by_role[0].role, 'הדרכת חוג');
  });

  it('חודש בלי עבודה מחזיר אפסים ולא נופל', () => {
    const summary = buildPeriodSummary([], agreement);
    assert.equal(summary.total, 0);
    assert.deepEqual(summary.by_role, []);
  });
});

describe('מסמכים נדרשים', () => {
  it('עובד בתלוש עם פנסיה — ארבעה מסמכים', () => {
    assert.deepEqual(requiredDocTypes(slipEmployee), [
      'payslip', 'salary_transfer', 'pension_split', 'pension_deposit',
    ]);
  });

  it('עובד בחשבונית בלי פנסיה — חשבונית ואישור העברה בלבד', () => {
    assert.deepEqual(requiredDocTypes(invoiceEmployee), ['invoice', 'salary_transfer']);
  });

  it('קופת פנסיה של רווחים בלבד אינה נחשבת קופה', () => {
    assert.deepEqual(requiredDocTypes({ payment_method: 'slip', pensionCompany: '   ' }), [
      'payslip', 'salary_transfer',
    ]);
  });
});

describe('שלמות החודש', () => {
  const documents = [
    { type: 'payslip', period: '2026-04' },
    { type: 'salary_transfer', period: '2026-04' },
    { type: 'payslip', period: '2026-03' },
  ];

  it('מסמך של חודש אחר לא סוגר חוסר בחודש הזה', () => {
    const result = periodCompleteness({ employee: slipEmployee, documents, period: '2026-04' });
    assert.deepEqual(result.missing, ['pension_split', 'pension_deposit']);
    assert.equal(result.complete, false);
  });

  it('חודש שלם רק כשגם סכום הפנסיה הוזן', () => {
    const full = [
      ...documents,
      { type: 'pension_split', period: '2026-04' },
      { type: 'pension_deposit', period: '2026-04' },
    ];
    const without = periodCompleteness({ employee: slipEmployee, documents: full, period: '2026-04' });
    assert.deepEqual(without.missing, []);
    assert.equal(without.missing_pension_amount, true);
    assert.equal(without.complete, false);

    const withAmount = periodCompleteness({
      employee: slipEmployee, documents: full, period: '2026-04', stored: { pension_amount: 412 },
    });
    assert.equal(withAmount.complete, true);
  });

  it('עובד בלי פנסיה שלם בלי סכום פנסיה', () => {
    const invoiceDocs = [
      { type: 'invoice', period: '2026-04' },
      { type: 'salary_transfer', period: '2026-04' },
    ];
    const result = periodCompleteness({ employee: invoiceEmployee, documents: invoiceDocs, period: '2026-04' });
    assert.equal(result.missing_pension_amount, false);
    assert.equal(result.complete, true);
  });
});

describe('סיכום צרוב מול סיכום חי', () => {
  const live = { hours: 10, pay: 600, days: 5, travel: 100, total: 700, by_role: [] };
  const sealed = { hours: 8, pay: 480, days: 4, travel: 80, total: 560, by_role: [] };

  it('שורה פתוחה מציגה את החישוב החי', () => {
    assert.equal(mergeStoredWithLive({ status: 'open', summary: null }, live).total, 700);
    assert.equal(mergeStoredWithLive(null, live).total, 700);
  });

  it('שורה סגורה מציגה את מה שנצרב, גם כשהחישוב החי השתנה', () => {
    assert.equal(mergeStoredWithLive({ status: 'sealed', summary: sealed }, live).total, 560);
  });

  it('שורה שסומנה סגורה אבל בלי סיכום נופלת חזרה לחי, ולא לריק', () => {
    assert.equal(mergeStoredWithLive({ status: 'sealed', summary: null }, live).total, 700);
  });
});

describe('ניקוי עדכון ידני', () => {
  it('מעביר רק שדות מותרים', () => {
    const patch = sanitizePeriodPatch({ pension_amount: 300, status: 'sealed', summary: {}, id: 'x' });
    assert.deepEqual(patch, { pension_amount: 300 });
  });

  it('ערך ריק מנקה את השדה במקום לשמור מחרוזת ריקה', () => {
    assert.deepEqual(sanitizePeriodPatch({ pension_amount: '' }), { pension_amount: null });
    assert.deepEqual(sanitizePeriodPatch({ salary_paid_at: null }), { salary_paid_at: null });
  });

  it('תאריך נחתך ליום ותאריך פסול נדחה', () => {
    assert.deepEqual(sanitizePeriodPatch({ salary_paid_at: '2026-04-10T08:00:00Z' }), { salary_paid_at: '2026-04-10' });
    assert.throws(() => sanitizePeriodPatch({ salary_paid_at: '10/04/2026' }), /תאריך אינו תקין/);
  });

  it('סכום שלילי נדחה', () => {
    assert.throws(() => sanitizePeriodPatch({ pension_amount: -5 }), /סכום אינו תקין/);
  });
});

describe('רשימת החודשים של עובד', () => {
  it('מאחדת חודשים מעבודה, משורות שמורות וממסמכים, מהחדש לישן', () => {
    const periods = periodsForEmployee({
      employeeId: 'emp1',
      workAssignments: [
        { employee_id: 'emp1', date: '2026-04-05' },
        { employee_id: 'emp1', date: '2026-04-20' },
        { employee_id: 'emp2', date: '2026-01-05' },
      ],
      storedRows: [{ employee_id: 'emp1', period: '2026-02' }],
      documents: [{ period: '2025-12' }, { period: null }],
    });
    assert.deepEqual(periods, ['2026-04', '2026-02', '2025-12']);
  });
});

describe('תצוגת חודש מלאה', () => {
  it('חודש שלא נגעו בו מקבל שורה ריקה עם סיכום חי', () => {
    const view = buildPeriodView({
      employee: slipEmployee,
      period: '2026-04',
      stored: null,
      workAssignments: [{ employee_id: 'emp1', date: '2026-04-01', role: 'הדרכת חוג', hours: 2 }],
      agreement,
      documents: [],
    });
    assert.equal(view.status, 'open');
    assert.equal(view.summary.total, 140);
    assert.equal(view.completeness.complete, false);
    assert.equal(view.employee_name, 'דנה');
  });

  it('חודש סגור לא זז אחרי שהתעריף בהסכם עלה', () => {
    const rows = [{ employee_id: 'emp1', date: '2026-04-01', role: 'הדרכת חוג', hours: 2 }];
    const stored = {
      id: 'pp1', employee_id: 'emp1', period: '2026-04', status: 'sealed',
      summary: { hours: 2, pay: 120, days: 1, travel: 20, total: 140, by_role: [] },
    };
    const raised = { ...agreement, rates: [{ role: 'הדרכת חוג', mode: 'hourly', amount: 999 }] };
    const view = buildPeriodView({
      employee: slipEmployee, period: '2026-04', stored, workAssignments: rows, agreement: raised, documents: [],
    });
    assert.equal(view.summary.total, 140);
    assert.equal(view.live_summary.total > 140, true);
  });
});

describe('שורה ריקה', () => {
  it('נפתחת כפתוחה ובלי סיכום', () => {
    const row = emptyPeriodRow('emp1', '2026-04');
    assert.equal(row.status, 'open');
    assert.equal(row.summary, null);
    assert.equal(row.id, null);
  });
});
