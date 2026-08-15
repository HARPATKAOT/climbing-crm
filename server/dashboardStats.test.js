import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDailySales,
  calculateFunnel,
  calculateConversion,
  calculateDashboardStats,
  calculateStageProgression,
  funnelFamilies,
  listTodayTransactions,
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

test('daily sales include paid payment records and avoid double counting their POS sale', () => {
  const result = calculateDailySales(
    [
      {
        id: 'sale-linked',
        payment_id: 'payment-linked',
        status: 'paid',
        total: 120,
        payment_method: 'online',
        updated_at: '2026-08-13T09:01:00.000Z',
      },
      {
        id: 'cash-only',
        status: 'paid',
        total: 30,
        payment_method: 'cash',
        created_at: '2026-08-13T10:00:00.000Z',
      },
    ],
    new Date('2026-08-13T12:00:00.000Z'),
    [
      {
        id: 'payment-linked',
        status: 'paid',
        amount: 120,
        cc_confirmation_code: 'confirmed',
        paid_at: '2026-08-13T09:00:00.000Z',
      },
      {
        id: 'activity-payment',
        status: 'paid',
        amount: 3900,
        payment_url: 'https://pay.example.test',
        paid_at: '2026-08-13T11:00:00.000Z',
      },
      {
        id: 'pending',
        status: 'pending',
        amount: 500,
        created_at: '2026-08-13T11:00:00.000Z',
      },
    ]
  );

  assert.deepEqual(result, {
    date: '2026-08-13',
    total: 4050,
    count: 3,
    cash: 30,
    online: 4020,
    other: 0,
  });
});

test('funnel counts one highest stage per family and drops archived families entirely', () => {
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
      // An archived parent takes the whole family off working lists — the
      // child's active status must not leak the family back into the funnel.
      { id: 's4', parentId: 'p4', status: 'intro_scheduled' },
    ]
  );

  assert.equal(result.totalFamilies, 3);
  assert.deepEqual(result.byStatus, {
    lead_new: 1,
    details_completed: 0,
    health_signed: 1,
    // Legacy rows remain visible during the migration window.
    pending_signup: 0,
    intro_scheduled: 0,
    intro_paid: 0,
    awaiting_parent_confirmation: 0,
    awaiting_centre_confirmation: 0,
    registered: 1,
  });
});

test('funnel family lists match the funnel counts and open on the stage carrier', () => {
  const parents = [
    { id: 'p1', status: 'lead_new', name: 'משפחת לוי', phone: '0501111111' },
    { id: 'p2', status: 'waitlist', name: 'משפחת כהן', phone: '0502222222' },
    { id: 'p4', status: 'archived', name: 'ארכיון' },
  ];
  const students = [
    { id: 's1', parentId: 'p1', status: 'health_signed', name: 'נועה' },
    { id: 's2', parentId: 'p1', status: 'lead_new', name: 'איתי' },
    { id: 's4', parentId: 'p4', status: 'lead_new', name: 'בארכיון' },
  ];
  const families = funnelFamilies(parents, students);
  const funnel = calculateFunnel(parents, students);
  for (const [stage, list] of Object.entries(families)) {
    if (stage === 'waitlist') continue;
    assert.equal(list.length, funnel.byStatus[stage], `stage ${stage}`);
  }
  assert.equal(families.health_signed[0].open_key, 's1');
  assert.equal(families.health_signed[0].students.length, 2);
  // waitlist is not a funnel stage — the family lands in the side bucket.
  assert.equal(families.waitlist.length, 1);
  assert.equal(families.waitlist[0].parent_id, 'p2');
  assert.equal(funnel.waitlistFamilies, 1);
});

test('stage progression counts a family once per reached stage', () => {
  const result = calculateStageProgression([
    { parent_id: 'a', to_status: 'lead_new', changed_at: '2026-08-01T10:00:00Z' },
    { parent_id: 'a', to_status: 'health_signed', changed_at: '2026-08-02T10:00:00Z' },
    { parent_id: 'b', to_status: 'lead_new', changed_at: '2026-08-01T10:00:00Z' },
    // Same-timestamp batch write still counts as an advance.
    { parent_id: 'c', to_status: 'lead_new', changed_at: '2026-08-03T10:00:00Z' },
    { parent_id: 'c', to_status: 'registered', changed_at: '2026-08-03T10:00:00Z' },
    // Statuses outside the funnel (waitlist/archived) are ignored.
    { parent_id: 'b', to_status: 'waitlist', changed_at: '2026-08-04T10:00:00Z' },
  ]);
  const byStatus = Object.fromEntries(result.map((row) => [row.status, row]));
  assert.deepEqual(
    { reached: byStatus.lead_new.reached, advanced: byStatus.lead_new.advanced },
    { reached: 3, advanced: 2 }
  );
  assert.equal(byStatus.lead_new.rate, 2 / 3);
  assert.deepEqual(
    { reached: byStatus.health_signed.reached, advanced: byStatus.health_signed.advanced },
    { reached: 1, advanced: 0 }
  );
  assert.equal(byStatus.registered.reached, 1);
});

