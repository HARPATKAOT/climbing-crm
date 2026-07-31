/**
 * Self-serve purchase of a pass (punch card / time membership) from a public
 * link — no staff, no login.
 *
 * The purchase deliberately ends where a counter payment link ends: a
 * `pos_sales` row in `pending_payment` plus a pending `payments` row that
 * carries `pos_sale_id`. Nothing here issues the pass. The iCount webhook is
 * the single place a pass is ever created from a link, so a page that is
 * abandoned at the clearing screen leaves no pass behind, and a customer who
 * pays gets exactly the same record staff would have produced.
 */

import crypto from 'crypto';
import { PRODUCT_TYPES, enrichPricelistItem, requiresCustomer } from './posUtils.js';
import { resolveDefaultDeclarationTemplate, saveCrmParticipants } from './crmWaiverService.js';

/** Lead source for a customer card opened by a shop purchase. */
export const SHOP_LEAD_SOURCE = 'shop';

const purchaseLocks = new Map();

/** Serializes retries of the same idempotency key inside one Node process. */
export function withPurchaseLock(key, work) {
  const id = String(key);
  const previous = purchaseLocks.get(id) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  purchaseLocks.set(id, current);
  return current.finally(() => {
    if (purchaseLocks.get(id) === current) purchaseLocks.delete(id);
  });
}

export function makeShopSlug() {
  return crypto.randomBytes(6).toString('hex');
}

function clean(value) {
  return String(value || '').trim();
}

/**
 * Only passes are sellable on their own page. A physical product would need
 * pickup or delivery, which this flow has no answer for; a pass is issued into
 * the customer's file the moment the payment lands and needs nothing else.
 */
export function isSellableProductType(productType) {
  return requiresCustomer(productType);
}

export function isSelfServeItem(item) {
  if (!item || item.self_serve !== true) return false;
  if (item.active === false) return false;
  if (!clean(item.public_slug)) return false;
  if (!(Number(item.price) > 0)) return false;
  return isSellableProductType(enrichPricelistItem(item).product_type);
}

/**
 * Public shape of a catalog item. Explicit allowlist: `notes` is the staff's
 * internal note field and `stock_qty` / margins are nobody's business, so the
 * page only ever sees what a price tag would show.
 */
export function shopItemPayload(item) {
  const enriched = enrichPricelistItem(item);
  return {
    slug: clean(item.public_slug),
    name: item.name || 'כרטיסייה',
    description: item.description || '',
    price: Number(item.price) || 0,
    image: item.image || '',
    image_fit: item.image_fit === 'contain' ? 'contain' : 'cover',
    product_type: enriched.product_type,
    visits_total: enriched.product_type === PRODUCT_TYPES.PUNCH_CARD ? enriched.visits_total : null,
    validity_days: enriched.product_type === PRODUCT_TYPES.PUNCH_CARD ? enriched.validity_days : null,
    duration_days: enriched.product_type === PRODUCT_TYPES.TIME_MEMBERSHIP ? enriched.duration_days : null,
  };
}

