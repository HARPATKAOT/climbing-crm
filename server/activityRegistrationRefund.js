import { normalizeHostPaymentStatus } from './activityRegistration.js';
import { chargeAmount, normalizePriceIncludesVat } from './vat.js';

export function summarizeHostPayment(db, activity) {
  if (!activity) return null;
  const paymentStatus = normalizeHostPaymentStatus(activity.payment_status);
  let payment = activity.host_payment_id
    ? db.getOne('payments', activity.host_payment_id)
    : null;
  if (!payment) {
    payment = (db.get('payments') || []).find(
      (row) =>
        row.activity_host_payment &&
        String(row.activity_id) === String(activity.id)
    ) || null;
  }

  const includesVat = normalizePriceIncludesVat(
    payment?.price_includes_vat ?? activity.price_includes_vat
  );
  const entered = Number(activity.price) || 0;
  const amount = Number(payment?.amount) > 0
    ? Number(payment.amount)
    : chargeAmount(entered, includesVat);
  const docnum = payment?.icount_doc_number || null;
  const doctype = payment?.icount_doctype || null;
  const docId = payment?.icount_doc_id || null;
  const docUrl = payment?.icount_doc_url || null;
  const paidAt = payment?.paid_at || activity.host_paid_at || null;
  const paymentRecordStatus = payment?.status || null;

  return {
    payment_status: paymentStatus,
    payment_id: payment?.id || null,
    amount,
    entered_amount: entered,
    price_includes_vat: includesVat,
    description: payment?.description || (activity.name ? `תשלום אירוע: ${activity.name}` : ''),
    paid_at: paidAt,
    status: paymentRecordStatus || (paymentStatus === 'paid' ? 'paid' : 'pending'),
    icount_doc_id: docId,
    icount_doc_number: docnum,
    icount_doctype: doctype,
    icount_doc_url: docUrl,
    refundable:
      paymentStatus === 'paid' &&
      paymentRecordStatus !== 'refunded' &&
      paymentRecordStatus !== 'cancelled' &&
      !!docnum,
  };
}

/**
 * Resolve which payment + sibling registrations are affected when refunding
 * one participant. Group orders share one payment / one iCount document.
 */

function isActiveish(registration) {
  const status = String(registration?.status || '');
  if (['cancelled', 'canceled', 'refunded'].includes(status)) return false;
  return true;
}

export function findPaymentForRegistration(db, registration) {
  if (!registration) return null;
  if (registration.payment_id) {
    const byId = db.getOne('payments', registration.payment_id);
    if (byId) return byId;
  }
  if (registration.order_id) {
    const order = db.getOne('activity_registration_orders', registration.order_id);
    if (order?.payment_id) {
      const byOrder = db.getOne('payments', order.payment_id);
      if (byOrder) return byOrder;
    }
  }
  return (db.get('payments') || []).find(
    (payment) =>
      String(payment.activity_registration_id) === String(registration.id) ||
      (registration.order_id &&
        String(payment.activity_registration_order_id) === String(registration.order_id))
  ) || null;
}

export function registrationsSharingPayment(db, payment, activityId) {
  if (!payment?.id) return [];
  return (db.get('activity_registrations') || []).filter(
    (registration) =>
      String(registration.activity_id) === String(activityId) &&
      isActiveish(registration) &&
      (
        String(registration.payment_id) === String(payment.id) ||
        (registration.order_id &&
          String(
            db.getOne('activity_registration_orders', registration.order_id)?.payment_id || ''
          ) === String(payment.id))
      )
  );
}

export function buildRegistrationRefundPlan(db, { activity, registration } = {}) {
  if (!activity || !registration) {
    return { ok: false, error: 'חסרים נתוני אירוע או משתתף' };
  }
  if (String(registration.activity_id) !== String(activity.id)) {
    return { ok: false, error: 'המשתתף לא שייך לאירוע' };
  }
  if (['cancelled', 'canceled'].includes(String(registration.status || ''))) {
    return { ok: false, error: 'המשתתף כבר בוטל' };
  }
  if (String(registration.payment_status) === 'refunded') {
    return { ok: false, error: 'המשתתף כבר זוכה' };
  }
  if (String(registration.payment_status) !== 'paid') {
    return {
      ok: false,
      error: 'אין תשלום שולם למשתתף הזה — אפשר להסיר בלי זיכוי',
      code: 'not_paid',
    };
  }

  const payment = findPaymentForRegistration(db, registration);
  if (!payment) {
    return { ok: false, error: 'לא נמצא תשלום מקושר למשתתף' };
  }
  if (payment.status === 'refunded' || payment.status === 'cancelled') {
    return { ok: false, error: 'התשלום כבר זוכה או בוטל' };
  }
  if (!payment.icount_doc_number) {
    return {
      ok: false,
      error: 'לתשלום אין מספר מסמך במערכת החיוב — אי אפשר לזכות אוטומטית',
      code: 'missing_doc',
    };
  }

  const affected = registrationsSharingPayment(db, payment, activity.id);
  const names = affected.map((row) => row.participant_name || 'משתתף').filter(Boolean);

  return {
    ok: true,
    payment,
    order: registration.order_id
      ? db.getOne('activity_registration_orders', registration.order_id)
      : null,
    affectedRegistrations: affected.length ? affected : [registration],
    sharedPayment: affected.length > 1,
    participantNames: names.length ? names : [registration.participant_name || 'משתתף'],
    amount: Number(payment.amount) || 0,
    doctype: payment.icount_doctype || 'invrec',
    docnum: payment.icount_doc_number,
  };
}

