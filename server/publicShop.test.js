import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createShopPurchase,
  findShopItemBySlug,
  isSelfServeItem,
  publicShopItems,
  shopItemPayload,
} from './publicShop.js';

/**
 * Health declarations do not expire a year after signing — they expire
 * together, at the end of July in even years. A fixture dated by hand is
 * therefore in force until a cycle rolls over and then silently is not, which
 * is what happened to this file on 1.8.2026. Derived from today, it stays
 * true: a declaration signed now is always in force, and one from 2020 is
 * always past.
 */
const IN_FORCE_SIGNED_DATE = new Date().toISOString().slice(0, 10);
const HEALTHY_ANSWERS = {
  ...Object.fromEntries(
    Array.from({ length: 9 }, (_unused, index) => [`m${index + 1}`, false])
  ),
  required: true,
};

const punchCard = {
  id: 'pl-1',
  name: 'כרטיסייה 10 כניסות',
  description: '10 כניסות לקיר',
  notes: 'שולי רווח 40%',
  price: 400,
  active: true,
  product_type: 'punch_card',
  visits_total: 10,
  validity_days: 365,
  self_serve: true,
  public_slug: 'abc123',
  grants_wall_climbing: true,
};

function createDb(seed = {}) {
  const store = {
    parents: [],
    students: [],
    health_declarations: [],
    participation_waivers: [],
    health_holds: [],
    pricelist: [punchCard],
    pos_sales: [],
    payments: [],
    form_templates: [{
      id: 'form-1',
      slug: 'wall',
      title: 'הצהרה',
      waiverText: 'כתב ויתור',
      healthQuestions: [{ id: 'required', label: 'אני כשיר', requireYes: true }],
      isDefault: true,
      isActive: true,
    }],
    ...seed,
  };
  let sequence = 0;
  return {
    store,
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((item) => item.id === id),
    insert: (table, row) => {
      const saved = { ...row, id: row.id || `${table}-${++sequence}` };
      store[table] ||= [];
      store[table].push(saved);
      return saved;
    },
    update: (table, id, patch) => {
      const index = (store[table] || []).findIndex((item) => item.id === id);
      if (index < 0) return null;
      store[table][index] = { ...store[table][index], ...patch };
      return store[table][index];
    },
    upsertParentByPhone: (name, phone, email) => {
      const normalized = String(phone).replace(/\D/g, '').replace(/^972/, '0');
      let parent = store.parents.find(
        (row) => String(row.phone).replace(/\D/g, '').replace(/^972/, '0') === normalized
      );
      if (!parent) {
        parent = { id: `parent-${++sequence}`, name, phone: normalized, email };
        store.parents.push(parent);
      }
      return parent;
    },
  };
}

const persist = async () => ({ ok: true });
const buyer = { name: 'דנה כהן', phone: '050-123-4567', email: 'dana@example.com' };
const signedHolder = {
  type: 'child',
  name: 'יהלי',
  birthDate: '2015-04-01',
  answers: { ...HEALTHY_ANSWERS },
  waiverAccepted: true,
  signature: 'data:image/png;base64,signed',
};

function purchase(db, payload, extra = {}) {
  return createShopPurchase({
    db,
    persist,
    item: punchCard,
    payload,
    createPaymentUrl: async () => 'https://pay.example/checkout',
    ...extra,
  });
}

test('only an active, priced, flagged pass is offered publicly', () => {
  assert.equal(isSelfServeItem(punchCard), true);
  assert.equal(isSelfServeItem({ ...punchCard, self_serve: false }), false);
  assert.equal(isSelfServeItem({ ...punchCard, active: false }), false);
  assert.equal(isSelfServeItem({ ...punchCard, price: 0 }), false);
  assert.equal(isSelfServeItem({ ...punchCard, public_slug: '' }), false);
  // A physical product has no delivery path in this flow.
  assert.equal(isSelfServeItem({ ...punchCard, product_type: 'product' }), false);

  const db = createDb({
    pricelist: [punchCard, { ...punchCard, id: 'pl-2', public_slug: 'zzz', self_serve: false }],
  });
  assert.deepEqual(publicShopItems(db).map((row) => row.slug), ['abc123']);
  assert.equal(findShopItemBySlug(db, 'zzz'), null);
  assert.equal(findShopItemBySlug(db, 'abc123')?.id, 'pl-1');
});

test('the public payload carries no internal fields', () => {
  const payload = shopItemPayload(punchCard);
  assert.equal(payload.notes, undefined);
  assert.equal(payload.id, undefined);
  assert.equal(payload.visits_total, 10);
  assert.equal(payload.duration_days, null);
});

