/**
 * Cancelling a whole activity, as opposed to removing one participant.
 *
 * A trip that falls through because of weather is one decision by us, not
 * fifteen decisions by fifteen people: everybody gets their money back in full
 * (`organizer_cancelled` in the cancellation policy is a 100% rule), and the
 * event stops being offered anywhere. What this module does is turn that one
 * decision into the list of iCount documents that actually have to be
 * cancelled — one per payment, not one per participant, because a group order
 * is a single document covering several names.
 */

import { activeRegistrations } from './activityRegistration.js';
import {
  buildRegistrationRefundPlan,
  summarizeHostPayment,
} from './activityRegistrationRefund.js';

const CANCELLED_STATUSES = ['cancelled', 'canceled'];

export function activityIsCancelled(activity) {
  if (!activity) return false;
  if (activity.cancelled) return true;
  return CANCELLED_STATUSES.includes(String(activity.status || '').toLowerCase());
}

export function activityIsArchived(activity) {
  return String(activity?.status || '').toLowerCase() === 'archived';
}

function participantLabel(registration) {
  return registration?.participant_name || registration?.name || 'משתתף';
}

/**
 * Everything the "cancel this activity" screen needs to show a number the
 * owner can approve before any money moves.
 *
 * @param {object} db
 * @param {object} activity
 * @param {(input: {payment: object, order: object|null, paidAmount: number,
 *   participantsCancelled: number}) => object} [review]
 *   Cancellation-policy review for one payment, already knowing that *we*
 *   cancelled. Injected because it lives next to the policy resolver in the
 *   server. Without it every refundable payment is treated as a full refund.
 */
export function summarizeActivityCancellation(db, activity, review = null) {
  const registrations = activeRegistrations(db, activity.id);
  // Anyone who was ever registered, including people already refunded. A
  // deleted activity would leave their row pointing at nothing — which is the
  // orphan we are guarding against, not only the live registrations.
  const everRegistered = (db.get('activity_registrations') || []).filter(
    (row) => String(row.activity_id) === String(activity.id)
  );
  const groups = new Map();
  const unpaid = [];
  const blocked = [];

  for (const registration of registrations) {
    const plan = buildRegistrationRefundPlan(db, { activity, registration });
    if (!plan.ok) {
      // Nothing was ever charged — the place is simply released.
      if (plan.code === 'not_paid') {
        unpaid.push({
          registration_id: registration.id,
          name: participantLabel(registration),
        });
        continue;
      }
      blocked.push({
        registration_id: registration.id,
        name: participantLabel(registration),
        reason: plan.error,
        code: plan.code || null,
      });
      continue;
    }

    const key = String(plan.payment.id);
    const existing = groups.get(key);
    if (existing) {
      if (!existing.registration_ids.includes(registration.id)) {
        existing.registration_ids.push(registration.id);
        existing.names.push(participantLabel(registration));
      }
      continue;
    }
    groups.set(key, {
      kind: 'registration',
      payment_id: plan.payment.id,
      docnum: plan.docnum,
      doctype: plan.doctype,
      amount: Number(plan.amount) || 0,
      registration_ids: [registration.id],
      names: [participantLabel(registration)],
      seed_registration_id: registration.id,
    });
  }

  // A payment whose policy would not give the full amount back must never be
  // swept along with the rest: cancelling the document in iCount refunds all of
  // it, and we would be handing back money the policy says we keep.
  const refundable = [];
  for (const group of groups.values()) {
    if (!review) {
      refundable.push(group);
      continue;
    }
    const payment = db.getOne('payments', group.payment_id);
    const outcome = review({
      payment,
      order: null,
      paidAmount: Number(payment?.amount) || group.amount,
      participantsCancelled: group.registration_ids.length,
    });
    if (outcome?.manual_partial_refund_required) {
      blocked.push({
        registration_id: group.seed_registration_id,
        name: group.names.join(', '),
        reason: 'מדיניות הביטול מחזירה סכום חלקי — יש לבצע את הזיכוי ידנית ב-iCount',
        code: 'manual_partial_refund_required',
        amount: Number(outcome?.recommendation?.amount) || 0,
      });
      continue;
    }
    refundable.push(group);
  }

  const host = summarizeHostPayment(db, activity);
  const hostGroup = host?.refundable
    ? {
        kind: 'host',
        payment_id: host.payment_id,
        docnum: host.icount_doc_number,
        doctype: host.icount_doctype || 'invrec',
        amount: Number(host.amount) || 0,
        registration_ids: [],
        names: [activity.host_name || activity.contact_name || 'מזמין האירוע'],
      }
    : null;
  if (hostGroup) refundable.push(hostGroup);

  const refundTotal = refundable.reduce((sum, group) => sum + (Number(group.amount) || 0), 0);

  return {
    activity_id: activity.id,
    activity_name: activity.name || '',
    already_cancelled: activityIsCancelled(activity),
    registrations_count: registrations.length,
    total_registrations: everRegistered.length,
    /** Nothing live to cancel, but a paper trail that must keep its event. */
    history_only: registrations.length === 0 && everRegistered.length > 0,
    participant_names: registrations.map(participantLabel),
    groups: refundable,
    refund_total: Math.round(refundTotal * 100) / 100,
    refund_documents: refundable.length,
    paid_participants: refundable
      .filter((group) => group.kind === 'registration')
      .reduce((sum, group) => sum + group.registration_ids.length, 0),
    host_refund: hostGroup ? { amount: hostGroup.amount, docnum: hostGroup.docnum } : null,
    unpaid,
    blocked,
    /** Nothing is owed and nobody was ever registered — plain deletion is honest. */
    deletable: everRegistered.length === 0 && !hostGroup && !host?.has_refund,
  };
}

/**
 * Registrations that are not covered by any refund document but still hold a
 * place. They are released when the activity is cancelled, without touching
 * money.
 */
export function registrationsToRelease(summary) {
  const ids = new Set();
  for (const row of summary.unpaid) ids.add(row.registration_id);
  for (const row of summary.blocked) ids.add(row.registration_id);
  return [...ids];
}

/**
 * Archiving keeps the activity as the parent of its registration/payment
 * history, but removes it from the working calendar. It is safe only when
 * nobody currently holds a place and there is no refund still to perform.
 */
export function activityCanBeArchived(summary) {
  return Number(summary?.registrations_count) === 0
    && Number(summary?.refund_total) === 0;
}
