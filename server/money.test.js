import test from 'node:test';
import assert from 'node:assert/strict';
import { VAT_RATE, chargeAmount, netAmount, vatBreakdown } from './vat.js';
import { computeEquipmentTotal, DEFAULT_EQUIPMENT_SETTINGS } from './equipmentService.js';
import {
  maxSlotsOf,
  countEnrolled,
  spotsLeft,
  isGroupFull,
  enrichGroupsWithCapacity,
} from './groupCapacity.js';
import { enrichmentFeeFromSettings } from './botFacts.js';

test('VAT is added on top, and a broken rate is refused rather than guessed', () => {
  assert.equal(chargeAmount(100, false), 118);
  assert.equal(chargeAmount(100, true), 100);

  // The bug: `base * (1 + Number(rate) || VAT_RATE)` grouped as
  // `(1 + rate) || VAT_RATE`, so an unreadable rate multiplied by 0.18 —
  // charging eighteen percent of the price instead of the price plus VAT.
  for (const bad of [NaN, 'abc', -1, 2]) {
    assert.throws(() => chargeAmount(50, false, bad), /שיעור מע״מ/, String(bad));
  }

  // A zero rate is a real answer (exempt), not a missing one.
  assert.equal(chargeAmount(100, false, 0), 100);
  assert.equal(netAmount(100, true, 0), 100);
  assert.equal(vatBreakdown(100, false, 0).vat, 0);
  assert.equal(vatBreakdown(100, false).rate, VAT_RATE);

  // An explicitly absent rate still means "the standard one".
  assert.equal(chargeAmount(100, false, undefined), 118);
  assert.equal(chargeAmount(100, false, null), 118);
});

test('the equipment total reads prices from either shape it is handed', () => {
  // The real failure: the bot passed the inner prices object, the normaliser
  // looked for `.prices` inside it, found nothing, and quoted the built-in
  // defaults — 350 ₪ for a kit the owner had priced at 280.
  const prices = { shoes: 150, shirt: 60, chalk_bag: 70 };
  const items = ['shoes', 'shirt', 'chalk_bag'];

  assert.equal(computeEquipmentTotal({ prices }, items), 280);
  assert.equal(computeEquipmentTotal(prices, items), 280);

  // And the defaults are genuinely different, so the test would have caught it.
  const defaults = DEFAULT_EQUIPMENT_SETTINGS.prices;
  assert.notEqual(defaults.shirt, prices.shirt);
  assert.equal(computeEquipmentTotal(DEFAULT_EQUIPMENT_SETTINGS, items), 350);

  // A shoes override (season pro-rata) still wins over both shapes.
  assert.equal(computeEquipmentTotal(prices, ['shoes'], { shoes: 75 }), 75);
});

test('an unset capacity is unknown, never twelve', () => {
  // maxSlotsOf answered 12 for a group nobody had sized, and that number was
  // published as "8 places left" on the public site and in WhatsApp.
  const students = [];
  assert.equal(maxSlotsOf({ id: 'g1', maxSlots: 9 }), 9);
  assert.equal(maxSlotsOf({ id: 'g1' }), null);
  assert.equal(maxSlotsOf({ id: 'g1', maxSlots: 0 }), null);

  assert.equal(spotsLeft({ id: 'g1', maxSlots: 9 }, students), 9);
  assert.equal(spotsLeft({ id: 'g1' }, students), null);

  // Unknown is not "full": we have no grounds to turn a family away.
  assert.equal(isGroupFull({ id: 'g1' }, students), false);
  assert.equal(isGroupFull({ id: 'g1', maxSlots: 1 }, [
    { id: 's1', groupId: 'g1', status: 'registered' },
  ]), true);

  const [known, unknown] = enrichGroupsWithCapacity(
    [{ id: 'g1', maxSlots: 9 }, { id: 'g2' }],
    students
  );
  assert.equal(known.capacityKnown, true);
  assert.equal(known.freeSlots, 9);
  assert.equal(unknown.capacityKnown, false);
  assert.equal(unknown.freeSlots, null);
  assert.equal(unknown.isFull, false);
});

test('a held place is a real place', () => {
  // A hold that took no seat was not a hold: the same seat was offered to the
  // next family while the first was still filling in the form. The lifecycle
  // releases the hold when it lapses, and the status moves with it.
  const group = { id: 'g1', maxSlots: 3 };
  const students = [
    { id: 's1', groupId: 'g1', status: 'registered' },
    { id: 's2', groupId: 'g1', status: 'awaiting_parent_confirmation' },
    { id: 's3', groupId: 'g1', status: 'waitlist' },
    { id: 's4', groupId: 'g1', status: 'health_signed' },
  ];
  // s1 is registered and s2 is holding; s3 is waitlisted and s4 only signed.
  assert.equal(countEnrolled('g1', students), 2);
  assert.equal(spotsLeft(group, students), 1);
});

test('a price never lives inside prose', () => {
  // The enrichment fee was scraped from the free-text business facts with a
  // regex. "1,100 ₪" came back as 0, and so did the same line without the word
  // "דמי" — a wrong price, quoted to a customer, from a harmless reword.
  assert.equal(enrichmentFeeFromSettings({ aiEnrichmentFee: 110 }), 110);
  // An explicit zero is an answer: this gym charges no enrichment fee.
  assert.equal(enrichmentFeeFromSettings({ aiEnrichmentFee: 0 }), 0);
  // The field wins over stale prose left behind beside it.
  assert.equal(
    enrichmentFeeFromSettings({ aiEnrichmentFee: 90, aiBusinessFacts: 'דמי העשרה: 110 ₪' }),
    90
  );

  // The prose is still read for an account that has not filled the field in.
  assert.equal(enrichmentFeeFromSettings({ aiBusinessFacts: 'דמי העשרה: 110 ₪' }), 110);
  assert.equal(enrichmentFeeFromSettings({ aiBusinessFacts: 'דמי העשרה: 1,100 ₪' }), 1100);
  assert.equal(enrichmentFeeFromSettings({}), 0);
});
