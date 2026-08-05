import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureStudentEquipment,
  markEquipmentItemsPaid,
  resetShoeRental,
  markEquipmentGiven,
  markEquipmentOwn,
  markEquipmentUnpaid,
  markEquipmentDeclined,
  computeEquipmentTotal,
  normalizeEquipmentSettings,
  isKidStudent,
  isEquipmentEligibleStudent,
  equipmentItemTypesForStudent,
  backfillAdultEquipment,
  applyEquipmentFamilyDiscount,
  equipmentGapFlags,
  unpaidEquipmentItems,
  DEFAULT_EQUIPMENT_SETTINGS,
  DEFAULT_CHALK_BAG_INFO,
  equipmentPublicBase,
  EQUIPMENT_LIVE_APP_BASE,
  EQUIPMENT_LIVE_API_BASE,
  EQUIPMENT_TEMPLATE_NAME,
  equipmentRedirectBase,
  buildEquipmentRedirectUrl,
  ensureEquipmentWhatsappTemplate,
} from './equipmentService.js';

function makeDb(seed = {}) {
  const store = { ...seed };
  for (const key of Object.keys(store)) {
    if (!Array.isArray(store[key])) store[key] = [];
  }
  return {
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((r) => r.id === id) || null,
    insert: (table, record) => {
      if (!store[table]) store[table] = [];
      const row = {
        ...record,
        id: record.id || `${table}-${store[table].length + 1}`,
        created_at: record.created_at || new Date().toISOString(),
      };
      store[table].push(row);
      return row;
    },
    update: (table, id, updates) => {
      const list = store[table] || [];
      const idx = list.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      list[idx] = { ...list[idx], ...updates, updated_at: new Date().toISOString() };
      return list[idx];
    },
  };
}

test('isKidStudent excludes adults and parent-only', () => {
  assert.equal(isKidStudent({ id: 's1', isAdult: false }), true);
  assert.equal(isKidStudent({ id: 's1', isAdult: true }), false);
  assert.equal(isKidStudent({ id: 'parent:p1', _parentOnly: true }), false);
});

test('ensureStudentEquipment creates three unpaid rows', () => {
  const db = makeDb({ students: [{ id: 's1', parentId: 'p1', isAdult: false }], student_equipment: [] });
  const rows = ensureStudentEquipment({ db, student: db.getOne('students', 's1') });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.item_type).sort(), ['chalk_bag', 'shirt', 'shoes']);
  assert.ok(rows.every((r) => r.payment_status === 'unpaid'));
});

test('adult trainees receive shoes and chalk only', () => {
  const db = makeDb({
    students: [{ id: 'a1', parentId: 'p1', isAdult: true, status: 'active' }],
    student_equipment: [],
  });
  const adult = db.getOne('students', 'a1');
  assert.equal(isEquipmentEligibleStudent(adult), true);
  assert.deepEqual(equipmentItemTypesForStudent(adult), ['shoes', 'chalk_bag']);
  const rows = ensureStudentEquipment({ db, student: adult });
  assert.deepEqual(rows.map((row) => row.item_type), ['shoes', 'chalk_bag']);

  const paid = markEquipmentItemsPaid({
    db,
    studentId: adult.id,
    itemTypes: ['shoes', 'shirt', 'chalk_bag'],
    paymentId: 'adult-payment',
  });
  assert.equal(paid.errors.length, 0);
  assert.deepEqual(paid.updated.map((row) => row.item_type), ['shoes', 'chalk_bag']);
});

test('adult equipment backfill ignores archived and parent-only cards', () => {
  const db = makeDb({
    students: [
      { id: 'a1', isAdult: true, status: 'active' },
      { id: 'a2', isAdult: true, status: 'archived' },
      { id: 'parent:p1', isAdult: true, _parentOnly: true, status: 'active' },
      { id: 'k1', isAdult: false, status: 'active' },
    ],
    student_equipment: [],
  });
  const result = backfillAdultEquipment({ db });
  assert.deepEqual(result, { students: 1, created: 2 });
  assert.deepEqual(db.get('student_equipment').map((row) => row.student_id), ['a1', 'a1']);
});

test('family discount applies to the full basket only for two or more trainees', () => {
  const settings = normalizeEquipmentSettings({
    family_discount_enabled: true,
    family_discount_percent: 5,
  });
  const one = applyEquipmentFamilyDiscount(settings, [{ student_id: 's1', subtotal: 200 }]);
  assert.equal(one.discount, 0);
  assert.equal(one.total, 200);

  const family = applyEquipmentFamilyDiscount(settings, [
    { student_id: 's1', subtotal: 200 },
    { student_id: 's2', subtotal: 100 },
  ]);
  assert.equal(family.eligible, true);
  assert.equal(family.percent, 5);
  assert.equal(family.subtotal, 300);
  assert.equal(family.discount, 15);
  assert.equal(family.total, 285);
  assert.equal(family.allocations.reduce((sum, row) => sum + row.total, 0), 285);

  const disabled = applyEquipmentFamilyDiscount(
    { family_discount_enabled: false, family_discount_percent: 25 },
    [{ student_id: 's1', subtotal: 40 }, { student_id: 's2', subtotal: 60 }]
  );
  assert.equal(disabled.discount, 0);
  assert.equal(disabled.total, 100);
});

