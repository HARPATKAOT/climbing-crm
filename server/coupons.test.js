import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFER_TYPES,
  COUPON_STATUS,
  normalizeOffer,
  offerSummary,
  couponState,
  couponBelongsTo,
  applyOfferToLines,
  selectDiscountedUnits,
  issueCoupon,
  checkCouponForSale,
  redeemCoupon,
  releaseCouponsForSale,
  expireDueCoupons,
  couponStats,
  addDaysIso,
  daysBetween,
} from './coupons.js';

function fakeDb(tables = {}) {
  let seq = 0;
  return {
    tables,
    get: (table) => tables[table] || [],
    getOne: (table, id) =>
      (tables[table] || []).find((row) => String(row.id) === String(id)) || null,
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      seq += 1;
      const row = { ...record, id: record.id || `${table}-${seq}` };
      tables[table].push(row);
      return row;
    },
    update: (table, id, patch) => {
      const rows = tables[table] || [];
      const idx = rows.findIndex((row) => String(row.id) === String(id));
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...patch };
      return rows[idx];
    },
  };
}

const entry = (over = {}) => ({
  pricelist_id: 'pl-entry',
  name: 'כניסה לקיר',
  description: 'כניסה לקיר',
  unitprice: 60,
  quantity: 1,
  product_type: 'product',
  ...over,
});

test('offer normalization clamps bad input and fills defaults', () => {
  const o = normalizeOffer({ type: 'percent', value: 250, units: 0, validityDays: -5 });
  assert.equal(o.value, 100);
  assert.equal(o.units, 1);
  assert.equal(o.validityDays, 30);
  assert.equal(o.appliesTo, 'all');

  // A free item and one-plus-one carry no numeric value of their own.
  assert.equal(normalizeOffer({ type: 'free_item', value: 40 }).value, 0);
  assert.equal(normalizeOffer({ type: 'bogo', value: 40 }).value, 0);
  assert.equal(normalizeOffer({ type: 'nonsense' }).type, OFFER_TYPES.PERCENT);
});

test('offer summary falls back to a generated Hebrew label', () => {
  assert.equal(offerSummary({ type: 'percent', value: 50 }), '50% הנחה');
  assert.equal(offerSummary({ type: 'amount', value: 30 }), '₪30 הנחה');
  assert.equal(offerSummary({ type: 'free_item' }), 'פריט חינם');
  assert.equal(offerSummary({ type: 'bogo' }), 'אחד פלוס אחד');
  assert.equal(offerSummary({ type: 'percent', value: 50, label: 'חצי מחיר' }), 'חצי מחיר');
});

test('a percent benefit covers only the configured number of units', () => {
  const result = applyOfferToLines(
    { type: 'percent', value: 50, units: 1 },
    [entry({ quantity: 4 })]
  );
  assert.equal(result.applied, true);
  assert.equal(result.discount, 30);
  // 3 units at full price, 1 unit at half.
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].quantity, 3);
  assert.equal(result.lines[0].unitprice, 60);
  assert.equal(result.lines[1].quantity, 1);
  assert.equal(result.lines[1].unitprice, 30);
  assert.equal(result.lines[1].coupon_applied, true);
});

test('a percent benefit picks the most expensive eligible unit', () => {
  const result = applyOfferToLines({ type: 'percent', value: 50, units: 1 }, [
    entry({ name: 'זול', unitprice: 40 }),
    entry({ name: 'יקר', unitprice: 100 }),
  ]);
  assert.equal(result.discount, 50);
});

test('a shekel benefit never exceeds the eligible subtotal', () => {
  const result = applyOfferToLines({ type: 'amount', value: 500 }, [entry({ unitprice: 60 })]);
  assert.equal(result.discount, 60);
  assert.equal(result.lines[0].unitprice, 0);
});

test('a shekel benefit spreads across units, dearest first', () => {
  const result = applyOfferToLines({ type: 'amount', value: 80 }, [entry({ quantity: 2 })]);
  assert.equal(result.discount, 80);
  const total = result.lines.reduce((sum, l) => sum + l.unitprice * l.quantity, 0);
  assert.equal(total, 40); // 120 minus 80
});

test('one plus one frees the cheaper item of each pair', () => {
  const result = applyOfferToLines({ type: 'bogo', units: 1 }, [
    entry({ name: 'יקר', unitprice: 100 }),
    entry({ name: 'זול', unitprice: 60 }),
  ]);
  assert.equal(result.discount, 60);
});

test('one plus one does nothing when there is only one item', () => {
  const result = applyOfferToLines({ type: 'bogo', units: 1 }, [entry()]);
  assert.equal(result.applied, false);
  assert.equal(result.discount, 0);
});

