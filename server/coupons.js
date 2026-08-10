/**
 * Coupons: the benefit a campaign hands to one customer.
 *
 * An "offer" is the definition (50% off a wall entry, valid 30 days). A coupon
 * is one issued copy of that offer, owned by a customer, with a code and an
 * expiry. The offer is snapshotted onto the coupon so editing a campaign later
 * never changes what an already-issued coupon is worth.
 *
 * The discount maths here are pure: they take cart lines and give back cart
 * lines, so the register can preview a coupon and the sale route can re-apply
 * it server-side without the two ever drifting apart.
 */

export const OFFER_TYPES = {
  PERCENT: 'percent',
  AMOUNT: 'amount',
  FREE_ITEM: 'free_item',
  BOGO: 'bogo',
  RULESET: 'ruleset',
};

export const OFFER_TYPE_LABELS = {
  [OFFER_TYPES.PERCENT]: 'אחוז הנחה',
  [OFFER_TYPES.AMOUNT]: 'סכום הנחה',
  [OFFER_TYPES.FREE_ITEM]: 'פריט חינם',
  [OFFER_TYPES.BOGO]: 'אחד פלוס אחד',
  [OFFER_TYPES.RULESET]: 'סל הנחות',
};

export const COUPON_STATUS = {
  ACTIVE: 'active',
  // Held against an unpaid payment link: the price was already locked into the
  // link, so it must not be spent anywhere else while that link is live.
  RESERVED: 'reserved',
  REDEEMED: 'redeemed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

/** A payment link left unpaid this long gives the benefit back to the customer. */
export const RESERVATION_DAYS = 7;

/** Unambiguous alphabet — no O/0, I/1, so staff can read a code off a screen. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export function todayIsoDate(d = new Date()) {
  return new Date(d).toISOString().slice(0, 10);
}

export function addDaysIso(isoDate, days) {
  const d = new Date(`${String(isoDate).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// ─── Offer definition ────────────────────────────────────────────────────────

/**
 * Fill in defaults and clamp anything a form could send in wrong. `units` is
 * how many items the benefit covers — without it a 50% coupon would discount a
 * cart of ten entries, which is never what a win-back offer means.
 */
export function normalizeOffer(raw = {}) {
  const type = Object.values(OFFER_TYPES).includes(raw.type) ? raw.type : OFFER_TYPES.PERCENT;
  const rawValue = Number(raw.value);
  let value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
  if (type === OFFER_TYPES.PERCENT) value = Math.min(100, value);
  if (type === OFFER_TYPES.FREE_ITEM || type === OFFER_TYPES.BOGO) value = 0;

  const appliesTo = ['all', 'items', 'product_type', 'categories'].includes(raw.appliesTo)
    ? raw.appliesTo
    : 'all';

  const unitsRaw = Number(raw.units);
  const units = Number.isFinite(unitsRaw) && unitsRaw > 0 ? Math.min(50, Math.round(unitsRaw)) : 1;

  const maxDiscountRaw = Number(raw.maxDiscount);
  const maxDiscount =
    Number.isFinite(maxDiscountRaw) && maxDiscountRaw > 0 ? roundMoney(maxDiscountRaw) : null;

  const validityRaw = Number(raw.validityDays);
  const validityDays =
    Number.isFinite(validityRaw) && validityRaw > 0 ? Math.min(365, Math.round(validityRaw)) : 30;
  const noExpiry = raw.noExpiry === true || raw.no_expiry === true;

  return {
    type,
    value,
    appliesTo,
    pricelistIds: Array.isArray(raw.pricelistIds) ? raw.pricelistIds.filter(Boolean).map(String) : [],
    productType: raw.productType || 'product',
    categoryNames: Array.isArray(raw.categoryNames) ? raw.categoryNames.filter(Boolean).map(String) : [],
    units,
    maxDiscount,
    validityDays,
    noExpiry,
    parts: type === OFFER_TYPES.RULESET
      ? (Array.isArray(raw.parts) ? raw.parts : []).map((part) => normalizeOffer({
          ...part,
          type: part.type === OFFER_TYPES.AMOUNT ? OFFER_TYPES.AMOUNT : OFFER_TYPES.PERCENT,
        }))
      : [],
    label: String(raw.label || '').trim(),
  };
}

/** One Hebrew line describing the benefit, for the customer file and the register. */
export function offerSummary(offer) {
  const o = normalizeOffer(offer);
  if (o.label) return o.label;
  const scope =
    o.appliesTo === 'items'
      ? ' על פריטים נבחרים'
      : o.appliesTo === 'product_type'
        ? ' על קטגוריה נבחרת'
        : '';
  if (o.type === OFFER_TYPES.PERCENT) return `${o.value}% הנחה${scope}`;
  if (o.type === OFFER_TYPES.AMOUNT) return `₪${o.value} הנחה${scope}`;
  if (o.type === OFFER_TYPES.FREE_ITEM) {
    return o.units > 1 ? `${o.units} פריטים חינם${scope}` : `פריט חינם${scope}`;
  }
  if (o.type === OFFER_TYPES.RULESET) return 'סל הנחות לפי זכאות';
  return `אחד פלוס אחד${scope}`;
}

// ─── Coupon records ──────────────────────────────────────────────────────────

export function generateCouponCode(taken = new Set(), random = Math.random) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    }
    if (!used.has(code)) return code;
  }
  // Astronomically unlikely; fall back to something guaranteed unique.
  return `C${Date.now().toString(36).toUpperCase().slice(-7)}`;
}

