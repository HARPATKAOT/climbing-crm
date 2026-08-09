import crypto from 'crypto';
import { supa } from './supa.js';
import { normalizeAttendingDates, participantPrice } from './activityDays.js';
import {
  activeRegistrations,
  leadSourceFromActivityType,
  remainingCapacity,
} from './activityRegistration.js';
import {
  resolveDeclarationTemplate,
  saveCrmParticipants,
} from './crmWaiverService.js';
import { declarationTemplateForActivity } from './activityDeclaration.js';
import { chargeAmount, normalizePriceIncludesVat } from './vat.js';
import {
  addPendingSpouse,
  assertNoExternalAdults,
  ensureAdultParticipantForParent,
  ensureHouseholdForParent,
  householdIdForParent,
  isStudentInHousehold,
} from './households.js';
import { participationEligibility, eligibilityStatusForRegistration } from './participationEligibility.js';
import { scopeForActivity } from './participationDocuments.js';
import { recordPolicyAcceptance, resolvePolicyFor } from './cancellationPolicies.js';

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
      phoneVerification: body.phoneVerification || body.phone_verification || null,
      evidenceContext: body.evidenceContext || body.evidence_context || null,
      policyAccepted: body.policyAccepted === true || body.policy_accepted === true,
      // הבחירה היא לכל ההרשמה ולא לכל משתתף: משפחה שרוצה ימים שונים לילדים
      // שונים נרשמת פעמיים.
      attendingDates: body.attending_dates || body.attendingDates || null,
      participants: body.participants.map((participant) => ({
        ...participant,
        type: participant.type === 'adult' ? 'adult' : 'child',
        name: clean(participant.name),
        reuse_health: participant.reuse_health === true
          || participant.reuseHealth === true
          || participant.reuse_declaration === true,
        reuse_health_document: participant.reuse_health_document,
        reuse_waiver: participant.reuse_waiver,
        defer_documents: participant.defer_documents === true || participant.deferDocuments === true,
        spouse_phone: clean(participant.spouse_phone || participant.spousePhone || participant.phone),
        parent_member_id: clean(participant.parent_member_id || participant.parentMemberId),
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
    phoneVerification: body.phoneVerification || body.phone_verification || null,
    evidenceContext: body.evidenceContext || body.evidence_context || null,
    policyAccepted: body.policyAccepted === true || body.policy_accepted === true,
    attendingDates: body.attending_dates || body.attendingDates || null,
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

/**
 * ההזמנה שכבר נרשמה תחת אותו מפתח מניעת-כפילות.
 *
 * המטמון המקומי הוא נתיב הקריאה הרגיל, אבל הוא יכול לאבד שורה שהמסד כן מחזיק:
 * הפעלה מחדש של השרת באמצע בקשה, או ניקוי שרץ לפני שכתיבה קודמת נחתה. המפתח
 * ייחודי במסד גם כשהמטמון שכח אותו, ולכן בלי לשאול את המסד כל ניסיון חוזר
 * מאותו טופס נחסם בשגיאת מפתח כפול — והלקוח תקוע בלי דרך לשלם.
 */
async function findOrderByKey(db, activityId, idempotencyKey, findDurable) {
  const local = (db.get('activity_registration_orders') || []).find(
    (order) => String(order.activity_id) === String(activityId)
      && order.idempotency_key === idempotencyKey
  );
  if (local) return local;
  const lookup = findDurable
    || (supa.isEnabled() ? (table, filters) => supa.findWhere(table, filters) : null);
  if (!lookup || typeof db.mergeLocal !== 'function') return null;
  const remote = await lookup('activity_registration_orders', {
    activity_id: activityId,
    idempotency_key: idempotencyKey,
  });
  const order = (remote || [])[0];
  if (!order) return null;
  // מחזירים את השורה למטמון כדי שגם הניקוי וגם בדיקת ה"כבר נרשם" יעבדו עליה
  // כרגיל. בלעדיה מחיקת השאריות מחפשת מזהה שאינו קיים מקומית ולא עושה כלום.
  db.mergeLocal('activity_registration_orders', [order]);
  const registrations = await lookup('activity_registrations', { order_id: order.id });
  if (registrations?.length) db.mergeLocal('activity_registrations', registrations);
  return order;
}

async function durable(persist, table, row) {
  const result = await persist(table, row);
  if (result?.ok === false) {
    // שגיאת מפתח כפול מגיעה מ-Postgres באנגלית ובשם האילוץ. הנרשם לא אמור
    // לראות את זה מול כפתור התשלום, וגם לא לנחש שרענון הדף פותר את זה.
    const message = /idempotency_key/.test(String(result.error || ''))
      ? 'ההרשמה הזאת כבר נקלטה במערכת. רעננו את הדף כדי להמשיך לתשלום.'
      : result.error || `שמירת ${table} נכשלה`;
    throw Object.assign(new Error(message), { status: 503 });
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
  findDurable,
} = {}) {
  return withActivityLock(activity.id, async () => {
    const normalized = normalizeGroupedRegistrationPayload(payload);
    if (!normalized.idempotencyKey) {
      throw Object.assign(new Error('חסר מפתח מניעת כפילות'), { status: 400 });
    }
    const existing = await findOrderByKey(db, activity.id, normalized.idempotencyKey, findDurable);
    if (existing) {
      const existingRegistrations = (db.get('activity_registrations') || []).filter(
        (registration) => registration.order_id === existing.id
      );
      // An order with no registrations is debris of an attempt that failed
      // between writing the order and writing what it ordered. Returning it as
      // a duplicate would brick the form's retry, so clear it and start over.
      const abandoned = !existingRegistrations.length && existing.payment_status !== 'paid';
      if (!abandoned) {
        return {
          duplicate: true,
          order: existing,
          registrations: existingRegistrations,
          paymentUrl: (db.get('payments') || []).find((payment) => payment.id === existing.payment_id)?.payment_url || null,
        };
      }
      const cleared = await db.deleteDurable('activity_registration_orders', existing.id);
      if (cleared?.ok === false && !cleared.notFound) {
        throw Object.assign(new Error('לא ניתן לחדש את ההרשמה כרגע — נסו שוב'), { status: 503 });
      }
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
    // אילו ימים ההרשמה מכסה. null = כל האירוע, וזה גם המצב של כל הרשמה
    // שנעשתה לפני שהאפשרות הזאת קיימה.
    const attendingDates = normalizeAttendingDates(activity, normalized.attendingDates);
    if (attendingDates && !(Number(activity.single_day_price) > 0)) {
      // לגבות אפס על ימים בודדים זו טעות שקטה שמגיעה עד לחשבונית.
      throw Object.assign(
        new Error('לא הוגדר מחיר ליום בודד באירוע הזה'),
        { status: 400 }
      );
    }
    const unitPrice = paid ? participantPrice(activity, attendingDates) : 0;
    const unitCharge = paid ? chargeAmount(unitPrice, includesVat) : 0;
    const total = unitCharge * count;
    const pendingPayment = paid && total > 0;
    const policyResolution = paid ? resolvePolicyFor(db, activity) : null;
    if (policyResolution && !normalized.policyAccepted) {
      throw Object.assign(new Error('יש לקרוא ולאשר את תנאי הביטול לפני התשלום'), { status: 400 });
    }
    const holdExpiresAt = pendingPayment
      ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString()
      : null;
    const orderId = makeId('aro');
    // What the participants are actually signing is decided by the event, not
    // by whichever declaration happens to be the default one.
    const template = declarationTemplateForActivity(db, activity, resolveDeclarationTemplate);
    const participationScope = scopeForActivity(activity);
    const leadSource = leadSourceFromActivityType(activity.type, activity.event_kind);
    const deferredInputs = normalized.participants.filter((participant) => participant.defer_documents);
    if (deferredInputs.some((participant) => participant.type !== 'adult')) {
      throw Object.assign(new Error('רק בן/בת זוג מבוגרים יכולים להשלים מסמכים לאחר התשלום'), { status: 400 });
    }
    const signingInputs = normalized.participants.filter((participant) => !participant.defer_documents);

    // The order row is written the moment the parent exists — before any
    // declaration or waiver. Those documents carry order_id, and the database
    // enforces the reference: writing them first is exactly the failure this
    // ordering prevents.
    let order = null;
    let household = null;
    const persistOrderFirst = async ({ parent }) => {
      household = await ensureHouseholdForParent(db, persist, parent.id);
      order = db.insert('activity_registration_orders', {
        id: orderId,
        activity_id: activity.id,
        parent_id: parent.id,
        household_id: household.id,
        payer_person_id: parent.id,
        idempotency_key: normalized.idempotencyKey,
        participant_count: count,
        unit_price: unitPrice,
        unit_charge: unitCharge,
        price_includes_vat: includesVat,
        total_amount: total,
        payment_status: pendingPayment ? 'pending' : 'not_required',
        status: pendingPayment ? 'pending_payment' : 'confirmed',
        payment_id: null,
        cancellation_acceptance_id: null,
        policy_snapshot: policyResolution?.snapshot || null,
        attending_dates: attendingDates,
        hold_expires_at: holdExpiresAt,
        updated_at: new Date().toISOString(),
      });
      await durable(persist, 'activity_registration_orders', order);
    };

    // Any failure between the order write and its registrations would leave an
    // order that ordered nothing; delete it so the form can simply try again.
    let crm;
    try {
      crm = await saveCrmParticipants({
        db,
        persist,
        parent: normalized.parent,
        participants: signingInputs,
        template,
        activityId: activity.id,
        orderId,
        participationScope,
        phoneVerification: normalized.phoneVerification,
        evidenceContext: normalized.evidenceContext,
        allowEmptyParticipants: signingInputs.length === 0,
        source: leadSource,
        onStudentCreated,
        onStudentStatusChanged,
        onParentReady: persistOrderFirst,
      });

      assertNoExternalAdults(db, {
        parent: crm.parent,
        participants: signingInputs,
        householdId: household.id,
      });

      for (const input of deferredInputs) {
        let student = input.id ? db.getOne('students', input.id) : null;
        let profileStatus = 'complete';
        if (!student && input.parent_member_id) {
          const memberParent = db.getOne('parents', input.parent_member_id);
          const memberHouseholdId = householdIdForParent(db, memberParent?.id);
          if (!memberParent || memberHouseholdId !== household.id) {
            throw Object.assign(new Error('בן/בת הזוג אינם משויכים לתיק המשפחה'), { status: 403 });
          }
          const adult = await ensureAdultParticipantForParent(db, persist, {
            householdId: household.id,
            parent: memberParent,
            profileStatus: 'pending_profile',
            source: leadSource,
          });
          student = adult.student;
          profileStatus = adult.member.profile_status;
        }
        if (!student && input.spouse_phone) {
          const spouse = await addPendingSpouse(db, persist, {
            householdId: household.id,
            name: input.name,
            phone: input.spouse_phone,
            source: leadSource,
          });
          const adult = await ensureAdultParticipantForParent(db, persist, {
            householdId: household.id,
            parent: spouse.parent,
            profileStatus: spouse.member.profile_status,
            source: leadSource,
          });
          student = adult.student;
          profileStatus = adult.member.profile_status;
        }
        if (!student?.id || student.isAdult !== true || !isStudentInHousehold(db, household.id, student.id)) {
          throw Object.assign(new Error('אפשר לדחות מסמכים רק עבור בן/בת זוג מתיק המשפחה'), { status: 403 });
        }
        crm.participants.push({
          input,
          type: 'adult',
          name: student.name || input.name,
          student,
          declaration: null,
          healthDeclaration: null,
          waiver: null,
          profileStatus,
        });
      }

      // New children created above are now part of the explicit household too.
      await ensureHouseholdForParent(db, persist, crm.parent.id);
      for (const participant of crm.participants) {
        if (!isStudentInHousehold(db, household.id, participant.student?.id)) {
          throw Object.assign(new Error('אפשר לרשום ולשלם רק עבור בני המשפחה בתיק'), { status: 403 });
        }
      }
    } catch (error) {
      // The order exists but nothing was registered under it. Remove it so the
      // same idempotency key can try again; if the removal itself fails, the
      // debris check above clears it on the next attempt.
      if (order) {
        try {
          await db.deleteDurable('activity_registration_orders', order.id);
        } catch {
          // best effort — the retry path handles what remains
        }
      }
      throw error;
    }

    if (typeof db.updateParentBroadcastLists === 'function') {
      db.updateParentBroadcastLists(crm.parent.id, normalized.subscriptions);
    }

    if (policyResolution) {
      const acceptance = await recordPolicyAcceptance(db, persist, {
        ...policyResolution,
        parentId: crm.parent.id,
        activityId: activity.id,
        orderId: order.id,
        acceptedVia: 'online',
      });
      order = db.update('activity_registration_orders', order.id, {
        cancellation_acceptance_id: acceptance?.id || null,
        updated_at: new Date().toISOString(),
      }) || order;
      await durable(persist, 'activity_registration_orders', order);
    }

    const registrations = [];
    for (const participant of crm.participants) {
      const eligibility = participationEligibility(db, {
        studentId: participant.student?.id,
        scope: participationScope,
      });
      const documentStatus = eligibilityStatusForRegistration(eligibility, {
        profileComplete: participant.profileStatus !== 'pending_profile',
      });
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
        participation_waiver_id: participant.waiver?.id || null,
        document_status: documentStatus,
        status: pendingPayment ? 'pending_payment' : 'confirmed',
        hold_expires_at: holdExpiresAt,
        payment_status: pendingPayment ? 'pending' : 'not_required',
        amount: unitCharge,
        attending_dates: attendingDates,
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
        // מספר הימים נכנס לתיאור כדי שהחשבונית תסביר למה חויב פחות מהמחיר
        // המלא — בלי זה לקוח שקנה יומיים מקבל מסמך שנראה כמו טעות.
        description: `הרשמה: ${activity.name} — ${count} משתתפים`
          + (attendingDates ? ` · ${attendingDates.length} ימים` : ''),
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
