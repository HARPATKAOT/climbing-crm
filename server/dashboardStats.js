const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

export const FUNNEL_STAGES = [
  'lead_new',
  'details_completed',
  'health_signed',
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

/**
 * Archiving is a customer-level decision that lives on the payer (see
 * client/src/utils/leadUtils.js): an archived parent takes the whole family
 * off every working list. The funnel must follow the same rule — before this
 * filter, a family whose parent was archived leaked back in through a child
 * still marked lead_new, and the funnel disagreed with the customers screen.
 */
function familyEntries(parents = [], students = []) {
  const families = new Map();
  const archivedParents = new Set();
  for (const parent of parents || []) {
    if (!parent?.id) continue;
    const id = String(parent.id);
    if (String(parent.status || '') === 'archived') archivedParents.add(id);
    families.set(id, [parent.status || 'lead_new']);
  }
  for (const student of students || []) {
    if (!student?.parentId) continue;
    const parentId = String(student.parentId);
    if (archivedParents.has(parentId)) continue;
    const statuses = families.get(parentId) || [];
    statuses.push(student.status || 'lead_new');
    families.set(parentId, statuses);
  }
  for (const id of archivedParents) families.delete(id);
  return families;
}

/** A family parked on the waitlist is outside the funnel but must stay visible. */
function isWaitlistFamily(statuses, best) {
  return !best && statuses.some((status) => status === 'waitlist');
}

export function calculateFunnel(parents = [], students = []) {
  const byStatus = Object.fromEntries(FUNNEL_STAGES.map((status) => [status, 0]));
  let waitlistFamilies = 0;
  for (const statuses of familyEntries(parents, students).values()) {
    const status = bestFamilyStatus(statuses);
    if (status) byStatus[status] += 1;
    else if (isWaitlistFamily(statuses, status)) waitlistFamilies += 1;
  }

  return {
    totalFamilies: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    byStatus,
    waitlistFamilies,
    stages: FUNNEL_STAGES.map((status) => ({ status, count: byStatus[status] })),
  };
}

/**
 * The families behind each funnel number, for the stage drill-down. Same
 * family-once/best-stage/no-archived rules as calculateFunnel, so the lists
 * always sum to the numbers shown.
 */
export function funnelFamilies(parents = [], students = []) {
  const parentById = new Map((parents || []).filter((p) => p?.id).map((p) => [String(p.id), p]));
  const studentsByParent = new Map();
  for (const student of students || []) {
    if (!student?.parentId) continue;
    const key = String(student.parentId);
    if (!studentsByParent.has(key)) studentsByParent.set(key, []);
    studentsByParent.get(key).push(student);
  }

  const byStage = Object.fromEntries([...FUNNEL_STAGES, 'waitlist'].map((status) => [status, []]));
  for (const [parentId, statuses] of familyEntries(parents, students)) {
    let best = bestFamilyStatus(statuses);
    if (!best) {
      if (!isWaitlistFamily(statuses, best)) continue;
      best = 'waitlist';
    }
    const parent = parentById.get(parentId) || null;
    const kids = studentsByParent.get(parentId) || [];
    // Open the card of the child that carries the family's best stage;
    // a parent-only family opens through its synthetic parent: key.
    const carrier = kids.find((kid) => (kid.status || 'lead_new') === best) || kids[0] || null;
    byStage[best].push({
      parent_id: parent?.id || parentId,
      parent_name: parent?.name || '',
      phone: parent?.phone || '',
      next_followup: parent?.nextFollowup || carrier?.nextFollowup || null,
      students: kids.map((kid) => ({ id: kid.id, name: kid.name || '', status: kid.status || 'lead_new' })),
      open_key: carrier ? String(carrier.id) : `parent:${parentId}`,
      carrier_student_id: carrier ? String(carrier.id) : null,
    });
  }
  for (const stage of Object.keys(byStage)) {
    byStage[stage].sort((a, b) => String(a.parent_name).localeCompare(String(b.parent_name), 'he'));
  }
  return byStage;
}

/**
 * How families move between stages, from the status journal. For each stage:
 * how many families ever reached it, and how many of those later moved to any
 * more advanced stage. `rate` is advanced/reached — the stage where it drops
 * is where leads get stuck.
 */
export function calculateStageProgression(history = []) {
  const byParent = new Map();
  for (const event of history || []) {
    if (!event?.parent_id) continue;
    const rank = STAGE_RANK.get(event.to_status);
    if (rank === undefined) continue;
    const at = Date.parse(event.changed_at || '') || 0;
    const key = String(event.parent_id);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push({ rank, at });
  }

  const reached = Object.fromEntries(FUNNEL_STAGES.map((status) => [status, 0]));
  const advanced = Object.fromEntries(FUNNEL_STAGES.map((status) => [status, 0]));
  for (const events of byParent.values()) {
    const firstAt = new Map();
    for (const event of events) {
      const seen = firstAt.get(event.rank);
      if (seen === undefined || event.at < seen) firstAt.set(event.rank, event.at);
    }
    for (const [rank, at] of firstAt) {
      reached[FUNNEL_STAGES[rank]] += 1;
      // Same-timestamp pairs come from batched writes (parent+child in one
      // save) — count them as an advance rather than dropping them.
      const moved = events.some((event) => event.rank > rank && event.at >= at);
      if (moved) advanced[FUNNEL_STAGES[rank]] += 1;
    }
  }

  return FUNNEL_STAGES.map((status) => ({
    status,
    reached: reached[status],
    advanced: advanced[status],
    rate: reached[status] > 0 ? advanced[status] / reached[status] : null,
  }));
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

/** כל קישורי התשלום שעדיין פתוחים — חוב עומד, בלי תלות בתאריך היצירה. */
export function openChargesSummary(sales = []) {
  let count = 0;
  let total = 0;
  for (const sale of sales || []) {
    if (String(sale?.status || '').trim().toLowerCase() !== 'pending_payment') continue;
    const amount = Number(sale?.total ?? sale?.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    count += 1;
    total += amount;
  }
  return { count, total };
}

export function calculateDashboardStats({
  sales = [],
  payments = [],
  parents = [],
  students = [],
  history = [],
  now = new Date(),
} = {}) {
  const reference = now instanceof Date ? now : new Date(now);
  return {
    dailySales: {
      ...calculateDailySales(sales, now, payments),
      // הקשר לפני מספר: ההשוואה של „הכנסות היום” היא לאתמול.
      yesterdayTotal: calculateDailySales(sales, new Date(reference.getTime() - 24 * 60 * 60 * 1000), payments).total,
      openCharges: openChargesSummary(sales),
    },
    funnel: {
      ...calculateFunnel(parents, students),
      progression: calculateStageProgression(history),
    },
    conversion: calculateConversion(history),
    trackingSince: trackingStart(history),
  };
}

function saleDescription(sale) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const names = items
    .map((item) => {
      const qty = Number(item?.quantity) || 1;
      return qty > 1 ? `${item?.name || 'פריט'} ×${qty}` : (item?.name || 'פריט');
    })
    .filter(Boolean);
  return names.join(' · ') || 'מכירה בדלפק';
}

/** שורות המוצרים של העסקה, לפירוט בתוך המגירה. description נושא גם את שם ההנחה. */
function saleItemLines(sale) {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  return items.map((item) => {
    const quantity = Number(item?.quantity) || 1;
    const unitPrice = Number(item?.unitprice ?? item?.unit_price ?? 0);
    return {
      name: item?.description || item?.name || 'פריט',
      quantity,
      unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
      line_total: Number.isFinite(unitPrice) ? Math.round(unitPrice * quantity * 100) / 100 : 0,
    };
  });
}

function customerNameFor({ row, parentById, studentById }) {
  if (row?.customer_name) return row.customer_name;
  const parent = row?.parent_id ? parentById.get(String(row.parent_id)) : null;
  if (parent?.name) return parent.name;
  const student = row?.student_id ? studentById.get(String(row.student_id)) : null;
  if (student?.name) return student.name;
  return '';
}

function customerPhoneFor({ row, parentById, studentById }) {
  if (row?.customer_phone) return row.customer_phone;
  const parent = row?.parent_id ? parentById.get(String(row.parent_id)) : null;
  if (parent?.phone) return parent.phone;
  const student = row?.student_id ? studentById.get(String(row.student_id)) : null;
  return student?.phone || '';
}

/**
 * The rows behind the "הכנסות היום" number. Same pairing rules as
 * calculateDailySales — a payment row wins over its linked POS sale — so the
 * counted rows always sum to the headline total. On top of the counted rows,
 * today's refunded/cancelled/still-pending sales are returned as excluded rows
 * (counted:false): a refund done from this very list must stay visible, and an
 * open payment link is the one thing "ביטול עסקה" applies to.
 */
export function listTodayTransactions({
  sales = [],
  payments = [],
  parents = [],
  students = [],
  now = new Date(),
} = {}) {
  const date = israelDate(now);
  const parentById = new Map((parents || []).filter((p) => p?.id).map((p) => [String(p.id), p]));
  const studentById = new Map((students || []).filter((s) => s?.id).map((s) => [String(s.id), s]));
  const saleByPayment = new Map(
    (sales || []).filter((sale) => sale?.payment_id).map((sale) => [String(sale.payment_id), sale])
  );
  const saleByPaymentLink = new Map(
    (payments || []).filter((p) => p?.pos_sale_id).map((p) => [String(p.pos_sale_id), p])
  );
  const rows = [];
  const countedPaymentIds = new Set();

  for (const payment of payments || []) {
    const status = String(payment?.status || '').trim().toLowerCase();
    if (!COMPLETED_SALE_STATUSES.has(status) || israelDate(paymentCompletedAt(payment)) !== date) continue;
    const amount = Number(payment?.amount ?? payment?.total ?? 0);
    if (!Number.isFinite(amount)) continue;
    const paymentId = String(payment?.id || '');
    const sale = saleByPayment.get(paymentId) || null;
    const bucket = paymentBucket(payment, sale);
    if (paymentId) countedPaymentIds.add(paymentId);
    rows.push({
      id: `payment:${paymentId || rows.length}`,
      kind: 'payment',
      at: paymentCompletedAt(payment) || null,
      customer_name: customerNameFor({ row: { ...payment, customer_name: sale?.customer_name }, parentById, studentById }),
      phone: customerPhoneFor({ row: { ...payment, customer_phone: sale?.customer_phone }, parentById, studentById }),
      parent_id: payment.parent_id || sale?.parent_id || null,
      student_id: payment.student_id || sale?.student_id || null,
      description: payment.description || (sale ? saleDescription(sale) : 'תשלום'),
      payment_method: payment.payment_method || sale?.payment_method || (bucket === 'online' ? 'online' : ''),
      bucket,
      amount,
      status,
      counted: true,
      excluded_reason: null,
      sale_id: sale?.id || payment.pos_sale_id || null,
      payment_id: paymentId || null,
      payment_url: payment.payment_url || sale?.payment_url || null,
      items: sale ? saleItemLines(sale) : [],
      icount_doc_number: payment.icount_doc_number || sale?.icount_doc_number || null,
      has_charge_doc: Boolean(payment.icount_doc_url || payment.icount_doc_number || sale?.icount_doc_url || sale?.icount_doc_number),
      has_refund_doc: Boolean(payment.refund_doc_number || sale?.refund_doc_number),
    });
  }

  for (const sale of sales || []) {
    const status = String(sale?.status || '').trim().toLowerCase();
    const linkedPaymentCounted = sale?.payment_id && countedPaymentIds.has(String(sale.payment_id));
    const completedToday = COMPLETED_SALE_STATUSES.has(status)
      && !EXCLUDED_SALE_STATUSES.has(status)
      && israelDate(saleCompletedAt(sale)) === date;
    const refundedToday = status === 'refunded' && israelDate(sale?.refunded_at || sale?.updated_at) === date;
    const cancelledToday = (status === 'cancelled' || status === 'canceled')
      && israelDate(sale?.cancelled_at || sale?.updated_at) === date;
    // חיוב פתוח הוא חוב עומד — מוצג תמיד, לא רק אם הקישור נוצר היום.
    const openCharge = status === 'pending_payment';
    if (linkedPaymentCounted || (!completedToday && !refundedToday && !cancelledToday && !openCharge)) continue;
    const amount = Number(sale?.total ?? sale?.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    const counted = completedToday;
    rows.push({
      id: `sale:${sale.id}`,
      kind: 'sale',
      at: (refundedToday && sale.refunded_at) || (cancelledToday && sale.cancelled_at) || saleCompletedAt(sale) || null,
      customer_name: customerNameFor({ row: sale, parentById, studentById }),
      phone: customerPhoneFor({ row: sale, parentById, studentById }),
      parent_id: sale.parent_id || null,
      student_id: sale.student_id || null,
      description: saleDescription(sale),
      payment_method: sale.payment_method || '',
      bucket: saleBucket(sale.payment_method),
      amount,
      status,
      counted,
      excluded_reason: counted ? null : (refundedToday ? 'refunded' : cancelledToday ? 'cancelled' : 'pending'),
      sale_id: sale.id,
      payment_id: sale.payment_id || saleByPaymentLink.get(String(sale.id))?.id || null,
      payment_url: sale.payment_url || saleByPaymentLink.get(String(sale.id))?.payment_url || null,
      items: saleItemLines(sale),
      icount_doc_number: sale.icount_doc_number || null,
      has_charge_doc: Boolean(sale.icount_doc_url || sale.icount_doc_number),
      has_refund_doc: Boolean(sale.refund_doc_url || sale.refund_doc_number),
    });
  }

  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const totals = calculateDailySales(sales, now, payments);
  const dayBefore = new Date((now instanceof Date ? now : new Date(now)).getTime() - 24 * 60 * 60 * 1000);
  return {
    ...totals,
    yesterdayTotal: calculateDailySales(sales, dayBefore, payments).total,
    openCharges: openChargesSummary(sales),
    rows,
  };
}
