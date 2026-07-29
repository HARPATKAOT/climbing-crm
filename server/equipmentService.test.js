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
  equipmentGapFlags,
  unpaidEquipmentItems,
  DEFAULT_EQUIPMENT_SETTINGS,
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
