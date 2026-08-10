import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EQUIPMENT_SETTINGS } from './equipmentService.js';
import { paidWeeklySessions, shoesUpgradeQuote } from './equipmentUpgrade.js';

const SETTINGS = {
  ...DEFAULT_EQUIPMENT_SETTINGS,
  prices: { shoes: 550, shoes_twice: 770, shirt: 120, chalk_bag: 80 },
};

/** נעליים ששולמו לחצי הראשון של עונת 2026/27. */
const paidShoes = (over = {}) => ({
  id: 'eq-s1-shoes',
  student_id: 's1',
  item_type: 'shoes',
  payment_status: 'paid',
  paid_at: '2026-09-02T08:00:00.000Z',
  rental_starts_at: '2026-09-01',
  rental_ends_at: '2027-02-14',
  payment_id: 'pay-1',
  ...over,
});

const oncePayment = (over = {}) => ({
  id: 'pay-1',
  status: 'paid',
  equipment_payment: true,
  paid_at: '2026-09-02T08:00:00.000Z',
  equipment_allocations: [{ student_id: 's1', weekly_sessions: 1 }],
  ...over,
});

test('התדירות ששולמה נקראת מצילום התשלום', () => {
  assert.equal(paidWeeklySessions([oncePayment()], paidShoes()), 1);
  assert.equal(
    paidWeeklySessions(
      [oncePayment({ equipment_allocations: [{ student_id: 's1', weekly_sessions: 2 }] })],
      paidShoes()
    ),
    2
  );
});

test('תשלום ישן בלי תדירות נחשב פעם בשבוע', () => {
  const legacy = oncePayment({ equipment_allocations: [{ student_id: 's1' }] });
  assert.equal(paidWeeklySessions([legacy], paidShoes()), 1);
});

test('תשלום מלפני תחילת ההשכרה הנוכחית לא נספר', () => {
  const lastSeason = oncePayment({
    id: 'pay-old',
    paid_at: '2026-02-20T08:00:00.000Z',
    equipment_allocations: [{ student_id: 's1', weekly_sessions: 2 }],
  });
  assert.equal(paidWeeklySessions([lastSeason], paidShoes()), 1);
});

test('גובים רק את ההפרש על החלק שנותר מחצי העונה', () => {
  // חצי עונה = 5.5 חודשים; מ-15/12 ועד 14/02 נותרו 2 חודשים.
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2026-12-15',
  });
  assert.equal(quote.eligible, true);
  assert.equal(quote.price_gap, 220);
  assert.equal(quote.total_units, 5.5);
  assert.equal(quote.remaining_units, 2);
  assert.equal(quote.amount, Math.round((220 * 2) / 5.5));
  assert.equal(quote.from_label, 'פעם בשבוע');
  assert.equal(quote.to_label, 'פעמיים בשבוע');
});

test('ההפרש לעולם אינו מגיע לפער המלא כשכבר נוצל חלק מהתקופה', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2026-12-15',
  });
  // זו כל הנקודה מול „איפוס מחזור השכרה”, שהיה גובה 770 ₪ נוספים.
  assert.ok(quote.amount < quote.price_gap);
  assert.ok(quote.amount < 770);
});

test('בתחילת החצי גובים כמעט את מלוא הפער', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2026-09-01',
  });
  assert.equal(quote.remaining_units, 5.5);
  assert.equal(quote.amount, 220);
});

test('אין הפרש כשהתדירות לא השתנתה', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 1,
    refDate: '2026-12-15',
  });
  assert.equal(quote.eligible, false);
  assert.match(quote.reason, /אין פער מחיר/);
});

test('הפרש ששולם כבר לא מוצע שוב', () => {
  const upgradePayment = {
    id: 'pay-2',
    status: 'paid',
    student_id: 's1',
    equipment_shoes_upgrade: true,
    paid_at: '2026-12-16T08:00:00.000Z',
    equipment_upgrade_to_sessions: 2,
  };
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment(), upgradePayment],
    weeklySessions: 2,
    refDate: '2026-12-20',
  });
  assert.equal(quote.eligible, false);
  assert.equal(quote.from_sessions, 2);
});

test('פריט שטרם שולם אינו מועמד לחיוב הפרש', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes({ payment_status: 'unpaid' }),
    payments: [],
    weeklySessions: 2,
    refDate: '2026-12-15',
  });
  assert.equal(quote.eligible, false);
  assert.match(quote.reason, /עדיין לא שולמה/);
});

test('אחרי תום ההשכרה אין מה לגבות', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2027-02-20',
  });
  assert.equal(quote.eligible, false);
  assert.match(quote.reason, /הסתיימה/);
});

test('זנב של ימים בודדים לא נגבה, וההודעה אומרת למה', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2027-02-10',
  });
  assert.equal(quote.eligible, false);
  assert.match(quote.reason, /פחות מחצי חודש/);
});

test('חודש לפני הסוף עדיין נגבה חצי חודש', () => {
  const quote = shoesUpgradeQuote({
    settings: SETTINGS,
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2027-01-25',
  });
  assert.equal(quote.eligible, true);
  assert.equal(quote.remaining_units, 0.5);
  assert.equal(quote.amount, Math.round((220 * 0.5) / 5.5));
});

test('בלי הפרש מחירים מוגדר אין חיוב, גם אחרי מעבר לפעמיים', () => {
  const quote = shoesUpgradeQuote({
    settings: { ...SETTINGS, prices: { shoes: 550, shirt: 120, chalk_bag: 80 } },
    shoesRow: paidShoes(),
    payments: [oncePayment()],
    weeklySessions: 2,
    refDate: '2026-12-15',
  });
  assert.equal(quote.eligible, false);
});
