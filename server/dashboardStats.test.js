import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDailySales,
  calculateFunnel,
  calculateConversion,
  calculateDashboardStats,
} from './dashboardStats.js';

test('daily sales use the Israel date and completed sales only', () => {
  const result = calculateDailySales(
    [
      {
        status: 'paid',
        total: 100,
        payment_method: 'cash',
        created_at: '2026-07-25T21:30:00.000Z',
      },
      {
        status: 'completed',
        total: 60,
        payment_method: 'online',
        completed_at: '2026-07-26T08:00:00.000Z',
      },
      {
        status: 'paid',
        total: 40,
        payment_method: 'bank_transfer',
        updated_at: '2026-07-26T10:00:00.000Z',
      },
      {
        status: 'pending_payment',
        total: 500,
        payment_method: 'online',
        created_at: '2026-07-26T09:00:00.000Z',
      },
      {
        status: 'refunded',
        total: 200,
        payment_method: 'cash',
        created_at: '2026-07-26T09:00:00.000Z',
      },
    ],
    new Date('2026-07-26T12:00:00.000Z')
  );

  assert.deepEqual(result, {
    date: '2026-07-26',
    total: 200,
    count: 3,
    cash: 100,
    online: 60,
    other: 40,
  });
});

test('funnel counts one highest stage per family including parent-only leads', () => {
  const result = calculateFunnel(
    [
      { id: 'p1', status: 'lead_new' },
      { id: 'p2', status: 'health_signed' },
      { id: 'p3', status: null },
      { id: 'p4', status: 'archived' },
    ],
    [
      { id: 's1', parentId: 'p1', status: 'registered' },
      { id: 's2', parentId: 'p1', status: 'intro_paid' },
      { id: 's4', parentId: 'p4', status: 'intro_scheduled' },
    ]
  );

  assert.equal(result.totalFamilies, 4);
  assert.deepEqual(result.byStatus, {
    lead_new: 1,
    health_signed: 1,
    // Soft hold while the customer finishes registering — nobody is here yet.
    pending_signup: 0,
    intro_scheduled: 1,
    intro_paid: 0,
    registered: 1,
  });
});

test('conversion includes baseline lead cohort but only later registrations', () => {
  const result = calculateConversion([
    { parent_id: 'old', to_status: 'lead_new', is_baseline: true },
    { parent_id: 'old', to_status: 'registered', is_baseline: false },
    { parent_id: 'p1', to_status: 'lead_new', is_baseline: false },
    { parent_id: 'p1', to_status: 'lead_new', is_baseline: false },
    { parent_id: 'p1', to_status: 'registered', is_baseline: false },
    { parent_id: 'p2', to_status: 'lead_new', is_baseline: false },
    { parent_id: 'p3', to_status: 'registered', is_baseline: false },
  ]);

  assert.deepEqual(result, {
    denominator: 3,
    converted: 2,
    rate: 2 / 3,
  });
});

test('dashboard hides conversion when tracking has no denominator', () => {
  const result = calculateDashboardStats({
    history: [
      {
        parent_id: 'p1',
        to_status: 'registered',
        is_baseline: true,
        changed_at: '2026-07-26T10:00:00.000Z',
      },
    ],
    now: new Date('2026-07-26T12:00:00.000Z'),
  });

  assert.equal(result.conversion, null);
  assert.equal(result.trackingSince, '2026-07-26T10:00:00.000Z');
});
