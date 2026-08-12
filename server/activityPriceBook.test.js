import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bracketBreakdown,
  bracketFor,
  eventChargeBreakdown,
  normalizeBrackets,
  ruleChargeBreakdown,
} from './activityPricing.js';
import {
  describeRule,
  ladderFromSingle,
  normalizePriceRule,
  ruleNumbers,
  ruleNumbersChanged,
  ruleVersion,
  resolveActivityRule,
  STARTER_PRICE_RULES,
} from './activityPriceBook.js';

/**
 * הווקטורים מנושן. הטבלה הזאת היא החוזה: היא מגיעה משלוש שורות אמיתיות במסד
 * של הבעלים, ולא מהקוד. אם הסולם ישתנה, כאן זה ייראה.
 */
const NOTION_LADDER = [
  { single: 350, rungs: [3350, 5700, 6550, 9170] },
  { single: 250, rungs: [2400, 4100, 4700, 6580] },
  { single: 390, rungs: [3700, 6300, 7250, 10150] },
];

test('סולם המדרגות מייצר את כל 12 המספרים שבנושן', () => {
  for (const { single, rungs } of NOTION_LADDER) {
    const ladder = ladderFromSingle(single);
    assert.deepEqual(ladder.map((row) => row.up_to), [10, 15, 20, 30]);
    assert.deepEqual(ladder.map((row) => row.amount), rungs, `מחיר יחיד ${single}`);
  }
});

test('המדרגה הרביעית לא מעוגלת', () => {
  // 6,550 × 1.4 = 9,170 בדיוק. עיגול ל-50 היה נותן 9,150 — עשרים שקלים
  // שנופלים בשקט מכל טיול גדול, ואף אחד לא היה מחפש אותם.
  assert.equal(ladderFromSingle(350)[3].amount, 9170);
  assert.notEqual(ladderFromSingle(350)[3].amount, 9150);
});

test('מחיר מדרגה הוא מחיר קבוצתי שטוח, לא מחיר לראש', () => {
  const rule = ruleNumbers(STARTER_PRICE_RULES[0]);
  const three = bracketBreakdown(rule, { participants: 3 });
  const ten = bracketBreakdown(rule, { participants: 10 });
  assert.equal(three.entered, 3350);
  assert.equal(ten.entered, 3350); // קבוצה של 3 משלמת כמו קבוצה של 10
});

test('גבולות המדרגות נופלים במקום הנכון', () => {
  const rule = ruleNumbers(STARTER_PRICE_RULES[0]);
  const at = (n) => bracketBreakdown(rule, { participants: n }).entered;
  assert.equal(at(10), 3350);
  assert.equal(at(11), 5700); // בדיוק מעל הגבול
  assert.equal(at(15), 5700);
  assert.equal(at(16), 6550);
  assert.equal(at(20), 6550);
  assert.equal(at(21), 9170);
  assert.equal(at(30), 9170);
});

test('מעל המדרגה האחרונה — סירוב, לא ניחוש', () => {
  const rule = ruleNumbers(STARTER_PRICE_RULES[0]);
  const big = bracketBreakdown(rule, { participants: 35 });
  assert.equal(big.unpriced, true);
  assert.equal(big.unpricedReason, 'over_top');
  assert.equal(big.gross, 0);
  assert.equal(big.topBracket.up_to, 30);
});

test('אפס משתתפים — סירוב, ולא נפילה למדרגה כלשהי', () => {
  const rule = ruleNumbers(STARTER_PRICE_RULES[0]);
  const none = bracketBreakdown(rule, { participants: 0 });
  assert.equal(none.unpriced, true);
  assert.equal(none.unpricedReason, 'no_participants');
  assert.equal(none.gross, 0);
});

test('חור בין מדרגות בלתי אפשרי — הגבול הוא „עד” בלבד', () => {
  // המשתמש הקליד עד 10 ואז עד 15; אין דרך להקליד „מ-12”, ולכן 11 תמיד נופל.
  const rows = normalizeBrackets([
    { up_to: 15, amount: 5700 },
    { up_to: 10, amount: 3350 },
    { up_to: 10, amount: 3400 }, // כפילות — האחרונה מנצחת
    { up_to: '', amount: 900 }, // זבל — נופל
  ]);
  assert.deepEqual(rows, [
    { up_to: 10, amount: 3400 },
    { up_to: 15, amount: 5700 },
  ]);
  assert.equal(bracketFor(rows, 11).amount, 5700);
});

test('מדרגות ומע״מ: המספר בטבלה הוא מה שנגבה כשהוא כולל מע״מ', () => {
  const rule = ruleNumbers(STARTER_PRICE_RULES[0]); // price_includes_vat: true
  const twelve = bracketBreakdown(rule, { participants: 12 });
  assert.equal(twelve.entered, 5700);
  assert.equal(twelve.gross, 5700);
  assert.equal(twelve.net, 4830.51);
});