test('today transactions: counted rows sum to the daily total, refunds stay visible unexcluded from the sum', () => {
  const now = new Date('2026-08-13T12:00:00.000Z');
  const sales = [
    {
      id: 'sale-linked',
      payment_id: 'payment-linked',
      status: 'paid',
      total: 120,
      payment_method: 'online',
      customer_name: 'דנה',
      updated_at: '2026-08-13T09:01:00.000Z',
    },
    {
      id: 'cash-only',
      status: 'paid',
      total: 30,
      payment_method: 'cash',
      items: [{ name: 'כניסה לקיר', quantity: 2 }],
      created_at: '2026-08-13T10:00:00.000Z',
    },
    {
      id: 'refunded-today',
      status: 'refunded',
      total: 90,
      payment_method: 'cash',
      created_at: '2026-08-12T10:00:00.000Z',
      refunded_at: '2026-08-13T11:00:00.000Z',
    },
    {
      id: 'open-link',
      status: 'pending_payment',
      total: 250,
      payment_method: 'online',
      payment_url: 'https://pay.example.test/open-link',
      items: [
        { name: 'כניסה לקיר', description: 'כניסה לקיר · הנחה למתאמנים', quantity: 2, unitprice: 45 },
        { name: 'ארטיק', quantity: 1, unitprice: 10 },
      ],
      created_at: '2026-08-13T08:00:00.000Z',
    },
    {
      // חיוב פתוח ישן — חוב עומד, חייב להופיע גם כשהקישור לא נוצר היום.
      id: 'old-open-link',
      status: 'pending_payment',
      total: 400,
      payment_method: 'online',
      created_at: '2026-07-20T08:00:00.000Z',
    },
    {
      id: 'old-sale',
      status: 'paid',
      total: 999,
      payment_method: 'cash',
      created_at: '2026-08-11T10:00:00.000Z',
    },
  ];
  const payments = [
    {
      id: 'payment-linked',
      status: 'paid',
      amount: 120,
      cc_confirmation_code: 'ok',
      paid_at: '2026-08-13T09:00:00.000Z',
    },
  ];
  const result = listTodayTransactions({ sales, payments, now });
  const countedSum = result.rows.filter((r) => r.counted).reduce((sum, r) => sum + r.amount, 0);
  assert.equal(countedSum, result.total);
  assert.equal(result.total, 150);
  assert.equal(result.count, 2);
  // The linked sale is folded into its payment row — not duplicated.
  assert.equal(result.rows.filter((r) => r.sale_id === 'sale-linked').length, 1);
  const refundRow = result.rows.find((r) => r.sale_id === 'refunded-today');
  assert.deepEqual(
    { counted: refundRow.counted, reason: refundRow.excluded_reason },
    { counted: false, reason: 'refunded' }
  );
  const pendingRow = result.rows.find((r) => r.sale_id === 'open-link');
  assert.deepEqual(
    { counted: pendingRow.counted, reason: pendingRow.excluded_reason },
    { counted: false, reason: 'pending' }
  );
  assert.equal(pendingRow.payment_url, 'https://pay.example.test/open-link');
  // description נושא את שם ההנחה, והסכום לשורה הוא כמות כפול מחיר יחידה.
  assert.deepEqual(pendingRow.items, [
    { name: 'כניסה לקיר · הנחה למתאמנים', quantity: 2, unit_price: 45, line_total: 90 },
    { name: 'ארטיק', quantity: 1, unit_price: 10, line_total: 10 },
  ]);
  const oldPendingRow = result.rows.find((r) => r.sale_id === 'old-open-link');
  assert.deepEqual(
    { counted: oldPendingRow.counted, reason: oldPendingRow.excluded_reason },
    { counted: false, reason: 'pending' }
  );
  assert.deepEqual(result.openCharges, { count: 2, total: 650 });
  assert.equal(result.rows.some((r) => r.sale_id === 'old-sale'), false);
  const cashRow = result.rows.find((r) => r.sale_id === 'cash-only');
  assert.equal(cashRow.description, 'כניסה לקיר ×2');
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
