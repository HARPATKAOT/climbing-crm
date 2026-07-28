/** Training equipment kit for kids: shoes rental, club shirt, chalk bag. */

import { randomBytes } from 'crypto';

export const EQUIPMENT_ITEM_TYPES = ['shoes', 'shirt', 'chalk_bag'];

export const EQUIPMENT_ITEM_LABELS = {
  shoes: 'נעלי טיפוס',
  shirt: 'חולצת חוג',
  chalk_bag: 'שק מגנזיום ומגנזיום',
};

export const EQUIPMENT_TEMPLATE_NAME = 'equipment_payment';

export const DEFAULT_EQUIPMENT_SETTINGS = {
  prices: {
    shoes: 150,
    shirt: 120,
    chalk_bag: 80,
  },
  shirt_sizes: ['6', '8', '10', '12', '14', 'XS', 'S', 'M', 'L'],
  rental_days: 182,
  price_includes_vat: true,
};

export function normalizeEquipmentSettings(raw = {}) {
  const base = DEFAULT_EQUIPMENT_SETTINGS;
  const pricesIn = raw.prices && typeof raw.prices === 'object' ? raw.prices : {};
  const prices = {
    shoes: Math.max(0, Number(pricesIn.shoes ?? base.prices.shoes) || 0),
    shirt: Math.max(0, Number(pricesIn.shirt ?? base.prices.shirt) || 0),
    chalk_bag: Math.max(0, Number(pricesIn.chalk_bag ?? base.prices.chalk_bag) || 0),
  };
  let shirtSizes = Array.isArray(raw.shirt_sizes) ? raw.shirt_sizes : base.shirt_sizes;
  shirtSizes = shirtSizes
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  if (!shirtSizes.length) shirtSizes = [...base.shirt_sizes];
  const rentalDays = Math.max(1, Number(raw.rental_days ?? base.rental_days) || base.rental_days);
  return {
    prices,
    shirt_sizes: shirtSizes,
    rental_days: rentalDays,
    price_includes_vat: raw.price_includes_vat !== false,
  };
}

export function isKidStudent(student) {
  if (!student) return false;
  if (student.isAdult === true || student.is_adult === true) return false;
  if (String(student.id || '').startsWith('parent:')) return false;
  if (student._parentOnly) return false;
  return true;
}

export function newEquipmentId(studentId, itemType) {
  return `eq-${studentId}-${itemType}`;
}

export function newCheckoutToken() {
  return randomBytes(18).toString('base64url');
}

/** Ensure the three kit rows exist for a kid. Returns the rows (existing + created). */
export function ensureStudentEquipment({ db, student, persist } = {}) {
  if (!db || !isKidStudent(student)) return [];
  const parentId = student.parentId || student.parent_id || null;
  const existing = (Array.isArray(db.get('student_equipment')) ? db.get('student_equipment') : []).filter(
    (row) => row && row.student_id === student.id
  );
  const byType = new Map(existing.map((row) => [row.item_type, row]));
  const now = new Date().toISOString();
  const result = [];

  for (const itemType of EQUIPMENT_ITEM_TYPES) {
    let row = byType.get(itemType);
    if (!row) {
      row = db.insert('student_equipment', {
        id: newEquipmentId(student.id, itemType),
        student_id: student.id,
        parent_id: parentId,
        item_type: itemType,
        payment_status: 'unpaid',
        fulfillment_status: 'pending',
        shirt_size: null,
        paid_at: null,
        given_at: null,
        given_by: null,
        payment_id: null,
        rental_starts_at: null,
        rental_ends_at: null,
        created_at: now,
        updated_at: now,
      });
      if (typeof persist === 'function') {
        Promise.resolve(persist('student_equipment', row)).catch(() => {});
      }
    } else if (parentId && !row.parent_id) {
      row = db.update('student_equipment', row.id, { parent_id: parentId }) || row;
      if (typeof persist === 'function') {
        Promise.resolve(persist('student_equipment', row)).catch(() => {});
      }
    }
    result.push(row);
  }

  return result.sort(
    (a, b) => EQUIPMENT_ITEM_TYPES.indexOf(a.item_type) - EQUIPMENT_ITEM_TYPES.indexOf(b.item_type)
  );
}

