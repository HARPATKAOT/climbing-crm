/**
 * מתעניינים באירוע — אנשים ששובצו לאירוע לפני שנרשמו ושילמו.
 *
 * הרשומות נשמרות באוסף הכללי `activity_interest` (kv_collections), כך שאין
 * צורך במיגרציית SQL ואין זליגה לטבלת ההרשמות. רשומה נסגרת ("converted")
 * ברגע שנוצרת הרשמה אמיתית — ידנית על ידי הצוות או דרך דף ההרשמה הציבורי.
 */

import { leadSourceFromActivityType } from './activityRegistration.js';
import { chargeAmount, normalizePriceIncludesVat } from './vat.js';

export const INTEREST_COLLECTION = 'activity_interest';

export const INTEREST_OPEN = 'interested';
export const INTEREST_CONVERTED = 'converted';
export const INTEREST_CANCELLED = 'cancelled';

/** אוצר המילים היחיד לסטטוס תשלום של הרשמה. מיוצא כדי שקוראים אחרים
 *  (למשל שכבת הסוכן) לא ימציאו ערך שנפילתו היא ברירת מחדל שקטה. */
export const REGISTRATION_PAYMENT_STATUSES = new Set(['paid', 'pending', 'not_required']);

function clean(value) {
  return String(value ?? '').trim();
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Same rule as the rest of the CRM: a write that did not reach the durable store failed. */
async function requireDurable(persist, table, record) {
  const result = await persist(table, record);
  if (result?.ok === false) {
    throw Object.assign(new Error(result.error || `שמירת ${table} נכשלה`), { status: 503 });
  }
  return record;
}

/** Last 9 digits — the same person under 050… / 972… / +972-… forms. */
export function phoneKey(phone) {
  const digits = clean(phone).replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
}

export function samePhone(a, b) {
  const left = phoneKey(a);
  const right = phoneKey(b);
  return left.length >= 9 && left === right;
}

export function normalizedName(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('he');
}

/** Loose name match — staff often slot a first name and the parent registers a full name. */
export function namesMatch(a, b) {
  const left = normalizedName(a);
  const right = normalizedName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

export function normalizeInterestInput(body = {}) {
  const name = clean(body.name || body.participant_name);
  if (!name) throw badRequest('שם המתעניין חובה');
  return {
    name,
    phone: clean(body.phone),
    email: clean(body.email),
    parent_id: body.parent_id ? String(body.parent_id) : null,
    student_id: body.student_id ? String(body.student_id) : null,
    participant_type: body.participant_type === 'adult' ? 'adult' : 'child',
    notes: clean(body.notes),
  };
}

export function interestRows(db) {
  const rows = db.get(INTEREST_COLLECTION);
  return Array.isArray(rows) ? rows : [];
}

export function listInterest(db, activityId, { includeClosed = false } = {}) {
  return interestRows(db)
    .filter((row) => String(row?.activity_id || '') === String(activityId))
    .filter((row) => includeClosed || String(row.status || INTEREST_OPEN) === INTEREST_OPEN)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

export function openInterest(db, activityId) {
  return listInterest(db, activityId);
}

/** Enrich for the staff panel: linked customer name comes from the CRM, not the snapshot. */
export function enrichInterest(db, row) {
  const parent = row.parent_id
    ? (db.get('parents') || []).find((p) => String(p.id) === String(row.parent_id))
    : null;
  return {
    ...row,
    parent_name: parent?.name || '',
    phone: row.phone || parent?.phone || '',
  };
}

export async function addInterest({ db, persist, activityId, input } = {}) {
  const now = new Date().toISOString();
  const row = db.insert(INTEREST_COLLECTION, {
    activity_id: String(activityId),
    name: input.name,
    phone: input.phone,
    email: input.email,
    parent_id: input.parent_id,
    student_id: input.student_id,
    participant_type: input.participant_type,
    notes: input.notes,
    status: INTEREST_OPEN,
    registration_id: null,
    converted_at: null,
    created_at: now,
    updated_at: now,
  });
  await requireDurable(persist, INTEREST_COLLECTION, row);
  return row;
}

export async function updateInterest({ db, persist, row, patch } = {}) {
  const updated = db.update(INTEREST_COLLECTION, row.id, {
    ...patch,
    updated_at: new Date().toISOString(),
  }) || row;
  await requireDurable(persist, INTEREST_COLLECTION, updated);
  return updated;
}

/**
 * Which open rows does a fresh registration close?
 * Name / student matches first; a single lonely row of the same customer is the
 * fallback so the everyday "one person, one slot" case closes itself.
 */
export function matchInterestForRegistrations(rows, { parentId, phone, registrations = [] } = {}) {
  const open = (rows || []).filter(
    (row) => String(row.status || INTEREST_OPEN) === INTEREST_OPEN
  );
  if (!open.length) return [];

  const belongsToCustomer = (row) =>
    (parentId && String(row.parent_id || '') === String(parentId)) ||
    (phone && samePhone(row.phone, phone));

  const matches = new Map();
  const taken = new Set();

  for (const registration of registrations) {
    const hit = open.find((row) => {
      if (taken.has(row.id)) return false;
      if (registration.student_id && String(row.student_id || '') === String(registration.student_id)) {
        return true;
      }
      if (!namesMatch(row.name, registration.participant_name)) return false;
      // A name-only match must still belong to the registering customer,
      // unless the row was never linked to anyone.
      return belongsToCustomer(row) || (!row.parent_id && !row.phone);
    });
    if (hit) {
      taken.add(hit.id);
      matches.set(hit.id, { row: hit, registration });
    }
  }

  if (!matches.size) {
    const customerRows = open.filter(belongsToCustomer);
    if (customerRows.length === 1 && registrations.length) {
      matches.set(customerRows[0].id, {
        row: customerRows[0],
        registration: registrations[0],
      });
    }
  }

  return [...matches.values()];
}

/** Best-effort: close the interest rows a public registration just fulfilled. */
export async function closeInterestForRegistrations({
  db,
  persist,
  activityId,
  parentId,
  phone,
  registrations = [],
} = {}) {
  const matched = matchInterestForRegistrations(listInterest(db, activityId), {
    parentId,
    phone,
    registrations,
  });
  const closed = [];
  for (const { row, registration } of matched) {
    closed.push(await updateInterest({
      db,
      persist,
      row,
      patch: {
        status: INTEREST_CONVERTED,
        registration_id: registration?.id || null,
        parent_id: row.parent_id || parentId || null,
        student_id: row.student_id || registration?.student_id || null,
        converted_at: new Date().toISOString(),
      },
    }));
  }
  return closed;
}

export function normalizeConversionPaymentStatus(value, activity) {
  const requested = clean(value);
  if (REGISTRATION_PAYMENT_STATUSES.has(requested)) return requested;
  const mode = activity?.registration_mode || (
    activity?.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
  );
  return mode === 'paid_per_participant' ? 'paid' : 'not_required';
}

export function registrationAmount(activity, paymentStatus) {
  const mode = activity?.registration_mode || (
    activity?.collect_registration_payment ? 'paid_per_participant' : 'host_pays'
  );
  if (mode !== 'paid_per_participant' || paymentStatus === 'not_required') return 0;
  return chargeAmount(
    Math.max(0, Number(activity?.price) || 0),
    normalizePriceIncludesVat(activity?.price_includes_vat)
  );
}

/**
 * משתתף רשום חדש, בלי לעבור דרך רשימת המתעניינים.
 * No health declaration is invented here — the row shows "חסרה הצהרה" until the
 * customer signs one, exactly like any participant added by hand.
 */
export async function insertRegistration({
  db,
  persist,
  activity,
  parent,
  participant = {},
  paymentStatus,
  note = '',
} = {}) {
  const status = normalizeConversionPaymentStatus(paymentStatus, activity);
  const now = new Date().toISOString();
  const registration = db.insert('activity_registrations', {
    activity_id: activity.id,
    order_id: null,
    student_id: participant.student_id || null,
    parent_id: parent.id,
    participant_type: participant.participant_type === 'adult' ? 'adult' : 'child',
    participant_name: participant.name,
    phone: participant.phone || parent.phone || '',
    email: participant.email || parent.email || '',
    health_declaration_id: null,
    status: 'confirmed',
    hold_expires_at: null,
    payment_status: status,
    amount: registrationAmount(activity, status),
    paid_at: status === 'paid' ? now : null,
    payment_id: null,
    notes: [participant.notes, note].filter(Boolean).join(' · '),
    updated_at: now,
  });
  await requireDurable(persist, 'activity_registrations', registration);
  return registration;
}

/**
 * Staff conversion: מתעניין → משתתף רשום.
 */
export async function convertInterestToRegistration({
  db,
  persist,
  activity,
  row,
  paymentStatus,
} = {}) {
  if (String(row.status || INTEREST_OPEN) !== INTEREST_OPEN) {
    throw badRequest('המתעניין כבר הועבר לרשומים');
  }

  let parent = row.parent_id
    ? (db.get('parents') || []).find((p) => String(p.id) === String(row.parent_id))
    : null;
  if (!parent && row.phone) {
    parent = db.upsertParentByPhone(row.name, row.phone, row.email, {
      source: leadSourceFromActivityType(activity.type),
    });
    await requireDurable(persist, 'parents', parent);
  }
  if (!parent) {
    throw badRequest('יש לקשר לקוח או למלא טלפון לפני העברה לרשומים');
  }

  const now = new Date().toISOString();
  const registration = await insertRegistration({
    db,
    persist,
    activity,
    parent,
    participant: {
      student_id: row.student_id,
      participant_type: row.participant_type,
      name: row.name,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
    },
    paymentStatus,
    note: 'נרשם ידנית מרשימת המתעניינים',
  });

  const closed = await updateInterest({
    db,
    persist,
    row,
    patch: {
      status: INTEREST_CONVERTED,
      parent_id: parent.id,
      registration_id: registration.id,
      converted_at: now,
    },
  });

  return { registration, interest: closed, parent };
}
