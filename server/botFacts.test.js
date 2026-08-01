import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_OPENING_HOURS_REPLY,
  PRICE_HANDOFF_REPLY,
  asksAboutAssistants,
  asksAboutEvents,
  asksAboutOpeningHours,
  asksAboutPrices,
  buildPriceReply,
  enrichmentFeeFromSettings,
  formatGroupChatReply,
  formatGroupDetailsReply,
  formatOpeningHoursReply,
  formatPublicEventsReply,
  formatSignupLinkReply,
  groupSignupUrl,
  inviteLink,
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
  // The caller is what turns that into a customer-facing sentence.
  assert.match(NO_OPENING_HOURS_REPLY, /לא עודכנו ביומן/);
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
  assert.match(reply, /\/event\/abc123/);
  assert.doesNotMatch(reply, /יום הולדת/);
  assert.doesNotMatch(reply, /secret9/);
});

test('no published activities means no events reply at all', () => {
  assert.equal(formatPublicEventsReply(fakeDb({ activities: [] })), '');
});

// ─── מחירים ──────────────────────────────────────────────────────────────────

const EQUIPMENT = { shoes: 150, shirt: 120, chalk_bag: 80 };

test('class prices come from the matched group', () => {
  const reply = buildPriceReply({
    groups: [{ ageCategory: 'ג׳-ד׳', day: 2, time: '15:00', priceWeek: 280, priceTwice: 360 }],
    equipmentPrices: EQUIPMENT,
    enrichmentFee: 110,
    text: 'כמה עולה החוג לכיתה ג׳?',
  });
  assert.equal(reply.handoff, false);
  assert.match(reply.text, /פעם בשבוע 280 ₪/);
  assert.match(reply.text, /פעמיים בשבוע 360 ₪/);
  assert.match(reply.text, /110 ₪/);
});

test('a group with no price recorded is skipped rather than guessed', () => {
  const reply = buildPriceReply({
    groups: [{ ageCategory: 'ה׳-ו׳', day: 4, time: '15:30', priceWeek: 0, priceTwice: 0 }],
    equipmentPrices: null,
    enrichmentFee: 0,
    text: 'כמה עולה החוג?',
  });
  assert.equal(reply.handoff, true);
  assert.equal(reply.text, PRICE_HANDOFF_REPLY);
});

test('equipment questions answer with equipment only', () => {
  const reply = buildPriceReply({
    groups: [{ ageCategory: 'ג׳-ד׳', day: 2, time: '15:00', priceWeek: 280, priceTwice: 360 }],
    equipmentPrices: EQUIPMENT,
    enrichmentFee: 110,
    text: 'כמה עולות הנעליים?',
  });
  assert.match(reply.text, /150 ₪ להשכרה לחצי עונה/);
  assert.doesNotMatch(reply.text, /280/);
});

test('the enrichment fee is read from the business facts the owner edits', () => {
  assert.equal(
    enrichmentFeeFromSettings({ aiBusinessFacts: 'כתובת: השקד 1\nדמי העשרה: 110 ₪' }),
    110
  );
  assert.equal(enrichmentFeeFromSettings({ aiBusinessFacts: 'כתובת: השקד 1' }), 0);
});

// ─── מדריך וגודל קבוצה ───────────────────────────────────────────────────────

test('the trainer id resolves to the employee name', () => {
  const db = fakeDb({ employees: [{ id: 'e-7', name: 'נועה' }] });
  assert.equal(trainerNameForGroup(db, { trainer: 'e-7' }), 'נועה');
  // An id with nobody behind it is not a name to send to a customer.
  assert.equal(trainerNameForGroup(db, { trainer: 'e-99' }), '');
});

test('trainer and group size are answered for a single matched group', () => {
  const db = fakeDb({ employees: [{ id: 'e-7', name: 'נועה' }] });
  const group = { ageCategory: 'ג׳-ד׳', day: 2, time: '15:00', trainer: 'e-7', maxSlots: 12 };
  const trainer = formatGroupDetailsReply(db, [group], 'מי המדריך של הקבוצה?');
  assert.match(trainer.text, /נועה/);
  assert.equal(trainer.handoff, false);

  const size = formatGroupDetailsReply(db, [group], 'כמה ילדים יש בקבוצה?');
  assert.match(size.text, /עד 12 מתאמנים/);
});