/** The live status, taking expiry into account without needing a nightly job. */
export function couponState(coupon, today = todayIsoDate()) {
  if (!coupon) return COUPON_STATUS.CANCELLED;
  if (coupon.status === COUPON_STATUS.REDEEMED) return COUPON_STATUS.REDEEMED;
  if (coupon.status === COUPON_STATUS.CANCELLED) return COUPON_STATUS.CANCELLED;
  // A reservation survives its own expiry: the customer was already quoted the
  // discounted price, so paying that link late is still honoured.
  if (coupon.status === COUPON_STATUS.RESERVED) return COUPON_STATUS.RESERVED;
  if (coupon.expires_at && String(coupon.expires_at) < String(today)) return COUPON_STATUS.EXPIRED;
  return COUPON_STATUS.ACTIVE;
}

export function isCouponUsable(coupon, today = todayIsoDate()) {
  return couponState(coupon, today) === COUPON_STATUS.ACTIVE;
}

export function couponDaysLeft(coupon, today = todayIsoDate()) {
  if (!coupon?.expires_at) return null;
  return daysBetween(today, coupon.expires_at);
}

/** A coupon belongs to a family: match on the customer card or on the trainee. */
export function couponBelongsTo(coupon, { parentId, studentId } = {}) {
  if (!coupon) return false;
  if (parentId && coupon.parent_id && String(coupon.parent_id) === String(parentId)) return true;
  if (studentId && coupon.student_id && String(coupon.student_id) === String(studentId)) return true;
  return false;
}

// ─── Cart maths ──────────────────────────────────────────────────────────────

export function lineMatchesOffer(offer, line) {
  const o = normalizeOffer(offer);
  if (o.appliesTo === 'all') return true;
  if (o.appliesTo === 'items') {
    return !!line?.pricelist_id && o.pricelistIds.includes(String(line.pricelist_id));
  }
  if (o.appliesTo === 'categories') {
    const categories = [
      ...(Array.isArray(line?.item?.categories) ? line.item.categories : []),
      line?.item?.category,
      ...(Array.isArray(line?.categories) ? line.categories : []),
      line?.category,
    ].filter(Boolean).map(String);
    return o.categoryNames.some((name) => categories.includes(String(name)));
  }
  return String(line?.product_type || 'product') === String(o.productType);
}

