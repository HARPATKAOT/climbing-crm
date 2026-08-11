/**
 * POS helpers: product typing, pass issuance, punch cards.
 */

export const PRODUCT_TYPES = {
  TIME_MEMBERSHIP: 'time_membership',
  PUNCH_CARD: 'punch_card',
  PRODUCT: 'product',
};

export function normalizeProductType(item) {
  const raw = String(item?.product_type || '').trim();
  if (Object.values(PRODUCT_TYPES).includes(raw)) return raw;

  const cats = [
    ...(Array.isArray(item?.categories) ? item.categories : []),
    item?.category,
  ]
    .filter(Boolean)
    .map((c) => String(c));

  if (cats.some((c) => c === 'כרטיסיה' || (c.includes('כרטיס') && !c.includes('מנוי')))) {
    return PRODUCT_TYPES.PUNCH_CARD;
  }
  if (cats.some((c) => c.includes('מנוי') && !c.includes('כרטיס'))) {
    return PRODUCT_TYPES.TIME_MEMBERSHIP;
  }
  // Combined browse category — do not guess; require product_type
  return PRODUCT_TYPES.PRODUCT;
}

export function requiresCustomer(productType) {
  return (
    productType === PRODUCT_TYPES.TIME_MEMBERSHIP ||
    productType === PRODUCT_TYPES.PUNCH_CARD
  );
}

export function addDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build customer_pass record fields from a sold pricelist item.
 *
 * `discount` records that the pass was bought under a benefit. It is kept as
 * fields rather than baked into the name so the pass still reads as the plain
 * product everywhere, while a refund can still see it was not sold at list price.
 */
export function buildPassFromItem({
  item,
  studentId,
  parentId,
  saleId,
  docId,
  docNumber,
  discount = null,
  unitListPrice = null,
}) {
  const productType = normalizeProductType(item);
  if (productType === PRODUCT_TYPES.PRODUCT) return null;

  const now = new Date().toISOString();
  const validFrom = todayIsoDate();
  let validUntil = null;
  let visitsTotal = null;
  let visitsRemaining = null;

  // These ran as `|| 10` and `|| 30`, so a pricelist item missing its visit
  // count minted a ten-visit card and a membership with no length became a
  // month — an entitlement nobody configured, handed over after the customer
  // had already paid. Refuse instead: the item needs fixing, and the sale can
  // be redone in a minute.
  if (productType === PRODUCT_TYPES.PUNCH_CARD) {
    visitsTotal = Number(item.visits_total);
    if (!Number.isFinite(visitsTotal) || visitsTotal <= 0) {
      throw new Error(`למוצר "${item.name || item.id}" לא הוגדר מספר כניסות — יש לעדכן במחירון`);
    }
    visitsRemaining = visitsTotal;
    if (item.validity_days) {
      validUntil = addDays(validFrom, item.validity_days);
    }
  } else if (productType === PRODUCT_TYPES.TIME_MEMBERSHIP) {
    const days = Number(item.duration_days);
    if (!Number.isFinite(days) || days <= 0) {
      throw new Error(`למוצר "${item.name || item.id}" לא הוגדר משך מנוי — יש לעדכן במחירון`);
    }
    validUntil = addDays(validFrom, days);
  }

  return {
    student_id: studentId,
    parent_id: parentId || null,
    pricelist_id: item.id || null,
    sale_id: saleId || null,
    pass_type: productType,
    name: item.name || 'מנוי / כרטיסייה',
    visits_total: visitsTotal,
    visits_remaining: visitsRemaining,
    valid_from: validFrom,
    valid_until: validUntil,
    status: 'active',
    icount_doc_id: docId || null,
    icount_doc_number: docNumber || null,
    list_price: discount?.listPrice != null ? Number(discount.listPrice) : null,
    paid_price: discount?.paidPrice != null ? Number(discount.paidPrice) : null,
    // מחיר הכניסה הבודדת ביום המכירה. נצרב כאן ולא נקרא מהמחירון בזמן הזיכוי,
    // כדי שהעלאת מחיר כניסה לא תקטין החזר של כרטיס שנמכר לפני חודש.
    unit_list_price: unitListPrice != null && Number.isFinite(Number(unitListPrice))
      ? Number(unitListPrice)
      : null,
    coupon_code: discount?.couponCode || null,
    coupon_label: discount?.couponLabel || null,
    grants_wall_climbing: item.grants_wall_climbing === true,
    family_shared: item.family_shared === true,
    shared_household_id: item.family_shared === true ? (item.shared_household_id || null) : null,
    // כרטיסייה מועברת אינה אישית: מי שמחזיק בה יכול לנקב בה גם לחבר שבא איתו,
    // כולל מי שאין לו תיק. „משפחתית” היא דבר אחר — היא משותפת לבני הבית בלבד.
    transferable: item.transferable === true && productType === PRODUCT_TYPES.PUNCH_CARD,
    created_at: now,
    updated_at: now,
  };
}

/** Short Hebrew note for a pass that was not sold at list price. */
export function passDiscountNote(pass) {
  if (!pass?.coupon_label && pass?.list_price == null) return '';
  const list = Number(pass.list_price);
  const paid = Number(pass.paid_price);
  const label = pass.coupon_label || 'הטבה';
  if (Number.isFinite(list) && Number.isFinite(paid) && list > paid) {
    return `נקנתה ב${label} · שולם ₪${paid} במקום ₪${list}`;
  }
  return `נקנתה ב${label}`;
}

