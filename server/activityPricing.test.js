import test from 'node:test';
import assert from 'node:assert/strict';
import { eventChargeBreakdown, hostChargeBreakdown, normalizeChargeBasis } from './activityPricing.js';

test('a flat event is charged exactly as it always was', () => {
  const flat = { charge_basis: 'flat', price: 750, price_includes_vat: false };
  const withNobody = eventChargeBreakdown(flat, { participants: 0 });
  const withTwelve = eventChargeBreakdown(flat, { participants: 12 });

  assert.equal(withNobody.entered, 750);
  assert.equal(withNobody.gross, 885);
  assert.equal(withNobody.billableCount, null);
  // מספר הנרשמים לא נוגע בסכום כשהמחיר קבוע לאירוע.
  assert.deepEqual(withTwelve.entered, withNobody.entered);

  // אירוע ישן, בלי השדה בכלל, נופל ל'flat' ולא מתומחר מחדש בטעות.
  assert.equal(eventChargeBreakdown({ price: 750 }, { participants: 30 }).entered, 750);
  assert.equal(normalizeChargeBasis(undefined), 'flat');
});

test('אירוח קייטנה: 70₪ לראש, מינימום 20 — 12 נרשמים מחויבים כ-20', () => {
  const camp = {
    charge_basis: 'per_participant',
    price: 70,
    min_participants: 20,
    price_includes_vat: false,
  };

  const under = eventChargeBreakdown(camp, { participants: 12 });
  assert.equal(under.billableCount, 20);
  assert.equal(under.entered, 1400);
  assert.equal(under.gross, 1652);

  const over = eventChargeBreakdown(camp, { participants: 26 });
  assert.equal(over.billableCount, 26);
  assert.equal(over.entered, 1820);

  // אין תוספת מוגדרת — כולם באותו מחיר, גם מעבר למינימום.
  assert.equal(over.baseCount, 26);
  assert.equal(over.extraCount, 0);
});

test('פעילות גיבוש: 50₪ לראש עד 20, ואז 40₪ לכל ילד נוסף', () => {
  const school = {
    charge_basis: 'per_participant',
    price: 50,
    min_participants: 20,
    extra_participant_price: 40,
    price_includes_vat: false,
  };

  const exactly = eventChargeBreakdown(school, { participants: 20 });
  assert.equal(exactly.entered, 1000);
  assert.equal(exactly.extraCount, 0);

  const more = eventChargeBreakdown(school, { participants: 24 });
  assert.equal(more.baseCount, 20);
  assert.equal(more.extraCount, 4);
  assert.equal(more.entered, 1160); // 20×50 + 4×40

  // מתחת למינימום התוספת לא נכנסת כלל, והרצפה עדיין תופסת.
  const under = eventChargeBreakdown(school, { participants: 8 });
  assert.equal(under.billableCount, 20);
  assert.equal(under.entered, 1000);
});

test('יום הולדת מובנה: 110₪ לראש ממינימום 15, עד תקרה של 2,500₪', () => {
  const birthday = {
    charge_basis: 'per_participant',
    price: 110,
    min_participants: 15,
    max_charge: 2500,
    price_includes_vat: false,
  };

  const small = eventChargeBreakdown(birthday, { participants: 10 });
  assert.equal(small.entered, 1650); // הרצפה: 15 ילדים
  assert.equal(small.capped, false);

  const big = eventChargeBreakdown(birthday, { participants: 30 });
  assert.equal(big.capped, true);
  assert.equal(big.entered, 2500); // ולא 3,300
  assert.equal(big.gross, 2950);
});

test('התוספת נעלמת כשאין מינימום לעבור', () => {
  // 40₪ "לכל משתתף נוסף" בלי מינימום זה תוספת מעבר לאפס, כלומר כל המשתתפים
  // בתעריף התוספת. זו לא הכוונה של אף שורה במחירון, ולכן היא לא מתקיימת.
  const broken = {
    charge_basis: 'per_participant',
    price: 60,
    extra_participant_price: 40,
    price_includes_vat: false,
  };
  const result = eventChargeBreakdown(broken, { participants: 10 });
  assert.equal(result.extraPerHead, null);
  assert.equal(result.entered, 600);
});

test('מחיר שכולל מע״מ לא מנופח פעם שנייה', () => {
  const inclusive = {
    charge_basis: 'per_participant',
    price: 118,
    min_participants: 10,
    price_includes_vat: true,
  };
  const result = eventChargeBreakdown(inclusive, { participants: 10 });
  assert.equal(result.entered, 1180);
  assert.equal(result.gross, 1180);
  assert.equal(result.net, 1000);
  assert.equal(result.vat, 180);
});

test('מספר המשתתפים לחיוב גובר על מספר הנרשמים בפועל', () => {
  const activity = {
    charge_basis: 'per_participant',
    price: 70,
    min_participants: 20,
    price_includes_vat: false,
  };

  // מישהו הגיע בלי להירשם: מחייבים על 26 למרות ש-24 נרשמו.
  const corrected = hostChargeBreakdown(
    { ...activity, host_charge_participants: 26 },
    { registeredCount: 24 }
  );
  assert.equal(corrected.billableCount, 26);
  assert.equal(corrected.entered, 1820);

  // בלי תיקון ידני — לפי הנרשמים.
  const plain = hostChargeBreakdown(activity, { registeredCount: 24 });
  assert.equal(plain.billableCount, 24);

  // תיקון ל-0 הוא שדה ריק, לא "לא לחייב אף אחד": חוזרים לנרשמים ולרצפה.
  const cleared = hostChargeBreakdown(
    { ...activity, host_charge_participants: 0 },
    { registeredCount: 5 }
  );
  assert.equal(cleared.billableCount, 20);
});

test('ערכים ריקים או שבורים לא הופכים לחיוב מומצא', () => {
  const empty = eventChargeBreakdown({
    charge_basis: 'per_participant',
    price: '',
    min_participants: '',
    extra_participant_price: '',
    max_charge: '',
  }, {});
  assert.equal(empty.entered, 0);
  assert.equal(empty.gross, 0);
  assert.equal(empty.minParticipants, null);
  assert.equal(empty.cap, null);

  const negative = eventChargeBreakdown({
    charge_basis: 'per_participant',
    price: 70,
    min_participants: -5,
    max_charge: -100,
  }, { participants: -3 });
  assert.equal(negative.billableCount, 0);
  assert.equal(negative.capped, false);
});
