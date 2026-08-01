import crypto from 'crypto';
import {
  activeRegistrations,
  leadSourceFromActivityType,
  remainingCapacity,
} from './activityRegistration.js';
import {
  resolveDefaultDeclarationTemplate,
  saveCrmParticipants,
} from './crmWaiverService.js';
import { chargeAmount, normalizePriceIncludesVat } from './vat.js';

const activityLocks = new Map();
const HOLD_MINUTES = 20;

// Serializes capacity checks inside one Node process. The database unique key
// prevents duplicate idempotency keys across instances; a database transaction
// or advisory-lock RPC is still required for strict cross-instance capacity.
export function withActivityLock(activityId, work) {
  const key = String(activityId);
  const previous = activityLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  activityLocks.set(key, current);
  return current.finally(() => {
    if (activityLocks.get(key) === current) activityLocks.delete(key);
  });
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function clean(value) {
  return String(value || '').trim();
}

/** Activity registration: all mailing lists are optional (unlike class onboarding). */
export function normalizeSubscriptions(raw = {}) {
  const subscriptions = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return subscriptions;
  }
  for (const [key, value] of Object.entries(raw)) {
    subscriptions[String(key)] = value === true || value === 'true' || value === 1 || value === '1';
  }
  return subscriptions;
}

export function normalizeGroupedRegistrationPayload(body = {}) {
  if (Array.isArray(body.participants)) {
    return {
      idempotencyKey: clean(body.idempotency_key || body.idempotencyKey),
      parent: body.parent || {},
      subscriptions: normalizeSubscriptions(body.subscriptions),
      participants: body.participants.map((participant) => ({
        ...participant,
        type: participant.type === 'adult' ? 'adult' : 'child',
        name: clean(participant.name),
        reuse_health: participant.reuse_health === true
          || participant.reuseHealth === true
          || participant.reuse_declaration === true,
      })),
    };
  }

  // Legacy one-person shape remains accepted, but declaration fields are still mandatory.
  return {
    idempotencyKey: clean(body.idempotency_key || body.idempotencyKey),
    parent: {
      name: clean(body.parent_name || body.participant_name || body.name),
      phone: clean(body.phone),
      email: clean(body.email),
    },
    subscriptions: normalizeSubscriptions(body.subscriptions),
    participants: [{
      type: body.participant_type === 'adult' ? 'adult' : 'child',
      name: clean(body.participant_name || body.name),
      birthDate: clean(body.birthDate || body.birth_date),
      answers: body.answers || {},
      waiverAccepted: body.waiverAccepted,
      signature: body.signature || '',
      notes: body.notes || '',
      reuse_health: body.reuse_health === true || body.reuseHealth === true,
    }],
  };
}

async function durable(persist, table, row) {
  const result = await persist(table, row);
  if (result?.ok === false) {
    throw Object.assign(new Error(result.error || `שמירת ${table} נכשלה`), { status: 503 });
  }
}