export function addDaysIso(fromIso, days) {
  const start = fromIso ? new Date(fromIso) : new Date();
  if (Number.isNaN(start.getTime())) start.setTime(Date.now());
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + Number(days));
  return end.toISOString();
}

/**
 * Mark selected equipment items as paid after checkout / webhook.
 * @returns {{ updated: object[], errors: string[] }}
 */
export function markEquipmentItemsPaid({
  db,
  persist,
  studentId,
  itemTypes = [],
  shirtSize = null,
  paymentId = null,
  rentalDays = DEFAULT_EQUIPMENT_SETTINGS.rental_days,
  paidAt = null,
} = {}) {
  const errors = [];
  const updated = [];
  const student = db.getOne('students', studentId);
  if (!isKidStudent(student)) {
    return { updated, errors: ['המתאמן אינו ילד או לא נמצא'] };
  }

  const rows = ensureStudentEquipment({ db, student, persist });
  const wanted = new Set(
    (Array.isArray(itemTypes) ? itemTypes : [])
      .map((t) => String(t || '').trim())
      .filter((t) => EQUIPMENT_ITEM_TYPES.includes(t))
  );
  if (!wanted.size) return { updated, errors: ['לא נבחרו פריטי ציוד'] };

  const when = paidAt || new Date().toISOString();

  for (const row of rows) {
    if (!wanted.has(row.item_type)) continue;
    if (row.payment_status === 'paid' || row.payment_status === 'own' || row.payment_status === 'declined') {
      // Still allow shirt size update if missing on already-paid rows
      if (row.payment_status === 'paid' && row.item_type === 'shirt' && shirtSize && !row.shirt_size) {
        const patched = db.update('student_equipment', row.id, {
          shirt_size: String(shirtSize).trim(),
        });
        if (patched) {
          updated.push(patched);
          if (typeof persist === 'function') {
            Promise.resolve(persist('student_equipment', patched)).catch(() => {});
          }
        }
      }
      continue;
    }

    const patch = {
      payment_status: 'paid',
      paid_at: when,
      payment_id: paymentId || row.payment_id || null,
      fulfillment_status: row.fulfillment_status === 'given' ? 'given' : 'pending',
    };

    if (row.item_type === 'shirt' && shirtSize) {
      patch.shirt_size = String(shirtSize).trim();
    }
    if (row.item_type === 'shoes') {
      patch.rental_starts_at = when;
      patch.rental_ends_at = addDaysIso(when, rentalDays);
    }

    const next = db.update('student_equipment', row.id, patch);
    if (next) {
      updated.push(next);
      if (typeof persist === 'function') {
        Promise.resolve(persist('student_equipment', next)).catch(() => {});
      }
    }
  }

  return { updated, errors };
}

/** Reset shoe rental cycle → unpaid + pending (ready for next half-year). */
export function resetShoeRental({ db, persist, rowId, givenBy = null } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.item_type !== 'shoes') return { ok: false, error: 'איפוס מחזור זמין רק לנעליים' };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'unpaid',
    fulfillment_status: 'pending',
    paid_at: null,
    given_at: null,
    given_by: givenBy || null,
    payment_id: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

