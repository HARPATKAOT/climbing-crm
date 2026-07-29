import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEREST_COLLECTION,
  INTEREST_CONVERTED,
  convertInterestToRegistration,
  closeInterestForRegistrations,
  listInterest,
  matchInterestForRegistrations,
  namesMatch,
  normalizeConversionPaymentStatus,
  normalizeInterestInput,
  registrationAmount,
  samePhone,
} from './activityInterest.js';

/** Minimal in-memory stand-in for the db facade used by the service. */
function makeDb(seed = {}) {
  const tables = { parents: [], activity_registrations: [], [INTEREST_COLLECTION]: [], ...seed };
  let counter = 0;
  return {
    tables,
    get: (table) => tables[table] || [],
    getOne: (table, id) => (tables[table] || []).find((row) => row.id === id),
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      counter += 1;
      const row = { ...record, id: record.id || `${table}-${counter}` };
      tables[table].push(row);
      return row;
    },
    update: (table, id, patch) => {
      const list = tables[table] || [];
      const index = list.findIndex((row) => row.id === id);
      if (index === -1) return null;
      list[index] = { ...list[index], ...patch };
      return list[index];
    },
    upsertParentByPhone: (name, phone, email) => {
      const existing = tables.parents.find((p) => samePhone(p.phone, phone));
      if (existing) return existing;
      counter += 1;
      const parent = { id: `p-${counter}`, name, phone, email: email || '' };
      tables.parents.push(parent);
      return parent;
    },
  };
}

const persist = async () => ({ ok: true });

function interestRow(overrides = {}) {
  return {
    id: `i-${Math.random().toString(16).slice(2)}`,
    activity_id: 'a1',
    name: 'יונתן',
    phone: '0521111111',
    email: '',
    parent_id: null,
    student_id: null,
    participant_type: 'child',
    notes: '',
    status: 'interested',
    registration_id: null,
    created_at: '2026-07-28T08:00:00.000Z',
    ...overrides,
  };
}

test('normalizeInterestInput demands a name and defaults the participant type', () => {
  assert.throws(() => normalizeInterestInput({ phone: '0521111111' }), /שם המתעניין חובה/);
  const input = normalizeInterestInput({ name: '  דנה  ', phone: '052-111-1111' });
  assert.equal(input.name, 'דנה');
  assert.equal(input.participant_type, 'child');
  assert.equal(input.parent_id, null);
});

test('phone and name matching tolerate the forms staff actually type', () => {
  assert.equal(samePhone('0521111111', '+972521111111'), true);
  assert.equal(samePhone('0521111111', '0521111112'), false);
  assert.equal(samePhone('', ''), false);
  assert.equal(namesMatch('יונתן', 'יונתן כהן'), true);
  assert.equal(namesMatch('יונתן', 'דנה'), false);
});

test('a registration closes the interest row with the matching name', () => {
  const rows = [interestRow({ id: 'i1', name: 'יונתן' }), interestRow({ id: 'i2', name: 'דנה' })];
  const matched = matchInterestForRegistrations(rows, {
    parentId: 'p1',
    phone: '0521111111',
    registrations: [{ id: 'r1', participant_name: 'יונתן כהן' }],
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].row.id, 'i1');
  assert.equal(matched[0].registration.id, 'r1');
});

test('a lone interest row of the same customer closes even when the name differs', () => {
  const rows = [interestRow({ id: 'i1', name: 'הילד של דנה', parent_id: 'p1' })];
  const matched = matchInterestForRegistrations(rows, {
    parentId: 'p1',
    registrations: [{ id: 'r1', participant_name: 'איתי' }],
  });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].row.id, 'i1');
});

test('an unrelated customer never closes someone else’s slot', () => {
  const rows = [
    interestRow({ id: 'i1', name: 'יונתן', parent_id: 'p1', phone: '0521111111' }),
    interestRow({ id: 'i2', name: 'איתי', parent_id: 'p1', phone: '0521111111' }),
  ];
  const matched = matchInterestForRegistrations(rows, {
    parentId: 'p9',
    phone: '0529999999',
    registrations: [{ id: 'r1', participant_name: 'יונתן' }],
  });
  assert.equal(matched.length, 0);
});

test('closeInterestForRegistrations marks the row converted and links the registration', async () => {
  const db = makeDb({ [INTEREST_COLLECTION]: [interestRow({ id: 'i1', name: 'יונתן' })] });
  const closed = await closeInterestForRegistrations({
    db,
    persist,
    activityId: 'a1',
    parentId: 'p1',
    phone: '0521111111',
    registrations: [{ id: 'r1', participant_name: 'יונתן', student_id: 's1' }],
  });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].status, INTEREST_CONVERTED);
  assert.equal(closed[0].registration_id, 'r1');
  assert.equal(closed[0].student_id, 's1');
  assert.equal(listInterest(db, 'a1').length, 0);
  assert.equal(listInterest(db, 'a1', { includeClosed: true }).length, 1);
});

test('conversion creates a confirmed registration and a lead card when needed', async () => {
  const db = makeDb({ [INTEREST_COLLECTION]: [interestRow({ id: 'i1' })] });
  const activity = {
    id: 'a1',
    type: 'birthday',
    price: 100,
    price_includes_vat: true,
    registration_mode: 'paid_per_participant',
  };
  const result = await convertInterestToRegistration({
    db,
    persist,
    activity,
    row: db.get(INTEREST_COLLECTION)[0],
    paymentStatus: 'paid',
  });

  assert.equal(result.registration.status, 'confirmed');
  assert.equal(result.registration.payment_status, 'paid');
  assert.equal(result.registration.amount, 100);
  assert.ok(result.registration.paid_at);
  assert.equal(result.parent.phone, '0521111111');
  assert.equal(db.get('parents').length, 1);
  assert.equal(result.interest.status, INTEREST_CONVERTED);
  assert.equal(result.interest.registration_id, result.registration.id);
});

test('conversion refuses a row with neither customer nor phone, and refuses twice', async () => {
  const db = makeDb({
    [INTEREST_COLLECTION]: [
      interestRow({ id: 'i1', phone: '' }),
      interestRow({ id: 'i2', status: INTEREST_CONVERTED }),
    ],
  });
  const activity = { id: 'a1', type: 'birthday', price: 0, registration_mode: 'host_pays' };

  await assert.rejects(
    convertInterestToRegistration({ db, persist, activity, row: db.getOne(INTEREST_COLLECTION, 'i1') }),
    /יש לקשר לקוח או למלא טלפון/
  );
  await assert.rejects(
    convertInterestToRegistration({ db, persist, activity, row: db.getOne(INTEREST_COLLECTION, 'i2') }),
    /כבר הועבר לרשומים/
  );
});

test('hosted events default to a free participant row, paid events to a paid one', () => {
  const hosted = { id: 'a1', registration_mode: 'host_pays', price: 1200 };
  const perParticipant = {
    id: 'a2',
    registration_mode: 'paid_per_participant',
    price: 100,
    price_includes_vat: false,
  };
  assert.equal(normalizeConversionPaymentStatus('', hosted), 'not_required');
  assert.equal(normalizeConversionPaymentStatus('', perParticipant), 'paid');
  assert.equal(normalizeConversionPaymentStatus('pending', hosted), 'pending');
  assert.equal(registrationAmount(hosted, 'not_required'), 0);
  assert.equal(registrationAmount(perParticipant, 'paid'), 118);
});