export function isPassUsable(pass, onDate = todayIsoDate()) {
  if (!pass || pass.status !== 'active') return false;
  if (pass.valid_until && String(pass.valid_until) < String(onDate)) return false;
  if (pass.pass_type === PRODUCT_TYPES.PUNCH_CARD) {
    return Number(pass.visits_remaining) > 0;
  }
  return true;
}

/** Prefer soonest expiry, then lowest remaining punches. */
export function pickBestPunchCard(passes) {
  const usable = (passes || []).filter(
    (p) => p.pass_type === PRODUCT_TYPES.PUNCH_CARD && isPassUsable(p)
  );
  if (!usable.length) return null;
  return [...usable].sort((a, b) => {
    const au = a.valid_until || '9999-12-31';
    const bu = b.valid_until || '9999-12-31';
    if (au !== bu) return au.localeCompare(bu);
    return Number(a.visits_remaining) - Number(b.visits_remaining);
  })[0];
}

export function computeSaleTotal(items) {
  return (items || []).reduce((sum, line) => {
    const qty = Number(line.quantity) || 1;
    const price = Number(line.unitprice ?? line.price) || 0;
    return sum + qty * price;
  }, 0);
}

/** Local inventory snapshot for tracked products (iCount inventory API not available on this account). */
export function listTrackedInventory(pricelist = [], { lowOnly = false, threshold = 5 } = {}) {
  const items = (pricelist || [])
    .filter((i) => i && i.track_inventory === true && i.active !== false)
    .map((i) => ({
      id: i.id,
      name: i.name || 'פריט',
      sku: i.sku || '',
      icount_item_id: i.icount_item_id || null,
      stock_qty: Number(i.stock_qty) || 0,
      low: (Number(i.stock_qty) || 0) <= Number(threshold),
    }))
    .sort((a, b) => a.stock_qty - b.stock_qty || String(a.name).localeCompare(String(b.name), 'he'));
  return lowOnly ? items.filter((i) => i.low) : items;
}

export function listExpiringPasses(passes = [], { withinDays = 14, onDate = todayIsoDate() } = {}) {
  const limit = addDays(onDate, withinDays);
  return (passes || [])
    .filter((p) => {
      if (!p || p.status !== 'active') return false;
      if (!p.valid_until) return false;
      return String(p.valid_until) >= String(onDate) && String(p.valid_until) <= String(limit);
    })
    .sort((a, b) => String(a.valid_until).localeCompare(String(b.valid_until)));
}

export function aggregatePosSales(sales = []) {
  const byDay = {};
  const byEmployee = {};
  const byPayment = {};
  let total = 0;
  let count = 0;
  for (const sale of sales || []) {
    if (!sale || sale.status === 'pending_payment' || sale.status === 'quoted') continue;
    if (sale.status === 'refunded' || sale.status === 'cancelled') continue;
    const amount = Number(sale.total) || 0;
    const day = String(sale.created_at || '').slice(0, 10) || 'לא ידוע';
    const emp = sale.sold_by || 'לא צוין';
    const pay = sale.payment_method || 'לא צוין';
    byDay[day] = (byDay[day] || 0) + amount;
    byEmployee[emp] = (byEmployee[emp] || 0) + amount;
    byPayment[pay] = (byPayment[pay] || 0) + amount;
    total += amount;
    count += 1;
  }
  const toRows = (obj) =>
    Object.entries(obj)
      .map(([key, value]) => ({ key, total: value }))
      .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key), 'he'));
  return {
    count,
    total,
    byDay: toRows(byDay).sort((a, b) => String(b.key).localeCompare(String(a.key))),
    byEmployee: toRows(byEmployee),
    byPayment: toRows(byPayment),
  };
}

export function enrichPricelistItem(item) {
  const productType = normalizeProductType(item);
  return {
    ...item,
    product_type: productType,
    requires_customer: requiresCustomer(productType),
    track_inventory:
      item.track_inventory === true ||
      (productType === PRODUCT_TYPES.PRODUCT && item.track_inventory !== false),
    visits_total:
      item.visits_total != null
        ? Number(item.visits_total)
        : productType === PRODUCT_TYPES.PUNCH_CARD
          ? 10
          : null,
    validity_days:
      item.validity_days != null && item.validity_days !== ''
        ? Number(item.validity_days)
        : null,
    duration_days:
      item.duration_days != null && item.duration_days !== ''
        ? Number(item.duration_days)
        : productType === PRODUCT_TYPES.TIME_MEMBERSHIP
          ? 30
          : null,
    stock_qty: item.stock_qty != null ? Number(item.stock_qty) : null,
  };
}

/**
 * כמה אנשים יחידה אחת של המוצר מכסה.
 *
 * שדה „מספר משתתפים” במחירון קיים מזמן ושימש עד היום לתצוגה בלבד. הוא בדיוק
 * המידע החסר: אימון זוגי הוא יחידה אחת לשני אנשים, ולכן סימון של ילד שני
 * בדלפק צריך למלא את היחידה — לא לקנות עוד אחת. ריק, „1” או טקסט חופשי
 * נקראים כיחידה לאדם אחד, כי זה המצב של כמעט כל המוצרים.
 */
export function unitCapacity(item) {
  const n = parseInt(String(item?.participants ?? '').trim(), 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}
