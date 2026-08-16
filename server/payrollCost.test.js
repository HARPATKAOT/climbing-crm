process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employerCostFactor,
  laborCostRows,
  effectiveCostPerHour,
  costByKey,
  enrollmentActiveInMonth,
  classProfitability,
  instructorProfitability,
  DEFAULT_EMPLOYER_COST_FACTOR,
} from './payrollCost.js';

const assignment = (over = {}) => ({
  id: over.id ?? 'w1',
  employee_id: over.employee_id ?? 'e-27',
  date: over.date ?? '2026-08-03',
  group_id: 'group_id' in over ? over.group_id : 'g-1',
  activity_id: over.activity_id ?? null,
  work_type: 'class_shift',
  hours: over.hours ?? 2,
  pay_amount: over.pay_amount,
  travel_amount: over.travel_amount ?? 0,
});

test('only frozen pay amounts are costed; unpriced rows are surfaced, not invented', () => {
  const { rows, unpriced } = laborCostRows({
    workAssignments: [
      assignment({ pay_amount: 200 }),
      assignment({ id: 'w2', pay_amount: undefined }), // טרם נחתם — אסור להמציא
    ],
    factor: 1.25,
  });
  assert.equal(rows.length, 1);
  assert.equal(unpriced.length, 1);
  assert.equal(rows[0].wage_agorot, 20000);
  assert.equal(rows[0].employer_cost_agorot, 25000);
});

test('travel joins the wage before the employer factor', () => {
  const { rows } = laborCostRows({
    workAssignments: [assignment({ pay_amount: 200, travel_amount: 20 })],
    factor: 1.5,
  });
  assert.equal(rows[0].wage_agorot, 22000);
  assert.equal(rows[0].employer_cost_agorot, 33000);
});

test('factor comes from settings within sane bounds', () => {
  assert.equal(employerCostFactor([{ id: 'default', employer_cost_factor: 1.31 }]), 1.31);
  assert.equal(employerCostFactor([{ id: 'default', employer_cost_factor: 9 }]), DEFAULT_EMPLOYER_COST_FACTOR);
  assert.equal(employerCostFactor([]), DEFAULT_EMPLOYER_COST_FACTOR);
});

test('cost per hour skips flat rows without hours but keeps their cost', () => {
  const { rows } = laborCostRows({
    workAssignments: [
      assignment({ pay_amount: 200, hours: 2 }),
      assignment({ id: 'w2', pay_amount: 300, hours: 0 }), // flat יומי
    ],
    factor: 1,
  });
  const [employee] = effectiveCostPerHour(rows);
  assert.equal(employee.employer_cost_agorot, 50000);
  assert.equal(employee.hours, 2);
  assert.equal(employee.cost_per_hour_agorot, 25000); // כל העלות ÷ השעות שנרשמו
});

test('enrollment activity window respects cancellation and dates', () => {
  assert.equal(enrollmentActiveInMonth({ status: 'active', start_date: '2026-07-01' }, '2026-08'), true);
  assert.equal(enrollmentActiveInMonth({ status: 'cancelled' }, '2026-08'), false);
  assert.equal(enrollmentActiveInMonth({ status: 'active', start_date: '2026-09-01' }, '2026-08'), false);
  assert.equal(enrollmentActiveInMonth({ status: 'active', end_date: '2026-07-15' }, '2026-08'), false);
});

test('class profitability: revenue minus frozen labor, with breakeven', () => {
  const { rows } = laborCostRows({
    workAssignments: [
      assignment({ pay_amount: 200, date: '2026-08-03' }),
      assignment({ id: 'w2', pay_amount: 200, date: '2026-08-10' }),
      assignment({ id: 'w3', pay_amount: 200, date: '2026-07-06' }), // חודש אחר
    ],
    factor: 1.25,
  });
  const [row] = classProfitability({
    groups: [{ id: 'g-1', name: 'מתקדמים', trainer: 'e-27' }],
    enrollments: [
      { group_id: 'g-1', status: 'active', price: 380 },
      { group_id: 'g-1', status: 'active', price: 380 },
      { group_id: 'g-1', status: 'cancelled', price: 380 },
    ],
    laborRows: rows,
    month: '2026-08',
  });
  assert.equal(row.students, 2);
  assert.equal(row.revenue_agorot, 76000);
  assert.equal(row.labor_cost_agorot, 50000); // רק אוגוסט
  assert.equal(row.profit_agorot, 26000);
  assert.equal(row.breakeven_students, 2); // 50000 ÷ 38000 → 2 חניכים
  assert.equal(row.margin, 34.2);
});

test('instructor view joins their labor cost with their classes revenue', () => {
  const { rows } = laborCostRows({
    workAssignments: [assignment({ pay_amount: 400 })],
    factor: 1,
  });
  const classRows = classProfitability({
    groups: [{ id: 'g-1', name: 'מתקדמים', trainer: 'e-27' }],
    enrollments: [{ group_id: 'g-1', status: 'active', price: 380 }],
    laborRows: rows,
    month: '2026-08',
  });
  const [instructor] = instructorProfitability({ classRows, laborRows: rows, month: '2026-08' });
  assert.equal(instructor.employee_id, 'e-27');
  assert.equal(instructor.cost_agorot, 40000);
  assert.equal(instructor.revenue_agorot, 38000);
  assert.equal(instructor.revenue_per_cost, 0.95);
});

test('costByKey attributes by group and ignores unattributed rows', () => {
  const { rows } = laborCostRows({
    workAssignments: [
      assignment({ pay_amount: 100 }),
      assignment({ id: 'w2', pay_amount: 100, group_id: null }), // משמרת דלפק
    ],
    factor: 1,
  });
  const grouped = costByKey(rows, 'group_id');
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].employer_cost_agorot, 10000);
});
