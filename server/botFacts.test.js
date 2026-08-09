import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enrichmentFeeFromSettings,
  resolveEnrichmentFee,
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

// ─── אירועים ציבוריים ────────────────────────────────────────────────────────

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