test('a free item zeroes exactly one unit', () => {
  const result = applyOfferToLines({ type: 'free_item', units: 1 }, [entry({ quantity: 2 })]);
  assert.equal(result.discount, 60);
  const free = result.lines.find((l) => l.coupon_applied);
  assert.equal(free.unitprice, 0);
  assert.equal(free.quantity, 1);
});

test('a split line keeps its product identity, so stock and passes stay right', () => {
  const result = applyOfferToLines({ type: 'percent', value: 50, units: 1 }, [
    entry({ quantity: 3, product_type: 'punch_card', track_inventory: true, visits_total: 10 }),
  ]);
  assert.equal(result.lines.length, 2);
  for (const line of result.lines) {
    assert.equal(line.pricelist_id, 'pl-entry');
    assert.equal(line.product_type, 'punch_card');
    assert.equal(line.track_inventory, true);
    assert.equal(line.visits_total, 10);
    // The plain product name is what a pass is filed under — no benefit text.
    assert.equal(line.name, 'כניסה לקיר');
  }
  // Quantities still add up, so stock drops by 3 and 3 passes are issued.
  assert.equal(result.lines.reduce((sum, l) => sum + l.quantity, 0), 3);
  // The benefit is visible on the invoice line only.
  const discounted = result.lines.find((l) => l.coupon_applied);
  assert.match(discounted.description, /50% הנחה/);
  assert.equal(discounted.coupon_label, '50% הנחה');
  assert.equal(discounted.list_price, 60);
});

test('a shekel cap trims the benefit instead of dropping it', () => {
  const result = applyOfferToLines(
    { type: 'percent', value: 50, units: 2, maxDiscount: 40 },
    [entry({ quantity: 2, unitprice: 100 })]
  );
  assert.equal(result.discount, 40);
});

test('a benefit limited to chosen products ignores the rest of the cart', () => {
  const offer = { type: 'percent', value: 50, appliesTo: 'items', pricelistIds: ['pl-entry'] };
  const result = applyOfferToLines(offer, [
    entry({ pricelist_id: 'pl-other', name: 'מגנזיום', unitprice: 30 }),
  ]);
  assert.equal(result.applied, false);
  assert.equal(result.reason, 'no_eligible_items');

  const hit = applyOfferToLines(offer, [entry(), entry({ pricelist_id: 'pl-other', unitprice: 30 })]);
  assert.equal(hit.discount, 30);
});

test('a benefit limited to a product type matches on that type', () => {
  const offer = { type: 'free_item', appliesTo: 'product_type', productType: 'punch_card' };
  const result = applyOfferToLines(offer, [
    entry({ product_type: 'product', unitprice: 60 }),
    entry({ product_type: 'punch_card', unitprice: 400 }),
  ]);
  assert.equal(result.discount, 400);
});

test('free items in the cart are never selected', () => {
  assert.deepEqual(selectDiscountedUnits({ type: 'percent', value: 50 }, [entry({ unitprice: 0 })]), []);
});

test('coupon state reflects expiry without a nightly job', () => {
  const coupon = { status: COUPON_STATUS.ACTIVE, expires_at: '2026-08-01' };
  assert.equal(couponState(coupon, '2026-07-30'), COUPON_STATUS.ACTIVE);
  assert.equal(couponState(coupon, '2026-08-01'), COUPON_STATUS.ACTIVE);
  assert.equal(couponState(coupon, '2026-08-02'), COUPON_STATUS.EXPIRED);
  assert.equal(
    couponState({ status: COUPON_STATUS.REDEEMED, expires_at: '2026-01-01' }, '2026-08-02'),
    COUPON_STATUS.REDEEMED
  );
});

test('a coupon matches its owner by customer card or by trainee', () => {
  const coupon = { parent_id: 'p1', student_id: 's1' };
  assert.equal(couponBelongsTo(coupon, { parentId: 'p1' }), true);
  assert.equal(couponBelongsTo(coupon, { studentId: 's1' }), true);
  assert.equal(couponBelongsTo(coupon, { parentId: 'p2', studentId: 's2' }), false);
});

test('issuing a coupon snapshots the offer and sets an expiry', () => {
  const db = fakeDb({ customer_coupons: [] });
  const coupon = issueCoupon(db, {
    offer: { type: 'percent', value: 50, validityDays: 30, label: 'חצי מחיר' },
    parentId: 'p1',
    studentId: 's1',
    campaignId: 'c1',
    today: '2026-07-29',
  });
  assert.equal(coupon.expires_at, addDaysIso('2026-07-29', 30));
  assert.equal(coupon.label, 'חצי מחיר');
  assert.equal(coupon.offer.value, 50);
  assert.equal(coupon.code.length, 6);
  assert.equal(daysBetween(coupon.issued_at, coupon.expires_at), 30);
});

test('issuing without a customer is refused', () => {
  const db = fakeDb();
  assert.throws(() => issueCoupon(db, { offer: { type: 'percent', value: 10 } }), /לקוח/);
});