test('family discount settings default to 5 percent and clamp to 0-100', () => {
  assert.equal(normalizeEquipmentSettings({}).family_discount_enabled, true);
  assert.equal(normalizeEquipmentSettings({}).family_discount_percent, 5);
  assert.equal(normalizeEquipmentSettings({ family_discount_percent: 250 }).family_discount_percent, 100);
  assert.equal(normalizeEquipmentSettings({ family_discount_percent: -2 }).family_discount_percent, 0);
});

test('magnesium explanation is concise by default and remains owner-editable', () => {
  assert.equal(normalizeEquipmentSettings({}).item_info.chalk_bag, DEFAULT_CHALK_BAG_INFO);
  assert.equal(
    normalizeEquipmentSettings({ item_info: { chalk_bag: 'טקסט מותאם של העסק' } }).item_info.chalk_bag,
    'טקסט מותאם של העסק'
  );
  assert.equal(
    normalizeEquipmentSettings({
      item_info: {
        chalk_bag: 'מגנזיום הוא אבקה לבנה שמייבשת את הידיים מזיעה, כדי שהאחיזה לא תחליק. כל מטפס משתמש בה. השק נקשר למותן ומלווה את הילד/ה לאורך כל שנות הטיפוס.',
      },
    }).item_info.chalk_bag,
    DEFAULT_CHALK_BAG_INFO
  );
});

test('markEquipmentItemsPaid sets shoes rental window and shirt size', () => {
  const db = makeDb({ students: [{ id: 's1', parentId: 'p1', isAdult: false }], student_equipment: [] });
  ensureStudentEquipment({ db, student: db.getOne('students', 's1') });
  const { updated } = markEquipmentItemsPaid({
    db,
    studentId: 's1',
    itemTypes: ['shoes', 'shirt'],
    shirtSize: '12',
    paymentId: 'pay1',
    rentalDays: 182,
    paidAt: '2026-01-01T10:00:00.000Z',
  });
  assert.equal(updated.length, 2);
  const shoes = db.get('student_equipment').find((r) => r.item_type === 'shoes');
  const shirt = db.get('student_equipment').find((r) => r.item_type === 'shirt');
  assert.equal(shoes.payment_status, 'paid');
  assert.ok(shoes.rental_starts_at);
  assert.ok(shoes.rental_ends_at);
  assert.equal(shirt.shirt_size, '12');
  assert.equal(shirt.fulfillment_status, 'pending');
});

test('resetShoeRental clears payment and rental dates', () => {
  const db = makeDb({ students: [{ id: 's1', parentId: 'p1', isAdult: false }], student_equipment: [] });
  const rows = ensureStudentEquipment({ db, student: db.getOne('students', 's1') });
  markEquipmentItemsPaid({ db, studentId: 's1', itemTypes: ['shoes'], paymentId: 'pay1' });
  const shoes = rows.find((r) => r.item_type === 'shoes');
  const result = resetShoeRental({ db, rowId: shoes.id });
  assert.equal(result.ok, true);
  assert.equal(result.row.payment_status, 'unpaid');
  assert.equal(result.row.rental_starts_at, null);
});

test('markEquipmentGiven requires paid', () => {
  const db = makeDb({ students: [{ id: 's1', parentId: 'p1', isAdult: false }], student_equipment: [] });
  const rows = ensureStudentEquipment({ db, student: db.getOne('students', 's1') });
  const unpaid = markEquipmentGiven({ db, rowId: rows[0].id });
  assert.equal(unpaid.ok, false);
  markEquipmentItemsPaid({ db, studentId: 's1', itemTypes: [rows[0].item_type] });
  const paid = markEquipmentGiven({ db, rowId: rows[0].id, givenBy: 'coach' });
  assert.equal(paid.ok, true);
  assert.equal(paid.row.fulfillment_status, 'given');
});

test('computeEquipmentTotal and gap flags', () => {
  const settings = normalizeEquipmentSettings(DEFAULT_EQUIPMENT_SETTINGS);
  assert.equal(computeEquipmentTotal(settings, ['shoes', 'shirt']), settings.prices.shoes + settings.prices.shirt);
  const gaps = equipmentGapFlags([
    { payment_status: 'unpaid', fulfillment_status: 'pending' },
    { payment_status: 'paid', fulfillment_status: 'pending' },
    { payment_status: 'paid', fulfillment_status: 'given' },
    { payment_status: 'own', fulfillment_status: 'pending' },
  ]);
  assert.equal(gaps.hasUnpaid, true);
  assert.equal(gaps.hasAwaitingHandoff, true);
  assert.equal(gaps.unpaidCount, 1);
  assert.equal(gaps.awaitingCount, 1);
  assert.equal(unpaidEquipmentItems([
    { payment_status: 'unpaid' },
    { payment_status: 'own' },
    { payment_status: 'paid' },
  ]).length, 1);
});