/** One entry per physical item in the cart, so a benefit can cover part of a line. */
function expandUnits(offer, lines) {
  const units = [];
  (lines || []).forEach((line, lineIndex) => {
    if (!lineMatchesOffer(offer, line)) return;
    const price = Number(line.unitprice ?? line.price) || 0;
    if (price <= 0) return;
    const qty = Math.max(1, Math.round(Number(line.quantity) || 1));
    for (let i = 0; i < Math.min(qty, 100); i += 1) {
      units.push({ lineIndex, price });
    }
  });
  return units.sort((a, b) => b.price - a.price);
}

/**
 * Which units the benefit covers and by how much each one drops.
 * Returns `[]` when nothing in the cart qualifies.
 */
export function selectDiscountedUnits(offer, lines) {
  const o = normalizeOffer(offer);
  const units = expandUnits(o, lines);
  if (!units.length) return [];

  const picked = [];

  if (o.type === OFFER_TYPES.AMOUNT) {
    // A shekel amount comes off the eligible items, most expensive first, until
    // it runs out. Never turns into store credit on the rest of the cart.
    let remaining = o.value;
    for (const unit of units) {
      if (remaining <= 0) break;
      const cut = Math.min(unit.price, remaining);
      remaining = roundMoney(remaining - cut);
      picked.push({ ...unit, discount: roundMoney(cut) });
    }
  } else if (o.type === OFFER_TYPES.BOGO) {
    // Pay for the dearer of each pair; the cheaper one is the free one.
    let free = 0;
    for (let i = 1; i < units.length && free < o.units; i += 2) {
      picked.push({ ...units[i], discount: roundMoney(units[i].price) });
      free += 1;
    }
  } else {
    const rate = o.type === OFFER_TYPES.FREE_ITEM ? 1 : o.value / 100;
    for (const unit of units.slice(0, o.units)) {
      picked.push({ ...unit, discount: roundMoney(unit.price * rate) });
    }
  }

  if (o.maxDiscount == null) return picked.filter((u) => u.discount > 0);

  // Trim to the cap rather than dropping whole units, so a capped percent
  // coupon still gives exactly the cap.
  let budget = o.maxDiscount;
  const capped = [];
  for (const unit of picked) {
    if (budget <= 0) break;
    const cut = Math.min(unit.discount, budget);
    budget = roundMoney(budget - cut);
    capped.push({ ...unit, discount: roundMoney(cut) });
  }
  return capped.filter((u) => u.discount > 0);
}

/**
 * Rebuild the cart with the benefit applied. A line only partly covered is
 * split, so the invoice shows "2 × entry" beside "1 × entry (הטבה)" instead of
 * a blended price nobody can check.
 */
