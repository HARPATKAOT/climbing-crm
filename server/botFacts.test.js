import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichmentFeeFromSettings,
  resolveEnrichmentFee,
  formatOpeningHoursReply,
  formatPublicEventsReply,
  inviteLink,
  entryProductsFromPricelist,
  trainerNameForGroup,
} from './botFacts.js';

/** Minimal stand-in for the db façade: only `get` is used by these helpers. */
function fakeDb(tables = {}) {
  return { get: (name) => tables[name] || [] };
}

function futureDate(daysAhead) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

// ─── שעות פתיחה ──────────────────────────────────────────────────────────────

test('an empty calendar yields no opening hours to quote', () => {
  assert.equal(formatOpeningHoursReply(fakeDb({ activities: [] })), '');
});

test('opening hours are read from the calendar entries', () => {
  const db = fakeDb({
    activities: [
      {
        type: 'opening_hours',
        date: futureDate(1),
        start_time: '16:00',
        end_time: '21:00',
        name: 'שעות פתיחה',
      },
      // A different activity type on the same day must not leak in.
      { type: 'birthday', date: futureDate(1), start_time: '10:00', end_time: '12:00' },
    ],
  });
  const reply = formatOpeningHoursReply(db);
  assert.match(reply, /16:00–21:00/);
  assert.doesNotMatch(reply, /10:00/);
});

// ─── אירועים ציבוריים ────────────────────────────────────────────────────────

test('only a published activity is offered, with its registration link', () => {
  const db = fakeDb({
    activities: [
      {
        id: 'a1',
        type: 'trip',
        name: 'טיול לנקיק השחור',
        date: futureDate(3),
        start_time: '09:00',
        price: 200,
        show_on_site: true,
        registration_enabled: true,
        participant_registration_slug: 'abc123',
      },
      // Private birthday: it has a live registration link the host shares, and
      // the bot must never advertise it.
      {
        id: 'a2',
        type: 'birthday',
        name: 'יום הולדת של נועם',
        date: futureDate(4),
        show_on_site: false,
        registration_enabled: true,
        participant_registration_slug: 'secret9',
      },
    ],
    activity_registrations: [],
  });
  const reply = formatPublicEventsReply(db);
  assert.match(reply, /טיול לנקיק השחור/);
  // The address is now the short redirect on our own host; /ev resolves it to
  // the same public page, and survives the page moving.
  assert.match(reply, /\/ev\/abc123/);
  assert.doesNotMatch(reply, /יום הולדת/);
  assert.doesNotMatch(reply, /secret9/);
});

test('no published activities means no events reply at all', () => {
  assert.equal(formatPublicEventsReply(fakeDb({ activities: [] })), '');
});

// ─── מחירים ──────────────────────────────────────────────────────────────────

const EQUIPMENT = { shoes: 150, shirt: 120, chalk_bag: 80 };

test('the enrichment fee is read from the business facts the owner edits', () => {
  assert.equal(
    enrichmentFeeFromSettings({ aiBusinessFacts: 'כתובת: השקד 1\nדמי העשרה: 110 ₪' }),
    110
  );
  assert.equal(enrichmentFeeFromSettings({ aiBusinessFacts: 'כתובת: השקד 1' }), 0);
});

test('the fee comes from the equipment screen, and the prose is only a fallback', async () => {
  // No equipment settings to read here, which is exactly the fallback case:
  // an account that still keeps the number inside the business facts.
  assert.equal(
    await resolveEnrichmentFee({ aiBusinessFacts: 'דמי העשרה: 110 ₪' }),
    110
  );
  // The line was deleted because the amount is on the equipment screen — and
  // with nothing to read there either, the bot says nothing rather than 0 ₪.
  assert.equal(await resolveEnrichmentFee({ aiBusinessFacts: 'כתובת: השקד 1' }), 0);
});

// ─── מדריך וגודל קבוצה ───────────────────────────────────────────────────────

test('the trainer id resolves to the employee name', () => {
  const db = fakeDb({ employees: [{ id: 'e-7', name: 'נועה' }] });
  assert.equal(trainerNameForGroup(db, { trainer: 'e-7' }), 'נועה');
  // An id with nobody behind it is not a name to send to a customer.
  assert.equal(trainerNameForGroup(db, { trainer: 'e-99' }), '');
});

// ─── קישורים לקבוצה ──────────────────────────────────────────────────────────

test('only a real invite link is sendable, never a group JID', () => {
  assert.equal(
    inviteLink('https://chat.whatsapp.com/Lwm3gC3zrfuIRUVC0VSolp'),
    'https://chat.whatsapp.com/Lwm3gC3zrfuIRUVC0VSolp'
  );
  assert.equal(inviteLink('120363025390759859@g.us'), '');
  assert.equal(inviteLink(''), '');
});

// ─── גילוי כוונה ─────────────────────────────────────────────────────────────

test('entry products come only from the כניסה category with a real price', () => {
  const list = [
    { name: 'כניסה לקיר', price: 70, category: 'כניסה', active: true },
    { name: 'מנוי אישי', price: 440, category: 'כרטיסיות ומנויים', active: true },
    { name: 'כניסה ישנה', price: 0, category: 'כניסה', active: true },
    { name: 'כניסה כבויה', price: 70, category: 'כניסה', active: false },
  ];
  assert.deepEqual(entryProductsFromPricelist(list), [
    { שם: 'כניסה לקיר', מחיר: 70, הערה: '' },
  ]);
});
