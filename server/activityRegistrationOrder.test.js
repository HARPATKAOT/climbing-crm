import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markHostedActivityPaid,
  markRegistrationOrderPaid,
  registerActivityGroup,
} from './activityRegistrationOrderService.js';

function createDb(seed = {}) {
  const store = {
    parents: [],
    students: [],
    form_templates: [{
      id: 'form-1',
      slug: 'wall',
      title: 'הצהרה',
      waiverText: 'כתב ויתור מלא',
      healthQuestions: [{ id: 'required', label: 'אני כשיר', requireYes: true }],
      isDefault: true,
      isActive: true,
    }],
    health_declarations: [],
    activities: [],
    activity_registration_orders: [],
    activity_registrations: [],
    payments: [],
    ...seed,
  };
  let sequence = 0;
  return {
    store,
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((item) => item.id === id),
    insert: (table, row) => {
      const saved = {
        ...row,
        id: row.id || `${table}-${++sequence}`,
        created_at: row.created_at || new Date().toISOString(),
      };
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
        (item) => String(item.phone).replace(/\D/g, '').replace(/^972/, '0') === normalized
      );
      if (!parent) {
        parent = { id: `parent-${++sequence}`, name, phone: normalized, email };
        store.parents.push(parent);
      }
      return parent;
    },
  };
}

const signed = (name, type = 'child') => ({
  name,
  type,
  birthDate: type === 'child' ? '2015-01-01' : '',
  answers: { required: true },
  waiverAccepted: true,
  signature: 'data:image/png;base64,signed',
});

const parent = { name: 'אמא ישראלי', phone: '050-123-4567', email: 'parent@example.com' };
const persist = async () => ({ ok: true });

test('paid parent and two children reserve three slots and price units', async () => {
  const db = createDb();
  const activity = {
    id: 'activity-paid',
    name: 'טיול',
    price: 100,
    max_participants: 10,
    registration_mode: 'paid_per_participant',
  };
  db.store.activities.push(activity);
  const result = await registerActivityGroup({
    db,
    persist,
    activity,
    payload: {
      idempotency_key: 'paid-three',
      parent,
      participants: [signed('אמא ישראלי', 'adult'), signed('ילד א'), signed('ילד ב')],
    },
    createPaymentUrl: async () => 'https://pay.example/order',
  });
  assert.equal(result.order.participant_count, 3);
  assert.equal(result.order.total_amount, 300);
  assert.equal(result.registrations.length, 3);
  assert.equal(db.store.health_declarations.length, 3);
  assert.ok(result.registrations.every((row) => row.health_declaration_id));
  assert.ok(db.store.health_declarations.every((row) => row.signed && row.signature_url));
  assert.equal(result.registrations[0].student_id, null);
});

test('existing parent is deduplicated and a missing child is created', async () => {
  const db = createDb({
    parents: [{ id: 'existing-parent', name: 'אמא', phone: '0501234567', email: '' }],
  });
  const activity = {
    id: 'activity-free',
    name: 'יום הולדת',
    price: 1200,
    max_participants: 20,
    registration_mode: 'host_pays',
  };
  db.store.activities.push(activity);
  const result = await registerActivityGroup({
    db,
    persist,
    activity,
    payload: {
      idempotency_key: 'existing-parent',
      parent: { ...parent, phone: '+972501234567' },
      participants: [signed('ילדה חדשה')],
    },
    createPaymentUrl: async () => null,
  });
  assert.equal(db.store.parents.length, 1);
  assert.equal(result.order.parent_id, 'existing-parent');
  assert.equal(db.store.students.length, 1);
  assert.equal(result.order.total_amount, 0);
  assert.equal(result.order.status, 'confirmed');
});

test('capacity rejects oversized group and duplicate concurrent retry is idempotent', async () => {
  const db = createDb();
  const activity = {
    id: 'activity-capacity',
    name: 'פעילות',
    price: 50,
    max_participants: 2,
    registration_mode: 'paid_per_participant',
  };
  db.store.activities.push(activity);
  const payload = {
    idempotency_key: 'same-request',
    parent,
    participants: [signed('ילד א'), signed('ילד ב')],
  };
  const [first, second] = await Promise.all([
    registerActivityGroup({ db, persist, activity, payload, createPaymentUrl: async () => 'pay' }),
    registerActivityGroup({ db, persist, activity, payload, createPaymentUrl: async () => 'pay' }),
  ]);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(db.store.activity_registration_orders.length, 1);
  assert.equal(db.store.activity_registrations.length, 2);

  await assert.rejects(
    registerActivityGroup({
      db,
      persist,
      activity: { ...activity, id: 'full', max_participants: 1 },
      payload: { ...payload, idempotency_key: 'too-many' },
      createPaymentUrl: async () => 'pay',
    }),
    /נותרו רק 1/
  );
});

test('payment confirmation and hosted payment are idempotent', async () => {
  const db = createDb({
    activities: [{
      id: 'hosted',
      registration_mode: 'host_pays',
      payment_status: 'unpaid',
      host_payment_id: 'payment-host',
    }],
    activity_registration_orders: [{
      id: 'order-paid',
      status: 'pending_payment',
      payment_status: 'pending',
    }],
    activity_registrations: [{
      id: 'registration-paid',
      order_id: 'order-paid',
      status: 'pending_payment',
      payment_status: 'pending',
    }, {
      id: 'host-participant',
      activity_id: 'hosted',
      status: 'confirmed',
      payment_status: 'not_required',
    }],
  });
  const firstOrder = await markRegistrationOrderPaid({
    db, persist, orderId: 'order-paid', paidAt: '2026-07-25T10:00:00.000Z',
  });
  const secondOrder = await markRegistrationOrderPaid({
    db, persist, orderId: 'order-paid', paidAt: '2026-07-25T10:00:00.000Z',
  });
  assert.equal(firstOrder.duplicate, false);
  assert.equal(secondOrder.duplicate, true);
  assert.equal(db.store.activity_registrations[0].status, 'confirmed');

  const firstHost = await markHostedActivityPaid({
    db, persist, activityId: 'hosted', paymentId: 'payment-host',
  });
  const secondHost = await markHostedActivityPaid({
    db, persist, activityId: 'hosted', paymentId: 'payment-host',
  });
  assert.equal(firstHost.duplicate, false);
  assert.equal(secondHost.duplicate, true);
  assert.equal(db.store.activities[0].payment_status, 'paid');
  assert.equal(db.store.activity_registrations[0].payment_status, 'paid');
  assert.equal(db.store.activity_registrations[1].payment_status, 'not_required');
});