export async function registerActivityGroup({
  db,
  persist,
  activity,
  payload,
  createPaymentUrl,
  onStudentCreated,
  onStudentStatusChanged,
} = {}) {
  return withActivityLock(activity.id, async () => {
    const normalized = normalizeGroupedRegistrationPayload(payload);
    if (!normalized.idempotencyKey) {
      throw Object.assign(new Error('חסר מפתח מניעת כפילות'), { status: 400 });
    }
    const existing = (db.get('activity_registration_orders') || []).find(
      (order) =>
        String(order.activity_id) === String(activity.id) &&
        order.idempotency_key === normalized.idempotencyKey
    );
    if (existing) {
      return {
        duplicate: true,
        order: existing,
        registrations: (db.get('activity_registrations') || []).filter(
          (registration) => registration.order_id === existing.id
        ),
        paymentUrl: (db.get('payments') || []).find((payment) => payment.id === existing.payment_id)?.payment_url || null,
      };
    }

    const count = normalized.participants.length;
    const remaining = remainingCapacity(activity, activeRegistrations(db, activity.id));
    if (remaining != null && count > remaining) {
      throw Object.assign(new Error(`נותרו רק ${remaining} מקומות פנויים`), { status: 409 });
    }

    const mode = activity.registration_mode || (
      activity.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
    );
    const paid = mode === 'paid_per_participant';
    const includesVat = normalizePriceIncludesVat(activity.price_includes_vat);
    const unitPrice = paid ? Math.max(0, Number(activity.price) || 0) : 0;
    const unitCharge = paid ? chargeAmount(unitPrice, includesVat) : 0;
    const total = unitCharge * count;
    const pendingPayment = paid && total > 0;
    const holdExpiresAt = pendingPayment
      ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()
      : null;
    const orderId = makeId('aro');
    const template = resolveDefaultDeclarationTemplate(db);
    const leadSource = leadSourceFromActivityType(activity.type, activity.event_kind);
    const crm = await saveCrmParticipants({
      db,
      persist,
      parent: normalized.parent,
      participants: normalized.participants,
      template,
      activityId: activity.id,
      orderId,
      source: leadSource,
      onStudentCreated,
      onStudentStatusChanged,
    });

    if (typeof db.updateParentBroadcastLists === 'function') {
      db.updateParentBroadcastLists(crm.parent.id, normalized.subscriptions);
    }

    let order = db.insert('activity_registration_orders', {
      id: orderId,
      activity_id: activity.id,
      parent_id: crm.parent.id,
      idempotency_key: normalized.idempotencyKey,
      participant_count: count,
      unit_price: unitPrice,
      unit_charge: unitCharge,
      price_includes_vat: includesVat,
      total_amount: total,
      payment_status: pendingPayment ? 'pending' : 'not_required',
      status: pendingPayment ? 'pending_payment' : 'confirmed',
      payment_id: null,
      hold_expires_at: holdExpiresAt,
      updated_at: new Date().toISOString(),
    });
    await durable(persist, 'activity_registration_orders', order);

    const registrations = [];
    for (const participant of crm.participants) {
      const registration = db.insert('activity_registrations', {
        activity_id: activity.id,
        order_id: order.id,
        student_id: participant.student?.id || null,
        parent_id: crm.parent.id,
        participant_type: participant.type,
        participant_name: participant.name,
        phone: crm.parent.phone || '',
        email: crm.parent.email || '',
        health_declaration_id: participant.declaration?.id || null,
        status: pendingPayment ? 'pending_payment' : 'confirmed',
        hold_expires_at: holdExpiresAt,
        payment_status: pendingPayment ? 'pending' : 'not_required',
        amount: unitCharge,
        paid_at: null,
        payment_id: null,
        updated_at: new Date().toISOString(),
      });
      await durable(persist, 'activity_registrations', registration);
      registrations.push(registration);
    }

    let paymentUrl = null;
    let payment = null;
    if (pendingPayment) {
      payment = db.insert('payments', {
        parent_id: crm.parent.id,
        student_id: null,
        amount: total,
        description: `הרשמה: ${activity.name} — ${count} משתתפים`,
        status: 'pending',
        payment_url: null,
        activity_id: activity.id,
        activity_registration_order_id: order.id,
        icount_client_id: null,
        icount_doc_id: null,
        icount_doc_number: null,
        icount_doctype: null,
        paid_at: null,
        updated_at: new Date().toISOString(),
      });
      paymentUrl = await createPaymentUrl({
        payment,
        order,
        parent: crm.parent,
        amount: total,
        activity,
      });
      payment = db.update('payments', payment.id, {
        payment_url: paymentUrl,
        updated_at: new Date().toISOString(),
      }) || payment;
      await durable(persist, 'payments', payment);
      order = db.update('activity_registration_orders', order.id, {
        payment_id: payment.id,
        updated_at: new Date().toISOString(),
      }) || order;
      await durable(persist, 'activity_registration_orders', order);
      for (const registration of registrations) {
        Object.assign(registration, { payment_id: payment.id });
        db.update('activity_registrations', registration.id, {
          payment_id: payment.id,
          updated_at: new Date().toISOString(),
        });
        await durable(persist, 'activity_registrations', registration);
      }
    }

    return { duplicate: false, order, registrations, payment, paymentUrl, crm };
  });
}

export async function markRegistrationOrderPaid({ db, persist, orderId, paidAt } = {}) {
  const order = db.getOne('activity_registration_orders', orderId);
  if (!order) return { matched: false };
  if (order.status === 'confirmed' && order.payment_status === 'paid') {
    return { matched: true, duplicate: true, order };
  }
  const timestamp = paidAt || new Date().toISOString();
  const updatedOrder = db.update('activity_registration_orders', order.id, {
    status: 'confirmed',
    payment_status: 'paid',
    hold_expires_at: null,
    updated_at: timestamp,
  }) || order;
  await durable(persist, 'activity_registration_orders', updatedOrder);
  const registrations = (db.get('activity_registrations') || []).filter(
    (registration) => registration.order_id === order.id
  );
  for (const registration of registrations) {
    const updated = db.update('activity_registrations', registration.id, {
      status: 'confirmed',
      payment_status: 'paid',
      paid_at: registration.paid_at || timestamp,
      hold_expires_at: null,
      updated_at: timestamp,
    }) || registration;
    await durable(persist, 'activity_registrations', updated);
  }
  return { matched: true, duplicate: false, order: updatedOrder, registrations };
}

export async function markHostedActivityPaid({ db, persist, activityId, paymentId, paidAt } = {}) {
  const activity = db.getOne('activities', activityId);
  if (!activity) return { matched: false };
  if (activity.payment_status === 'paid' && (!paymentId || activity.host_payment_id === paymentId)) {
    return { matched: true, duplicate: true, activity };
  }
  const updated = db.update('activities', activity.id, {
    payment_status: 'paid',
    host_payment_id: paymentId || activity.host_payment_id || null,
    host_paid_at: paidAt || new Date().toISOString(),
  }) || activity;
  await durable(persist, 'activities', updated);
  return { matched: true, duplicate: false, activity: updated };
}