export async function applyRegistrationRefundMarks({
  db,
  persist,
  plan,
  reason,
  cancellation,
  refundedBy,
} = {}) {
  const durable = async (table, row) => {
    if (!persist) return { ok: true };
    return persist(table, row);
  };
  const now = new Date().toISOString();
  const note = reason || 'זוכה על ידי צוות';
  const updatedRegs = [];

  for (const registration of plan.affectedRegistrations) {
    const updated = db.update('activity_registrations', registration.id, {
      status: 'cancelled',
      payment_status: 'refunded',
      notes: [registration.notes, note].filter(Boolean).join(' · '),
      updated_at: now,
    });
    if (updated) {
      await durable('activity_registrations', updated);
      updatedRegs.push(updated);
    }
  }

  if (plan.order?.id) {
    const updatedOrder = db.update('activity_registration_orders', plan.order.id, {
      status: 'cancelled',
      payment_status: 'refunded',
      updated_at: now,
    });
    if (updatedOrder) await durable('activity_registration_orders', updatedOrder);
  }

  const updatedPayment = db.update('payments', plan.payment.id, {
    status: 'refunded',
    refunded_at: now,
    refund_reason: note,
    refund_doc_number: cancellation?.docnum || null,
    refund_doctype: cancellation?.doctype || null,
    refunded_by: refundedBy || null,
    updated_at: now,
  });
  if (updatedPayment) await durable('payments', updatedPayment);

  return { registrations: updatedRegs, payment: updatedPayment };
}

export function buildHostRefundPlan(db, activity) {
  if (!activity) return { ok: false, error: 'האירוע לא נמצא' };
  if (normalizeHostPaymentStatus(activity.payment_status) !== 'paid') {
    return { ok: false, error: 'דמי ההזמנה לא מסומנים כשולמו' };
  }
  const payment = activity.host_payment_id
    ? db.getOne('payments', activity.host_payment_id)
    : (db.get('payments') || []).find(
      (row) =>
        row.activity_host_payment &&
        String(row.activity_id) === String(activity.id) &&
        row.status === 'paid'
    );
  if (!payment) {
    return { ok: false, error: 'לא נמצא תשלום מזמין מקושר' };
  }
  if (payment.status === 'refunded' || payment.status === 'cancelled') {
    return { ok: false, error: 'תשלום המזמין כבר זוכה' };
  }
  if (!payment.icount_doc_number) {
    return {
      ok: false,
      error: 'לתשלום אין מספר מסמך במערכת החיוב — אי אפשר לזכות אוטומטית',
      code: 'missing_doc',
    };
  }
  return {
    ok: true,
    payment,
    amount: Number(payment.amount) || 0,
    doctype: payment.icount_doctype || 'invrec',
    docnum: payment.icount_doc_number,
  };
}

export async function applyHostRefundMarks({
  db,
  persist,
  activity,
  payment,
  reason,
  cancellation,
  refundedBy,
} = {}) {
  const durable = async (table, row) => {
    if (!persist) return { ok: true };
    return persist(table, row);
  };
  const now = new Date().toISOString();
  const updatedPayment = db.update('payments', payment.id, {
    status: 'refunded',
    refunded_at: now,
    refund_reason: reason || 'זיכוי דמי הזמנה',
    refund_doc_number: cancellation?.docnum || null,
    refund_doctype: cancellation?.doctype || null,
    refunded_by: refundedBy || null,
    updated_at: now,
  });
  if (updatedPayment) await durable('payments', updatedPayment);

  const updatedActivity = db.update('activities', activity.id, {
    payment_status: 'unpaid',
    host_paid_at: null,
    updated_at: now,
  });
  if (updatedActivity) await durable('activities', updatedActivity);

  return { payment: updatedPayment, activity: updatedActivity };
}