test('כלל „לפי ראש” מהמחירון מתנהג כמו המנוע הרגיל', () => {
  const camp = ruleNumbers(STARTER_PRICE_RULES.find((r) => r.id === 'pr_wall_camp_hosting'));
  const under = ruleChargeBreakdown(camp, { participants: 12 });
  assert.equal(under.billableCount, 20); // רצפת המינימום
  assert.equal(under.entered, 1400);
  assert.equal(under.gross, 1652);
});

test('כלל „מחיר קבוע” מתעלם ממספר המשתתפים', () => {
  const flat = ruleNumbers(STARTER_PRICE_RULES.find((r) => r.id === 'pr_wall_school_single'));
  assert.equal(ruleChargeBreakdown(flat, { participants: 0 }).entered, 750);
  assert.equal(ruleChargeBreakdown(flat, { participants: 40 }).entered, 750);
});

test('נסיגה: תקרה ישנה לא דורסת מחיר קבוע לאירוע', () => {
  // אירוע שהיה „לפי ראש” עם תקרה 2,500 ועבר למחיר קבוע 3,000 חויב 2,500:
  // התקרה נשארה בשורה, המסך כבר לא הציג אותה, והיא המשיכה לחתוך בשקט.
  const stale = {
    charge_basis: 'flat',
    price: 3000,
    max_charge: 2500,
    price_includes_vat: true,
  };
  assert.equal(eventChargeBreakdown(stale, { participants: 0 }).entered, 3000);
  assert.equal(eventChargeBreakdown(stale, { participants: 0 }).capped, false);
});

test('גרסה: אירוע שתומחר לא זז כשהמחירון מתעדכן', () => {
  const rule = {
    id: 'pr_x',
    ...normalizePriceRule({ ...STARTER_PRICE_RULES[0] }),
    version: 3,
    versions: [
      { version: 1, ...ruleNumbers({ ...STARTER_PRICE_RULES[0], participant_price: 300 }) },
      {
        version: 2,
        ...ruleNumbers({
          ...STARTER_PRICE_RULES[0],
          brackets: [{ up_to: 10, amount: 3000 }, { up_to: 15, amount: 5000 }],
        }),
      },
    ],
  };
  const db = { get: () => [rule] };

  const old = resolveActivityRule(db, { price_rule_id: 'pr_x', price_rule_version: 2 });
  assert.equal(old.stale, true);
  assert.equal(bracketBreakdown(old.numbers, { participants: 12 }).entered, 5000);

  const now = resolveActivityRule(db, { price_rule_id: 'pr_x', price_rule_version: 3 });
  assert.equal(now.stale, false);
  assert.equal(bracketBreakdown(now.numbers, { participants: 12 }).entered, 5700);

  // גרסה שנשמטה מההיסטוריה: אין מספרים, ואסור להמציא.
  const lost = resolveActivityRule(db, { price_rule_id: 'pr_x', price_rule_version: 99 });
  assert.equal(lost.numbers.brackets.length, 4); // 99 מעל הנוכחית → הנוכחית
  assert.equal(ruleVersion(rule, 1).participant_price, 300);
  assert.equal(ruleVersion({ ...rule, versions: [] }, 1), null);
});

test('כלל שנמחק מהמסד מחזיר „אין מספרים”, ולא נפילה לחישוב אחר', () => {
  const db = { get: () => [] };
  const gone = resolveActivityRule(db, { price_rule_id: 'pr_missing', price_rule_version: 1 });
  assert.equal(gone.rule, null);
  assert.equal(gone.numbers, null);
});

test('אירוע בלי קישור למחירון לא נוגע במחירון בכלל', () => {
  const db = { get: () => [] };
  assert.equal(resolveActivityRule(db, { price: 70 }), null);
});

test('שינוי שם לא מעלה גרסה; שינוי מחיר כן', () => {
  const before = normalizePriceRule(STARTER_PRICE_RULES[0]);
  assert.equal(ruleNumbersChanged(before, { ...before, name: 'שם אחר', notes: 'הערה' }), false);
  assert.equal(ruleNumbersChanged(before, { ...before, participant_price: 360 }), true);
  assert.equal(
    ruleNumbersChanged(before, { ...before, brackets: [{ up_to: 10, amount: 3400 }] }),
    true
  );
});

test('התקציר אומר על מה גובים ולא רק כמה', () => {
  assert.match(describeRule(STARTER_PRICE_RULES[0]), /4 מדרגות/);
  assert.match(
    describeRule(STARTER_PRICE_RULES.find((r) => r.id === 'pr_wall_camp_hosting')),
    /מינימום 20/
  );
  assert.match(
    describeRule(STARTER_PRICE_RULES.find((r) => r.id === 'pr_wall_school_single')),
    /לאירוע/
  );
});

test('שורות הזרע של השטח נושאות בדיוק את המספרים שבנושן', () => {
  for (const { single, rungs } of NOTION_LADDER) {
    const seed = STARTER_PRICE_RULES.find((r) => r.participant_price === single);
    assert.ok(seed, `אין שורת זרע ל-${single}`);
    assert.deepEqual(seed.brackets.map((b) => b.amount), rungs, seed.name);
  }
});