test('markEquipmentOwn clears payment and rental; unpaid restores gap', () => {
  const db = makeDb({ students: [{ id: 's1', parentId: 'p1', isAdult: false }], student_equipment: [] });
  const rows = ensureStudentEquipment({ db, student: db.getOne('students', 's1') });
  markEquipmentItemsPaid({ db, studentId: 's1', itemTypes: ['shoes'], paymentId: 'pay1' });
  const shoes = rows.find((r) => r.item_type === 'shoes');
  const own = markEquipmentOwn({ db, rowId: shoes.id });
  assert.equal(own.ok, true);
  assert.equal(own.row.payment_status, 'own');
  assert.equal(own.row.paid_at, null);
  assert.equal(own.row.rental_starts_at, null);
  const gaps = equipmentGapFlags(db.get('student_equipment'));
  assert.equal(gaps.unpaidCount, 2); // shirt + chalk still unpaid; shoes own
  const back = markEquipmentUnpaid({ db, rowId: shoes.id });
  assert.equal(back.ok, true);
  assert.equal(back.row.payment_status, 'unpaid');
});

test('markEquipmentDeclined is not a payment gap', () => {
  const db = makeDb({ students: [{ id: 's1', parentId: 'p1', isAdult: false }], student_equipment: [] });
  const rows = ensureStudentEquipment({ db, student: db.getOne('students', 's1') });
  const shirt = rows.find((r) => r.item_type === 'shirt');
  const declined = markEquipmentDeclined({ db, rowId: shirt.id });
  assert.equal(declined.ok, true);
  assert.equal(declined.row.payment_status, 'declined');
  const gaps = equipmentGapFlags(db.get('student_equipment'));
  assert.equal(gaps.unpaidCount, 2);
  assert.equal(unpaidEquipmentItems(db.get('student_equipment')).length, 2);
});

test('equipment template base never falls back to a local address', () => {
  const original = { front: process.env.FRONTEND_URL, pub: process.env.PUBLIC_APP_URL };
  try {
    process.env.FRONTEND_URL = 'http://localhost:3001';
    delete process.env.PUBLIC_APP_URL;
    assert.equal(equipmentPublicBase(), EQUIPMENT_LIVE_APP_BASE);
    assert.equal(equipmentPublicBase('http://localhost:3000'), EQUIPMENT_LIVE_APP_BASE);
    assert.equal(equipmentPublicBase('https://127.0.0.1:3000'), EQUIPMENT_LIVE_APP_BASE);
    assert.equal(equipmentPublicBase('http://my-wall.example'), EQUIPMENT_LIVE_APP_BASE);

    process.env.FRONTEND_URL = 'https://app.kirboaz.co.il/';
    assert.equal(equipmentPublicBase(), 'https://app.kirboaz.co.il');
    assert.equal(equipmentPublicBase('https://staging.example'), 'https://staging.example');
  } finally {
    if (original.front === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original.front;
    if (original.pub === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = original.pub;
  }
});

test('the template button points at the server redirect, never at the app itself', () => {
  const original = {
    front: process.env.FRONTEND_URL,
    api: process.env.PUBLIC_API_URL,
    render: process.env.RENDER_EXTERNAL_URL,
  };
  try {
    // A staff machine running locally must still seed the live redirect host.
    process.env.FRONTEND_URL = 'http://localhost:3001';
    process.env.PUBLIC_API_URL = 'http://localhost:5001';
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(equipmentRedirectBase(), EQUIPMENT_LIVE_API_BASE);

    const db = makeDb({ message_templates: [] });
    const tpl = ensureEquipmentWhatsappTemplate({ db });
    assert.equal(tpl.name, EQUIPMENT_TEMPLATE_NAME);
    assert.equal(tpl.buttons[0].url, `${EQUIPMENT_LIVE_API_BASE}/e/{{1}}`);
    assert.ok(!tpl.buttons[0].url.includes('localhost'));
    // Seeding twice must not create a second template.
    assert.equal(ensureEquipmentWhatsappTemplate({ db }).id, tpl.id);
    assert.equal(db.get('message_templates').length, 1);

    process.env.PUBLIC_API_URL = 'https://api.example/';
    assert.equal(equipmentRedirectBase(), 'https://api.example');
    assert.equal(buildEquipmentRedirectUrl('tok 1'), 'https://api.example/e/tok%201');
    assert.equal(buildEquipmentRedirectUrl(''), '');
  } finally {
    for (const [key, value] of [
      ['FRONTEND_URL', original.front],
      ['PUBLIC_API_URL', original.api],
      ['RENDER_EXTERNAL_URL', original.render],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