test('assistant trainers are not in the CRM, so the question goes to a human', () => {
  const db = fakeDb({ employees: [{ id: 'e-7', name: 'נועה' }] });
  const reply = formatGroupDetailsReply(
    db,
    [{ ageCategory: 'ג׳-ד׳', day: 2, time: '15:00', trainer: 'e-7' }],
    'מי עוזרי המדריך?'
  );
  assert.equal(reply.handoff, true);
  assert.doesNotMatch(reply.text, /נועה/);
});

test('an ambiguous group question asks which class instead of listing everything', () => {
  const db = fakeDb({ employees: [] });
  const reply = formatGroupDetailsReply(db, [], 'מי המדריך?');
  assert.match(reply.text, /לאיזו קבוצה/);
  assert.equal(reply.handoff, false);
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

test('group chat links are sent only for the class the child is enrolled in', () => {
  const db = fakeDb({
    groups: [
      {
        id: 'g1',
        ageCategory: 'ג׳-ד׳',
        day: 2,
        time: '15:00',
        waParents: 'https://chat.whatsapp.com/AAA111',
        waClimbers: 'https://chat.whatsapp.com/BBB222',
      },
      {
        id: 'g2',
        ageCategory: 'ה׳-ו׳',
        day: 3,
        time: '16:30',
        waParents: 'https://chat.whatsapp.com/CCC333',
      },
    ],
  });
  const reply = formatGroupChatReply(db, [{ name: 'עומרי', groupId: 'g1' }], 'תשלח לי את קבוצת הוואטסאפ');
  assert.match(reply.text, /AAA111/);
  assert.match(reply.text, /BBB222/);
  // The class the child is not in stays private.
  assert.doesNotMatch(reply.text, /CCC333/);
  assert.equal(reply.handoff, false);
});

test('a child with no class placement goes to staff instead of a guessed link', () => {
  const db = fakeDb({ groups: [{ id: 'g1', waParents: 'https://chat.whatsapp.com/AAA111' }] });
  const reply = formatGroupChatReply(db, [{ name: 'עומרי', groupId: null }], 'קישור לקבוצה');
  assert.equal(reply.handoff, true);
  assert.doesNotMatch(reply.text, /chat\.whatsapp\.com/);
});

test('a group whose link is only a JID hands off rather than sending it', () => {
  const db = fakeDb({ groups: [{ id: 'g1', waParents: '120363025390759859@g.us', waClimbers: '' }] });
  const reply = formatGroupChatReply(db, [{ name: 'עומרי', groupId: 'g1' }], 'קישור לקבוצה');
  assert.equal(reply.handoff, true);
  assert.doesNotMatch(reply.text, /@g\.us/);
});

test('the signup link carries the specific class as the interest', () => {
  const url = groupSignupUrl({ ageCategory: 'ג׳-ד׳', day: 2, time: '15:00' }, { phone: '972501234567' });
  assert.match(url, /\/onboard\?/);
  const interest = new URL(url).searchParams.get('interest');
  assert.equal(interest, 'ג׳-ד׳ · יום ג׳ 15:00');
  assert.match(url, /phone=972501234567/);

  const ask = formatSignupLinkReply([], { phone: '972501234567' });
  assert.match(ask, /לאיזו כיתה ויום/);
});

// ─── גילוי כוונה ─────────────────────────────────────────────────────────────

test('intent detectors keep the branches apart', () => {
  assert.equal(asksAboutPrices('כמה עולה החוג?'), true);
  assert.equal(asksAboutPrices('כמה כסף דלק מקבל לשעה?'), false);
  assert.equal(asksAboutEvents('יש טיולים קרובים?'), true);
  assert.equal(asksAboutEvents('אני במחנה של הנבחרת'), false);
  assert.equal(asksAboutEvents('יש מחנה קיץ להרשמה?'), true);
  assert.equal(asksAboutOpeningHours('מתי אתם פתוחים?'), true);
  assert.equal(asksAboutAssistants('מי עוזרי המדריך?'), true);
  assert.equal(asksAboutPrices('באיזה יום יש חוג?'), false);
});