export function markEquipmentGiven({ db, persist, rowId, givenBy = null } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.payment_status !== 'paid') {
    return { ok: false, error: 'אפשר לסמן מסירה רק אחרי תשלום' };
  }
  if (row.fulfillment_status === 'given') return { ok: true, row };

  const next = db.update('student_equipment', row.id, {
    fulfillment_status: 'given',
    given_at: new Date().toISOString(),
    given_by: givenBy || null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

export function markEquipmentPendingFulfillment({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  const next = db.update('student_equipment', row.id, {
    fulfillment_status: 'pending',
    given_at: null,
    given_by: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** Child has own gear — no payment / no club handoff. */
export function markEquipmentOwn({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.payment_status === 'own') return { ok: true, row };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'own',
    fulfillment_status: 'pending',
    paid_at: null,
    payment_id: null,
    given_at: null,
    given_by: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** Family not interested — no payment / no handoff needed. */
export function markEquipmentDeclined({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };
  if (row.payment_status === 'declined') return { ok: true, row };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'declined',
    fulfillment_status: 'pending',
    paid_at: null,
    payment_id: null,
    given_at: null,
    given_by: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

/** Clear resolved statuses back to unpaid + pending — ready for payment again. */
export function markEquipmentUnpaid({ db, persist, rowId } = {}) {
  const row = db.getOne('student_equipment', rowId);
  if (!row) return { ok: false, error: 'פריט הציוד לא נמצא' };

  const next = db.update('student_equipment', row.id, {
    payment_status: 'unpaid',
    fulfillment_status: 'pending',
    paid_at: null,
    payment_id: null,
    given_at: null,
    given_by: null,
    rental_starts_at: null,
    rental_ends_at: null,
  });
  if (next && typeof persist === 'function') {
    Promise.resolve(persist('student_equipment', next)).catch(() => {});
  }
  return { ok: true, row: next };
}

export function computeEquipmentTotal(settings, itemTypes = []) {
  const prices = normalizeEquipmentSettings(settings).prices;
  return (Array.isArray(itemTypes) ? itemTypes : []).reduce((sum, type) => {
    if (!EQUIPMENT_ITEM_TYPES.includes(type)) return sum;
    return sum + (Number(prices[type]) || 0);
  }, 0);
}

export function describeEquipmentItems(itemTypes = [], shirtSize = null) {
  const parts = (Array.isArray(itemTypes) ? itemTypes : [])
    .filter((t) => EQUIPMENT_ITEM_TYPES.includes(t))
    .map((t) => {
      const label = EQUIPMENT_ITEM_LABELS[t] || t;
      if (t === 'shirt' && shirtSize) return `${label} (מידה ${shirtSize})`;
      return label;
    });
  return parts.length ? `ציוד לאימונים: ${parts.join(', ')}` : 'ציוד לאימונים';
}

export function equipmentGapFlags(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  // "own" (from home) is resolved — not a payment gap.
  const unpaid = list.filter((r) => r.payment_status === 'unpaid');
  const awaitingHandoff = list.filter(
    (r) => r.payment_status === 'paid' && r.fulfillment_status !== 'given'
  );
  return {
    hasUnpaid: unpaid.length > 0,
    hasAwaitingHandoff: awaitingHandoff.length > 0,
    hasGap: unpaid.length > 0 || awaitingHandoff.length > 0,
    unpaidCount: unpaid.length,
    awaitingCount: awaitingHandoff.length,
  };
}

/** Items still owed for payment links / public checkout (excludes paid + own). */
export function unpaidEquipmentItems(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((r) => r.payment_status === 'unpaid');
}

/** Seed WhatsApp draft template for equipment payment link (idempotent). */
export function ensureEquipmentWhatsappTemplate({ db, persist, publicAppBase = '' } = {}) {
  if (!db) return null;
  const templates = db.get('message_templates') || [];
  const existing = templates.find(
    (t) =>
      (t.meta_name || t.name) === EQUIPMENT_TEMPLATE_NAME ||
      t.id === 'tpl-equipment-payment'
  );
  if (existing) return existing;

  const base = String(publicAppBase || process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://client-omega-topaz-35.vercel.app')
    .replace(/\/$/, '');
  const buttonUrl = `${base}/equipment/{{1}}`;

  const template = db.insert('message_templates', {
    id: 'tpl-equipment-payment',
    name: EQUIPMENT_TEMPLATE_NAME,
    meta_name: EQUIPMENT_TEMPLATE_NAME,
    language: 'he',
    category: 'UTILITY',
    status: 'DRAFT',
    body:
      'שלום {{1}},\n' +
      'לתשלום ציוד האימונים של {{2}} לחצו על הכפתור.\n' +
      'אפשר לבחור נעליים, חולצת חוג ושק מגנזיום.',
    header: '',
    footer: 'My Wall',
    body_examples: ['דנה כהן', 'נועם כהן'],
    variables: [
      { key: '1', field: 'parent_name', label: 'שם הורה', example: 'דנה כהן' },
      { key: '2', field: 'child_name', label: 'שם הילד', example: 'נועם כהן' },
    ],
    buttons: [
      {
        type: 'URL',
        text: 'לתשלום ציוד',
        url: buttonUrl,
        example: ['demo-token'],
      },
    ],
    active_for_send: false,
    created_at: new Date().toISOString(),
  });

  if (typeof persist === 'function') {
    Promise.resolve(persist('message_templates', template)).catch(() => {});
  }
  return template;
}
