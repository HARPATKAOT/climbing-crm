import test from 'node:test';
import assert from 'node:assert/strict';
import {
  remainingCapacity,
  registrationIsOpen,
  normalizeHostPaymentStatus,
  openUnpaidActivities,
  publicRegistrationPayload,
  normalizeTemplateCategory,
  groupTemplatesByCategory,
  ensureSeedActivityTemplates,
  STARTER_ACTIVITY_TEMPLATES,
} from './activityRegistration.js';

test('remainingCapacity respects max and active count', () => {
  assert.equal(remainingCapacity({ max_participants: 10 }, [{}, {}, {}]), 7);
  assert.equal(remainingCapacity({ max_participants: null }, [{}, {}]), null);
  assert.equal(remainingCapacity({ max_participants: 2 }, [{}, {}, {}]), 0);
});

test('registrationIsOpen checks flags and close date', () => {
  assert.equal(registrationIsOpen({ registration_enabled: true, status: 'open' }), true);
  assert.equal(registrationIsOpen({ registration_enabled: false, status: 'open' }), false);
  assert.equal(registrationIsOpen({ registration_enabled: true, status: 'cancelled' }), false);
  assert.equal(
    registrationIsOpen({
      registration_enabled: true,
      status: 'open',
      registration_closes_at: '2000-01-01T00:00:00.000Z',
    }),
    false
  );
});

test('normalizeHostPaymentStatus', () => {
  assert.equal(normalizeHostPaymentStatus('paid'), 'paid');
  assert.equal(normalizeHostPaymentStatus('refunded'), 'refunded');
  assert.equal(normalizeHostPaymentStatus('weird'), 'unpaid');
});

test('normalizeTemplateCategory', () => {
  assert.equal(normalizeTemplateCategory('field'), 'field');
  assert.equal(normalizeTemplateCategory('wall'), 'wall');
  assert.equal(normalizeTemplateCategory('other'), 'wall');
});

test('openUnpaidActivities filters past and paid', () => {
  const db = {
    get: () => [
      { id: '1', name: 'A', date: '2099-01-01', payment_status: 'unpaid', status: 'open' },
      { id: '2', name: 'B', date: '2099-01-02', payment_status: 'paid', status: 'open' },
      { id: '3', name: 'C', date: '2000-01-01', payment_status: 'unpaid', status: 'open' },
      { id: '4', name: 'D', date: '2099-01-03', payment_status: 'unpaid', status: 'cancelled' },
      { id: '5', name: 'E', date: '2099-01-04', payment_status: 'refunded', status: 'open' },
    ],
  };
  const rows = openUnpaidActivities(db, { fromDate: '2026-07-25' });
  assert.deepEqual(rows.map((r) => r.id), ['1']);
});

test('openUnpaidActivities skips events paid per participant', () => {
  const db = {
    get: () => [
      { id: '1', date: '2099-01-01', payment_status: 'unpaid', status: 'open', registration_mode: 'host_pays' },
      { id: '2', date: '2099-01-02', payment_status: 'unpaid', status: 'open', registration_mode: 'paid_per_participant' },
      { id: '3', date: '2099-01-03', payment_status: 'unpaid', status: 'open', collect_registration_payment: true },
    ],
  };
  const rows = openUnpaidActivities(db, { fromDate: '2026-07-25' });
  assert.deepEqual(rows.map((r) => r.id), ['1']);
});

test('publicRegistrationPayload exposes collect_payment', () => {
  const payload = publicRegistrationPayload(
    {
      id: 'a1',
      name: 'מסיבה',
      price: 50,
      collect_registration_payment: true,
      registration_enabled: true,
      status: 'open',
      max_participants: 5,
    },
    [{}, {}]
  );
  assert.equal(payload.collect_payment, true);
  assert.equal(payload.remaining, 3);
  assert.equal(payload.registration_open, true);
});

test('publicRegistrationPayload exposes cover_image from theme', () => {
  const payload = publicRegistrationPayload(
    {
      id: 'a2',
      name: 'טיול',
      registration_page_title: 'טיול לנחל',
      registration_theme: { cover_image: 'https://example.com/cover.jpg' },
      registration_enabled: true,
      status: 'open',
    },
    []
  );
  assert.equal(payload.cover_image, 'https://example.com/cover.jpg');
  assert.equal(payload.page_title, 'טיול לנחל');
});

test('publicRegistrationPayload parses theme JSON string', () => {
  const payload = publicRegistrationPayload(
    {
      id: 'a3',
      name: 'יום הולדת',
      registration_theme: '{"cover_image":"https://cdn.example/cover.jpg","cover_position":"50% 20%"}',
      registration_enabled: true,
      status: 'open',
    },
    []
  );
  assert.equal(payload.cover_image, 'https://cdn.example/cover.jpg');
  assert.equal(payload.cover_position, '50% 20%');
});

test('starter templates cover all categories', () => {
  const cats = new Set(STARTER_ACTIVITY_TEMPLATES.map((t) => t.category));
  assert.ok(cats.has('field'));
  assert.ok(cats.has('wall'));
  assert.ok(cats.has('ops'));
  assert.ok(STARTER_ACTIVITY_TEMPLATES.length >= 9);
});

test('ensureSeedActivityTemplates is idempotent', () => {
  const store = { activity_templates: [] };
  const db = {
    get: (table) => store[table] || [],
    insert: (table, row) => {
      const rec = { ...row, id: row.id };
      store[table] = store[table] || [];
      store[table].push(rec);
      return rec;
    },
  };
  const first = ensureSeedActivityTemplates(db);
  const second = ensureSeedActivityTemplates(db);
  assert.equal(first.inserted, STARTER_ACTIVITY_TEMPLATES.length);
  assert.equal(second.inserted, 0);
  assert.equal(store.activity_templates.length, STARTER_ACTIVITY_TEMPLATES.length);
  const grouped = groupTemplatesByCategory(store.activity_templates);
  assert.equal(grouped.length, 3);
  assert.ok(grouped.find((g) => g.id === 'field').templates.length >= 3);
  assert.ok(grouped.find((g) => g.id === 'wall').templates.length >= 3);
  assert.ok(grouped.find((g) => g.id === 'ops').templates.length >= 3);
});
