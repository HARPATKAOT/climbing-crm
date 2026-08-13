const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

export const FUNNEL_STAGES = [
  'lead_new',
  'details_completed',
  'health_signed',
  'pending_signup',
  'intro_scheduled',
  'intro_paid',
  'awaiting_parent_confirmation',
  'awaiting_centre_confirmation',
  'registered',
];

const STAGE_RANK = new Map(FUNNEL_STAGES.map((status, index) => [status, index]));
const EXCLUDED_SALE_STATUSES = new Set([
  'pending_payment',
  'quoted',
  'refunded',
  'cancelled',
  'canceled',
]);
const COMPLETED_SALE_STATUSES = new Set(['paid', 'completed']);
const ONLINE_METHODS = new Set(['online', 'emv', 'credit', 'cc', 'card']);

export function israelDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ISRAEL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function saleCompletedAt(sale) {
  return sale?.paid_at || sale?.completed_at || sale?.updated_at || sale?.created_at;
}

function saleBucket(method) {
  const normalized = String(method || '').trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (ONLINE_METHODS.has(normalized)) return 'online';
  return 'other';
}

function paymentCompletedAt(payment) {
  return payment?.paid_at || payment?.completed_at || payment?.updated_at || payment?.created_at;
}

function paymentBucket(payment, linkedSale) {
  const explicit = payment?.payment_method || linkedSale?.payment_method;
  if (explicit) return saleBucket(explicit);
  if (
    payment?.cc_confirmation_code ||
    payment?.cc_card_type ||
    payment?.cc_last4 ||
    payment?.payment_url
  ) {
    return 'online';
  }
  return 'other';
}

export function calculateDailySales(sales = [], now = new Date(), payments = []) {
  const date = israelDate(now);
  const result = {
    date,
    total: 0,
    count: 0,
    cash: 0,
    online: 0,
    other: 0,
  };

  const saleByPayment = new Map(
    (sales || [])
      .filter((sale) => sale?.payment_id)
      .map((sale) => [String(sale.payment_id), sale])
  );
  const countedPaymentIds = new Set();

  for (const payment of payments || []) {
    const status = String(payment?.status || '').trim().toLowerCase();
    if (
      !COMPLETED_SALE_STATUSES.has(status) ||
      israelDate(paymentCompletedAt(payment)) !== date
    ) {
      continue;
    }
    const amount = Number(payment?.amount ?? payment?.total ?? 0);
    if (!Number.isFinite(amount)) continue;
    const paymentId = String(payment?.id || '');
    const bucket = paymentBucket(payment, saleByPayment.get(paymentId));
    result[bucket] += amount;
    result.total += amount;
    result.count += 1;
    if (paymentId) countedPaymentIds.add(paymentId);
  }

  for (const sale of sales || []) {
    const status = String(sale?.status || '').trim().toLowerCase();
    if (
      EXCLUDED_SALE_STATUSES.has(status) ||
      !COMPLETED_SALE_STATUSES.has(status) ||
      israelDate(saleCompletedAt(sale)) !== date ||
      (sale?.payment_id && countedPaymentIds.has(String(sale.payment_id)))
    ) {
      continue;
    }
    const amount = Number(sale?.total ?? sale?.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const bucket = saleBucket(sale?.payment_method);
    result[bucket] += amount;
    result.total += amount;
    result.count += 1;
  }

  return result;
}

function bestFamilyStatus(statuses) {
  let best = null;
  let bestRank = -1;
  for (const rawStatus of statuses) {
    const status = rawStatus || 'lead_new';
    const rank = STAGE_RANK.get(status);
    if (rank !== undefined && rank > bestRank) {
      best = status;
      bestRank = rank;
    }
  }
  return best;
}

export function calculateFunnel(parents = [], students = []) {
  const families = new Map();
  for (const parent of parents || []) {
    if (!parent?.id) continue;
    families.set(String(parent.id), [parent.status || 'lead_new']);
  }
  for (const student of students || []) {
    if (!student?.parentId) continue;
    const parentId = String(student.parentId);
    const statuses = families.get(parentId) || [];
    statuses.push(student.status || 'lead_new');
    families.set(parentId, statuses);
  }

  const byStatus = Object.fromEntries(FUNNEL_STAGES.map((status) => [status, 0]));
  for (const statuses of families.values()) {
    const status = bestFamilyStatus(statuses);
    if (status) byStatus[status] += 1;
  }

  return {
    totalFamilies: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    byStatus,
    stages: FUNNEL_STAGES.map((status) => ({ status, count: byStatus[status] })),
  };
}

export function calculateConversion(history = []) {
  const trackedEvents = (history || []).filter((event) => event && event.parent_id);
  const eligible = new Set(
    trackedEvents
      .filter((event) => event.to_status === 'lead_new')
      .map((event) => String(event.parent_id))
  );
  if (eligible.size === 0) return null;

  const converted = new Set(
    trackedEvents
      .filter(
        (event) =>
          event.is_baseline !== true &&
          event.to_status === 'registered' &&
          eligible.has(String(event.parent_id))
      )
      .map((event) => String(event.parent_id))
  );

  return {
    denominator: eligible.size,
    converted: converted.size,
    rate: converted.size / eligible.size,
  };
}

export function trackingStart(history = []) {
  const timestamps = (history || [])
    .map((event) => event?.changed_at)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => a - b);
  return timestamps[0]?.toISOString() || null;
}

export function calculateDashboardStats({
  sales = [],
  payments = [],
  parents = [],
  students = [],
  history = [],
  now = new Date(),
} = {}) {
  return {
    dailySales: calculateDailySales(sales, now, payments),
    funnel: calculateFunnel(parents, students),
    conversion: calculateConversion(history),
    trackingSince: trackingStart(history),
  };
}