test('the sale check refuses expired, redeemed and other customers coupons', () => {
  const db = fakeDb({
    customer_coupons: [
      {
        id: 'cp1',
        code: 'ABC123',
        parent_id: 'p1',
        status: COUPON_STATUS.ACTIVE,
        expires_at: '2026-08-30',
        offer: { type: 'percent', value: 50, units: 1 },
      },
    ],
  });

  assert.match(
    checkCouponForSale(db, { code: 'NOPE', parentId: 'p1', lines: [entry()] }).error,
    /לא נמצא/
  );
  assert.match(
    checkCouponForSale(db, { code: 'ABC123', parentId: 'p2', lines: [entry()], today: '2026-07-29' })
      .error,
    /לקוח אחר/
  );
  assert.match(
    checkCouponForSale(db, { code: 'ABC123', parentId: 'p1', lines: [entry()], today: '2026-09-01' })
      .error,
    /פג/
  );

  const ok = checkCouponForSale(db, {
    code: 'abc123',
    parentId: 'p1',
    lines: [entry()],
    today: '2026-07-29',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.discount, 30);
});

test('the sale check refuses a cart with nothing the benefit applies to', () => {
  const db = fakeDb({
    customer_coupons: [
      {
        id: 'cp1',
        code: 'ABC123',
        parent_id: 'p1',
        status: COUPON_STATUS.ACTIVE,
        expires_at: '2026-08-30',
        offer: { type: 'percent', value: 50, appliesTo: 'items', pricelistIds: ['pl-x'] },
      },
    ],
  });
  const result = checkCouponForSale(db, {
    code: 'ABC123',
    parentId: 'p1',
    lines: [entry()],
    today: '2026-07-29',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /מתאים/);
});

test('a refund gives the coupon back, unless it expired meanwhile', () => {
  const db = fakeDb({
    customer_coupons: [
      { id: 'cp1', status: COUPON_STATUS.ACTIVE, expires_at: '2026-08-30', parent_id: 'p1' },
      { id: 'cp2', status: COUPON_STATUS.ACTIVE, expires_at: '2026-07-01', parent_id: 'p1' },
    ],
  });
  redeemCoupon(db, 'cp1', { saleId: 'sale1', amount: 30 });
  redeemCoupon(db, 'cp2', { saleId: 'sale1', amount: 20 });
  assert.equal(db.getOne('customer_coupons', 'cp1').status, COUPON_STATUS.REDEEMED);

  releaseCouponsForSale(db, 'sale1', '2026-07-29');
  assert.equal(db.getOne('customer_coupons', 'cp1').status, COUPON_STATUS.ACTIVE);
  assert.equal(db.getOne('customer_coupons', 'cp1').pos_sale_id, null);
  assert.equal(db.getOne('customer_coupons', 'cp2').status, COUPON_STATUS.EXPIRED);
});

test('due coupons expire once and stay expired', () => {
  const db = fakeDb({
    customer_coupons: [
      { id: 'cp1', status: COUPON_STATUS.ACTIVE, expires_at: '2026-07-01' },
      { id: 'cp2', status: COUPON_STATUS.ACTIVE, expires_at: '2026-12-01' },
    ],
  });
  assert.equal(expireDueCoupons(db, '2026-07-29'), 1);
  assert.equal(expireDueCoupons(db, '2026-07-29'), 0);
  assert.equal(db.getOne('customer_coupons', 'cp2').status, COUPON_STATUS.ACTIVE);
});

test('campaign stats count redemptions and exclude refunded revenue', () => {
  const db = fakeDb({
    customer_coupons: [
      { id: 'cp1', campaign_id: 'c1', status: COUPON_STATUS.REDEEMED, pos_sale_id: 'sale1' },
      { id: 'cp2', campaign_id: 'c1', status: COUPON_STATUS.REDEEMED, pos_sale_id: 'sale2' },
      { id: 'cp3', campaign_id: 'c1', status: COUPON_STATUS.ACTIVE, expires_at: '2026-12-01' },
      { id: 'cp4', campaign_id: 'c1', status: COUPON_STATUS.ACTIVE, expires_at: '2026-01-01' },
      { id: 'cp5', campaign_id: 'c2', status: COUPON_STATUS.ACTIVE, expires_at: '2026-12-01' },
    ],
    pos_sales: [
      { id: 'sale1', total: 120, status: 'paid' },
      { id: 'sale2', total: 90, status: 'refunded' },
    ],
  });
  const stats = couponStats(db, 'c1', '2026-07-29');
  assert.equal(stats.issued, 4);
  assert.equal(stats.redeemed, 2);
  assert.equal(stats.active, 1);
  assert.equal(stats.expired, 1);
  assert.equal(stats.revenue, 120);
});