test('purchase opens a customer file and a pending sale, and issues no pass', async () => {
  const db = createDb();
  const result = await purchase(db, {
    idempotency_key: 'buy-1',
    parent: buyer,
    holder: signedHolder,
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.paymentUrl, 'https://pay.example/checkout');
  assert.equal(db.store.parents.length, 1);
  assert.equal(db.store.students.length, 1);
  assert.equal(db.store.health_declarations.length, 1);
  assert.equal(db.store.participation_waivers.length, 1);

  const sale = db.store.pos_sales[0];
  const payment = db.store.payments[0];
  assert.equal(sale.status, 'pending_payment');
  assert.equal(sale.total, 400);
  assert.equal(sale.student_id, db.store.students[0].id);
  assert.equal(sale.parent_id, db.store.parents[0].id);
  assert.equal(sale.items[0].product_type, 'punch_card');
  assert.equal(sale.items[0].visits_total, 10);
  // The webhook is the only place a pass is created — nothing is granted up front.
  assert.equal((db.store.customer_passes || []).length, 0);
  assert.equal(payment.pos_sale_id, sale.id);
  assert.equal(payment.status, 'pending');
  assert.equal(payment.amount, 400);
});

test('a declaration still in force is reused instead of re-signed', async () => {
  const db = createDb({
    parents: [{ id: 'p1', name: 'דנה כהן', phone: '0501234567', email: 'dana@example.com' }],
    students: [{
      id: 's1',
      name: 'יהלי',
      parentId: 'p1',
      birthDate: '2015-04-01',
      healthSignedAt: `${IN_FORCE_SIGNED_DATE}T10:00:00.000Z`,
    }],
    health_declarations: [{
      id: 'hd1',
      studentId: 's1',
      parentId: 'p1',
      climberName: 'יהלי',
      signedDate: IN_FORCE_SIGNED_DATE,
      date: IN_FORCE_SIGNED_DATE,
      signed: true,
      signature_url: 'data:image/png;base64,old-health',
    }],
    participation_waivers: [{
      id: 'pw1',
      student_id: 's1',
      scope: 'wall',
      signed_at: `${IN_FORCE_SIGNED_DATE}T10:00:00.000Z`,
      signed: true,
      signature_url: 'data:image/png;base64,old',
    }],
  });
  const result = await purchase(db, {
    idempotency_key: 'buy-reuse',
    parent: buyer,
    // No signature, no answers — the customer was never shown the form.
    holder: { type: 'child', id: 's1', name: 'יהלי', reuse_health: true },
  });

  assert.equal(db.store.health_declarations.length, 1);
  assert.equal(db.store.participation_waivers.length, 1);
  assert.equal(result.declaration.id, 'hd1');
  assert.equal(result.waiver.id, 'pw1');
  assert.equal(db.store.pos_sales[0].student_id, 's1');
});

test('reuse is refused when no declaration is in force', async () => {
  const db = createDb();
  await assert.rejects(
    purchase(db, {
      idempotency_key: 'buy-no-decl',
      parent: buyer,
      holder: { type: 'child', name: 'ילד חדש', birthDate: '2016-01-01', reuse_health: true },
    }),
    /אין הצהרת בריאות בתוקף/
  );
  assert.equal(db.store.pos_sales.length, 0);
  assert.equal(db.store.payments.length, 0);
});

test('an unsigned declaration is refused', async () => {
  const db = createDb();
  await assert.rejects(
    purchase(db, {
      idempotency_key: 'buy-unsigned',
      parent: buyer,
      holder: { ...signedHolder, signature: '' },
    }),
    /חסרה חתימה/
  );
});

test('a double click charges once', async () => {
  const db = createDb();
  const payload = { idempotency_key: 'same-key', parent: buyer, holder: signedHolder };
  const [first, second] = await Promise.all([purchase(db, payload), purchase(db, payload)]);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.paymentUrl, 'https://pay.example/checkout');
  assert.equal(db.store.pos_sales.length, 1);
  assert.equal(db.store.payments.length, 1);
});

test('an invoice needs an address to go to', async () => {
  const db = createDb();
  await assert.rejects(
    purchase(db, {
      idempotency_key: 'no-email',
      parent: { ...buyer, email: '' },
      holder: signedHolder,
    }),
    /דואר אלקטרוני/
  );
});

test('a failed billing sync does not block the sale', async () => {
  const db = createDb();
  const result = await purchase(db, {
    idempotency_key: 'sync-fails',
    parent: buyer,
    holder: signedHolder,
  }, {
    syncCustomer: async () => { throw new Error('iCount down'); },
  });
  assert.equal(result.duplicate, false);
  assert.equal(db.store.pos_sales[0].icount_client_id, null);
});