export function applyOfferToLines(offer, lines) {
  const o = normalizeOffer(offer);
  const source = Array.isArray(lines) ? lines : [];
  if (o.type === OFFER_TYPES.RULESET) {
    let discount = 0;
    const out = [];
    for (const line of source) {
      let best = { lines: [line], discount: 0, applied: false };
      for (const part of o.parts) {
        const candidate = applyOfferToLines(part, [line]);
        if (candidate.discount > best.discount) best = candidate;
      }
      discount = roundMoney(discount + best.discount);
      out.push(...best.lines);
    }
    return { lines: out, discount, applied: discount > 0, reason: discount > 0 ? null : 'no_eligible_items' };
  }
  const picked = selectDiscountedUnits(o, source);

  if (!picked.length) {
    return { lines: source, discount: 0, applied: false, reason: 'no_eligible_items' };
  }

  const byLine = new Map();
  for (const unit of picked) {
    if (!byLine.has(unit.lineIndex)) byLine.set(unit.lineIndex, []);
    byLine.get(unit.lineIndex).push(unit);
  }

  const label = offerSummary(o);
  const out = [];
  let discount = 0;

  source.forEach((line, index) => {
    const hits = byLine.get(index);
    if (!hits?.length) {
      out.push(line);
      return;
    }
    const qty = Math.max(1, Math.round(Number(line.quantity) || 1));
    const untouched = qty - hits.length;
    if (untouched > 0) out.push({ ...line, quantity: untouched });

    // Units cut by the same amount stay one invoice line.
    const groups = new Map();
    for (const hit of hits) {
      const key = hit.discount.toFixed(2);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const basePrice = Number(line.unitprice ?? line.price) || 0;
    for (const [key, count] of groups) {
      const perUnit = Number(key);
      discount = roundMoney(discount + perUnit * count);
      // `name` stays the plain product name: it is what a punch card is filed
      // under in the customer's file and what per-product reporting groups by.
      // Only the invoice description carries the benefit.
      out.push({
        ...line,
        quantity: count,
        unitprice: roundMoney(Math.max(0, basePrice - perUnit)),
        list_price: basePrice,
        description: `${line.description || line.name || 'פריט'} · ${label}`,
        coupon_applied: true,
        coupon_label: label,
        coupon_discount_per_unit: perUnit,
      });
    }
  });

  return { lines: out, discount: roundMoney(discount), applied: true, reason: null };
}

// ─── Store access ────────────────────────────────────────────────────────────

export function listCoupons(db, { parentId, studentId, campaignId, employeeId, recurring, status, today } = {}) {
  const on = today || todayIsoDate();
  return (db.get('customer_coupons') || [])
    .filter((c) => {
      if (parentId || studentId) {
        if (!couponBelongsTo(c, { parentId, studentId })) return false;
      }
      if (campaignId && String(c.campaign_id) !== String(campaignId)) return false;
      if (employeeId && String(c.employee_id) !== String(employeeId)) return false;
      if (recurring !== undefined && Boolean(c.recurring) !== Boolean(recurring)) return false;
      if (status && couponState(c, on) !== status) return false;
      return true;
    })
    .map((c) => ({ ...c, state: couponState(c, on), days_left: couponDaysLeft(c, on) }))
    .sort((a, b) => String(b.issued_at || '').localeCompare(String(a.issued_at || '')));
}

export function activeCouponsFor(db, { parentId, studentId }, today = todayIsoDate()) {
  return listCoupons(db, { parentId, studentId, status: COUPON_STATUS.ACTIVE, today });
}

export function findCouponByCode(db, code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;
  return (db.get('customer_coupons') || []).find(
    (c) => String(c.code || '').toUpperCase() === clean
  ) || null;
}

export function issueCoupon(
  db,
  {
    offer,
    parentId = null,
    studentId = null,
    campaignId = null,
    campaignName = '',
    source = 'manual',
    issuedBy = '',
    recurring = false,
    employeeId = null,
    today = todayIsoDate(),
  } = {}
) {
  const snapshot = normalizeOffer(offer);
  if (!parentId && !studentId) {
    throw new Error('חובה לשייך את ההטבה ללקוח');
  }
  const taken = new Set(
    (db.get('customer_coupons') || []).map((c) => String(c.code || '').toUpperCase())
  );
  return db.insert('customer_coupons', {
    code: generateCouponCode(taken),
    campaign_id: campaignId,
    campaign_name: campaignName || '',
    parent_id: parentId,
    student_id: studentId,
    employee_id: employeeId,
    offer: snapshot,
    label: offerSummary(snapshot),
    status: COUPON_STATUS.ACTIVE,
    source,
    recurring: Boolean(recurring),
    issued_by: issuedBy || '',
    issued_at: today,
    expires_at: recurring || snapshot.noExpiry ? null : addDaysIso(today, snapshot.validityDays),
    usage_count: 0,
    last_used_at: null,
    redeemed_at: null,
    pos_sale_id: null,
    redeemed_amount: null,
    reminder_sent_at: null,
    created_at: new Date().toISOString(),
  });
}

/**
 * Check a coupon against a real cart before it is honoured. Every rule the
 * register shows is re-checked here, because the register is only a preview.
 */
export function checkCouponForSale(db, { code, couponId, parentId, studentId, lines, today }) {
  const on = today || todayIsoDate();
  const coupon = couponId
    ? (db.get('customer_coupons') || []).find((c) => String(c.id) === String(couponId)) || null
    : findCouponByCode(db, code);

  if (!coupon) return { ok: false, error: 'הקופון לא נמצא' };

  const state = couponState(coupon, on);
  if (state === COUPON_STATUS.REDEEMED) return { ok: false, error: 'הקופון כבר מומש', coupon };
  if (state === COUPON_STATUS.EXPIRED) return { ok: false, error: 'תוקף הקופון פג', coupon };
  if (state === COUPON_STATUS.CANCELLED) return { ok: false, error: 'הקופון בוטל', coupon };
  if (state === COUPON_STATUS.RESERVED) {
    return { ok: false, error: 'ההטבה שמורה לקישור תשלום שכבר נשלח וטרם שולם', coupon };
  }

  if (!couponBelongsTo(coupon, { parentId, studentId })) {
    return { ok: false, error: 'הקופון שייך ללקוח אחר', coupon };
  }

  const result = applyOfferToLines(coupon.offer, lines);
  if (!result.applied) {
    return { ok: false, error: 'אין בעגלה פריט שמתאים להטבה', coupon };
  }
  // Stamp the code on the discounted lines so a pass issued from one carries
  // the benefit it was bought under.
  const stamped = result.lines.map((line) =>
    line.coupon_applied ? { ...line, coupon_code: coupon.code } : line
  );
  return { ok: true, coupon, lines: stamped, discount: result.discount };
}

export function redeemCoupon(db, couponId, { saleId = null, amount = 0 } = {}) {
  const current = db.getOne('customer_coupons', couponId);
  if (current?.recurring) {
    return db.update('customer_coupons', couponId, {
      status: COUPON_STATUS.ACTIVE,
      usage_count: (Number(current.usage_count) || 0) + 1,
      last_used_at: new Date().toISOString(),
      last_pos_sale_id: saleId,
      last_redeemed_amount: roundMoney(amount),
    });
  }
  return db.update('customer_coupons', couponId, {
    status: COUPON_STATUS.REDEEMED,
    redeemed_at: new Date().toISOString(),
    pos_sale_id: saleId,
    redeemed_amount: roundMoney(amount),
  });
}

/**
 * Hold the benefit against a payment link. The discount is already baked into
 * the amount the customer is about to pay, so it cannot also be spent at the
 * counter — but it is not consumed either, because the payment may never come.
 */
export function reserveCoupon(db, couponId, { saleId = null, amount = 0, today = todayIsoDate() } = {}) {
  const current = db.getOne('customer_coupons', couponId);
  // A standing discount is intentionally reusable. A pending payment link must
  // not hide it from the employee's next purchase at the counter.
  if (current?.recurring) {
    return db.update('customer_coupons', couponId, {
      last_reserved_at: new Date().toISOString(),
      last_reserved_sale_id: saleId,
      last_reserved_amount: roundMoney(amount),
    });
  }
  return db.update('customer_coupons', couponId, {
    status: COUPON_STATUS.RESERVED,
    reserved_at: new Date().toISOString(),
    reserved_on: today,
    pos_sale_id: saleId,
    redeemed_amount: roundMoney(amount),
  });
}

/**
 * A refunded sale, or a payment link that was never paid, gives the benefit
 * back — unless it has since expired.
 */
export function releaseCouponsForSale(db, saleId, today = todayIsoDate()) {
  const released = [];
  const holding = new Set([COUPON_STATUS.REDEEMED, COUPON_STATUS.RESERVED]);
  for (const coupon of db.get('customer_coupons') || []) {
    if (String(coupon.pos_sale_id || '') !== String(saleId)) continue;
    if (!holding.has(coupon.status)) continue;
    const expired = coupon.expires_at && String(coupon.expires_at) < String(today);
    const updated = db.update('customer_coupons', coupon.id, {
      status: expired ? COUPON_STATUS.EXPIRED : COUPON_STATUS.ACTIVE,
      redeemed_at: null,
      reserved_at: null,
      reserved_on: null,
      pos_sale_id: null,
      redeemed_amount: null,
    });
    if (updated) released.push(updated);
  }
  return released;
}

/**
 * Safety valve: a payment link nobody ever paid must not hold a benefit
 * hostage. After `RESERVATION_DAYS` the coupon goes back to the customer.
 */
export function releaseStaleReservations(db, today = todayIsoDate(), maxDays = RESERVATION_DAYS) {
  const released = [];
  for (const coupon of db.get('customer_coupons') || []) {
    if (coupon.status !== COUPON_STATUS.RESERVED) continue;
    const since = coupon.reserved_on ? daysBetween(coupon.reserved_on, today) : null;
    if (since == null || since <= maxDays) continue;
    // If the sale did get paid in the meantime, leave the reservation alone —
    // the payment hook will settle it.
    const sale = coupon.pos_sale_id
      ? (db.get('pos_sales') || []).find((s) => String(s.id) === String(coupon.pos_sale_id))
      : null;
    if (sale && sale.status === 'paid') continue;
    const expired = coupon.expires_at && String(coupon.expires_at) < String(today);
    const updated = db.update('customer_coupons', coupon.id, {
      status: expired ? COUPON_STATUS.EXPIRED : COUPON_STATUS.ACTIVE,
      reserved_at: null,
      reserved_on: null,
      pos_sale_id: null,
      redeemed_amount: null,
    });
    if (updated) released.push(updated);
  }
  return released;
}

export function cancelCoupon(db, couponId, reason = '') {
  return db.update('customer_coupons', couponId, {
    status: COUPON_STATUS.CANCELLED,
    cancelled_reason: reason || '',
    cancelled_at: new Date().toISOString(),
  });
}

/** Nightly tidy-up: park coupons that ran out so lists stay honest. */
export function expireDueCoupons(db, today = todayIsoDate()) {
  let expired = 0;
  for (const coupon of db.get('customer_coupons') || []) {
    if (coupon.status !== COUPON_STATUS.ACTIVE) continue;
    if (!coupon.expires_at || String(coupon.expires_at) >= String(today)) continue;
    db.update('customer_coupons', coupon.id, { status: COUPON_STATUS.EXPIRED });
    expired += 1;
  }
  return expired;
}

/** Redemption and revenue per campaign — the only numbers worth reporting. */
export function couponStats(db, campaignId, today = todayIsoDate()) {
  const rows = listCoupons(db, { campaignId, today });
  const stats = {
    issued: rows.length, active: 0, reserved: 0, redeemed: 0, expired: 0, cancelled: 0, revenue: 0,
  };
  const sales = db.get('pos_sales') || [];
  for (const coupon of rows) {
    if (coupon.state === COUPON_STATUS.ACTIVE) stats.active += 1;
    else if (coupon.state === COUPON_STATUS.RESERVED) stats.reserved += 1;
    else if (coupon.state === COUPON_STATUS.REDEEMED) stats.redeemed += 1;
    else if (coupon.state === COUPON_STATUS.EXPIRED) stats.expired += 1;
    else stats.cancelled += 1;
    if (coupon.pos_sale_id) {
      const sale = sales.find((s) => String(s.id) === String(coupon.pos_sale_id));
      if (sale && sale.status !== 'refunded' && sale.status !== 'cancelled') {
        stats.revenue = roundMoney(stats.revenue + (Number(sale.total) || 0));
      }
    }
  }
  return stats;
}