export function publicShopItems(db) {
  return (db.get('pricelist') || [])
    .filter(isSelfServeItem)
    .map(shopItemPayload)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export function findShopItemBySlug(db, slug) {
  const needle = clean(slug);
  if (!needle) return null;
  return (db.get('pricelist') || []).find(
    (item) => clean(item.public_slug) === needle && isSelfServeItem(item)
  ) || null;
}

export function normalizePurchasePayload(body = {}) {
  const holder = body.holder || body.participant || {};
  const type = holder.type === 'adult' ? 'adult' : 'child';
  return {
    idempotencyKey: clean(body.idempotency_key || body.idempotencyKey),
    parent: {
      name: clean(body.parent?.name),
      // Asked for separately on the form — the household matcher and the
      // invoice use it instead of the last word of the full name.
      lastName: clean(body.parent?.lastName || body.parent?.last_name),
      phone: clean(body.parent?.phone),
      email: clean(body.parent?.email),
      city: clean(body.parent?.city),
      idNumber: clean(body.parent?.idNumber || body.parent?.parentIdNum),
      // Confirmed on the form as the same household as an existing card.
      family_parent_id: clean(body.parent?.family_parent_id || body.parent?.familyParentId),
    },
    subscriptions: body.subscriptions && typeof body.subscriptions === 'object' && !Array.isArray(body.subscriptions)
      ? body.subscriptions
      : {},
    holder: {
      ...holder,
      type,
      id: holder.id || null,
      name: clean(holder.name),
      birthDate: clean(holder.birthDate || holder.birth_date),
      answers: holder.answers || {},
      signature: holder.signature || '',
      waiverAccepted: holder.waiverAccepted === true || holder.waiverAccepted === 'true',
      reuse_health: holder.reuse_health === true
        || holder.reuseHealth === true
        || holder.reuse_declaration === true,
    },
  };
}

/** The line a shop sale carries — the same shape `mapCartLines` produces for the counter. */
export function purchaseLine(item) {
  const enriched = enrichPricelistItem(item);
  return {
    pricelist_id: item.id,
    name: item.name || 'כרטיסייה',
    description: item.description || item.name || 'כרטיסייה',
    unitprice: Number(item.price) || 0,
    quantity: 1,
    product_type: enriched.product_type,
    visits_total: enriched.visits_total,
    validity_days: enriched.validity_days,
    duration_days: enriched.duration_days,
    track_inventory: false,
  };
}

function findExistingSale(db, { itemId, idempotencyKey }) {
  if (!idempotencyKey) return null;
  return (db.get('pos_sales') || []).find(
    (sale) => sale.shop_idempotency_key === idempotencyKey
      && String(sale.shop_item_id || '') === String(itemId)
  ) || null;
}

async function durable(persist, table, row) {
  const result = await persist(table, row);
  if (result?.ok === false) {
    throw Object.assign(new Error(result.error || `שמירת ${table} נכשלה`), { status: 503 });
  }
}

/**
 * Open (or re-open) a self-serve purchase.
 *
 * `createPaymentUrl` is injected so the caller owns the iCount call; a retry of
 * the same idempotency key returns the first sale untouched rather than opening
 * a second charge.
 */
export async function createShopPurchase({
  db,
  persist,
  item,
  payload,
  createPaymentUrl,
  syncCustomer,
  onStudentCreated,
  onStudentStatusChanged,
} = {}) {
  const normalized = normalizePurchasePayload(payload);
  if (!normalized.idempotencyKey) {
    throw Object.assign(new Error('חסר מפתח מניעת כפילות'), { status: 400 });
  }
  if (!normalized.parent.email) {
    throw Object.assign(new Error('נדרש דואר אלקטרוני לשליחת החשבונית'), { status: 400 });
  }
  if (!normalized.holder.name) {
    throw Object.assign(new Error('יש לציין למי הכרטיסייה'), { status: 400 });
  }

  return withPurchaseLock(`${item.id}:${normalized.idempotencyKey}`, async () => {
    const existing = findExistingSale(db, {
      itemId: item.id,
      idempotencyKey: normalized.idempotencyKey,
    });
    if (existing) {
      return {
        duplicate: true,
        sale: existing,
        paymentUrl: existing.payment_url
          || (db.get('payments') || []).find((row) => row.id === existing.payment_id)?.payment_url
          || null,
      };
    }

    const template = resolveDefaultDeclarationTemplate(db);
    const crm = await saveCrmParticipants({
      db,
      persist,
      parent: normalized.parent,
      participants: [normalized.holder],
      template,
      source: SHOP_LEAD_SOURCE,
      onStudentCreated,
      onStudentStatusChanged,
    });

    // The shop page asks for nothing about mailing lists — buying a pass is not
    // the moment to renegotiate what we send someone. An empty map is left alone
    // rather than written, so an existing customer's choices stay untouched.
    if (
      typeof db.updateParentBroadcastLists === 'function'
      && Object.keys(normalized.subscriptions).length > 0
    ) {
      db.updateParentBroadcastLists(crm.parent.id, normalized.subscriptions);
    }

    const student = crm.participants[0]?.student || null;
    if (!student?.id) {
      throw Object.assign(new Error('שמירת המתאמן נכשלה'), { status: 500 });
    }

    // The pass is filed on this student, so a card that could not be synced to
    // the billing system must not silently become a sale under a stranger.
    let parent = crm.parent;
    let icountClientId = parent.icount_client_id || null;
    if (typeof syncCustomer === 'function') {
      try {
        const synced = await syncCustomer(parent);
        parent = synced?.parent || parent;
        icountClientId = synced?.clientId || icountClientId;
      } catch (err) {
        console.warn('⚠️ [shop] iCount client sync skipped:', err.message);
      }
    }

    const line = purchaseLine(item);
    const total = line.unitprice * line.quantity;
    const description = `${line.name} — ${student.name}`.slice(0, 180);
    const now = new Date().toISOString();

    let payment = db.insert('payments', {
      parent_id: parent.id,
      student_id: student.id,
      amount: total,
      description,
      status: 'pending',
      payment_url: null,
      price_includes_vat: true,
      icount_client_id: icountClientId,
      icount_doc_id: null,
      icount_doc_number: null,
      icount_doctype: null,
      paid_at: null,
      updated_at: now,
    });

    let sale = db.insert('pos_sales', {
      items: [line],
      total,
      payment_method: 'online',
      status: 'pending_payment',
      price_includes_vat: true,
      student_id: student.id,
      parent_id: parent.id,
      customer_name: parent.name || student.name || 'לקוח',
      customer_phone: parent.phone || '',
      customer_email: parent.email || '',
      icount_client_id: icountClientId,
      payment_id: payment.id,
      payment_url: null,
      sold_by: null,
      source: SHOP_LEAD_SOURCE,
      shop_item_id: item.id,
      shop_idempotency_key: normalized.idempotencyKey,
      created_at: now,
      updated_at: now,
    });

    const paymentUrl = await createPaymentUrl({
      payment,
      sale,
      parent,
      student,
      amount: total,
      description,
      item,
    });

    payment = db.update('payments', payment.id, {
      pos_sale_id: sale.id,
      payment_url: paymentUrl || null,
      updated_at: new Date().toISOString(),
    }) || payment;
    await durable(persist, 'payments', payment);

    sale = db.update('pos_sales', sale.id, {
      payment_url: paymentUrl || null,
      updated_at: new Date().toISOString(),
    }) || sale;
    await durable(persist, 'pos_sales', sale);

    return { duplicate: false, sale, payment, paymentUrl, crm, declaration: crm.declarations[0] };
  });
}
