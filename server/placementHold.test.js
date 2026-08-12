import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expiredHolds,
  groupsForFrequency,
  holdExpiryFrom,
  holdIsLive,
  holdNoticeForCustomer,
  pairedTwiceWeeklyGroup,
  TWICE_WEEKLY,
} from './placementHold.js';

// שתי הקבוצות האמיתיות של ה'-ו', כפי שהן במערכת.
const SUNDAY = { id: 'g-f0bc07f0', name: "כיתות ה'-ו' — יום א׳ 16:30", ageCategory: "כיתות ה'-ו'", day: 0, time: '16:30', priceWeek: 270, priceTwice: 370 };
const WEDNESDAY = { id: 'g-53d1483e', name: "כיתות ה'-ו' — יום ד׳ 16:30", ageCategory: "כיתות ה'-ו'", day: 3, time: '16:30', priceWeek: 270, priceTwice: 370 };
// אותה שכבה, שעה אחרת — לא בן זוג.
const OTHER_TIME = { id: 'g-x', name: "כיתות ה'-ו' — יום ד׳ 18:00", ageCategory: "כיתות ה'-ו'", day: 3, time: '18:00', priceTwice: 370 };
// נמכרת רק פעם בשבוע.
const ONCE_ONLY = { id: 'g-once', name: "ילדים ג'-ד' — יום א׳ 17:30", ageCategory: "ילדים ג'-ד'", day: 0, time: '17:30', priceWeek: 290, priceTwice: 0 };
// כבר נפגשת פעמיים בשבוע בעצמה.
const TWICE_GROUP = { id: 'g-02d0c7cf', name: "מתקדמים ה'-ו' — ב׳+ה׳ 15:30", ageCategory: "כיתות ה'-ו'", day: 4, time: '15:30', priceWeek: 0, priceTwice: 430 };

const GROUPS = [SUNDAY, WEDNESDAY, OTHER_TIME, ONCE_ONLY, TWICE_GROUP];

test('פעמיים בשבוע בקבוצה של יום אחד הוא שני הימים', () => {
  // מהשיחה של רביד: היא ביקשה ראשון ורביעי, ותומר נשמר על ראשון בלבד.
  assert.equal(pairedTwiceWeeklyGroup(GROUPS, SUNDAY)?.id, WEDNESDAY.id);
  assert.deepEqual(
    groupsForFrequency(GROUPS, SUNDAY, TWICE_WEEKLY).map((g) => g.id),
    [SUNDAY.id, WEDNESDAY.id]
  );
});

test('פעם בשבוע נשארת קבוצה אחת', () => {
  assert.deepEqual(groupsForFrequency(GROUPS, SUNDAY, 'פעם בשבוע').map((g) => g.id), [SUNDAY.id]);
});

test('קבוצה שנמכרת רק פעם בשבוע אינה מוצאת בן זוג לפי שעה מקרית', () => {
  assert.equal(pairedTwiceWeeklyGroup(GROUPS, ONCE_ONLY), null);
});

test('קבוצה שכבר נפגשת פעמיים אינה מוכפלת', () => {
  // אין לה בן זוג באותה שעה, ולכן היום השני כבר בתוכה.
  assert.deepEqual(groupsForFrequency(GROUPS, TWICE_GROUP, TWICE_WEEKLY).map((g) => g.id), [TWICE_GROUP.id]);
});

test('החזקה חיה עד התפוגה, ושיבוץ ישן בלי תפוגה נחשב מוחזק', () => {
  const now = new Date('2026-08-11T09:00:00Z');
  assert.equal(holdIsLive({ placement_hold_until: '2026-08-14T09:00:00Z' }, now), true);
  assert.equal(holdIsLive({ placement_hold_until: '2026-08-10T09:00:00Z' }, now), false);
  assert.equal(holdIsLive({}, now), true);
});

test('שלושה ימים, ונאמר להורה בדיוק מה זה אומר', () => {
  const until = holdExpiryFrom(new Date('2026-08-11T09:00:00Z'));
  assert.equal(until.slice(0, 10), '2026-08-14');
  assert.match(holdNoticeForCustomer(), /שמור ל-3 ימים/);
  assert.match(holdNoticeForCustomer(), /עדכנו אותי/);
});

test('רק החזקה שפגה ולא דווחה משתחררת', () => {
  const now = new Date('2026-08-11T09:00:00Z');
  const rows = expiredHolds([
    { id: 'a', status: 'pending_signup', placement_hold_until: '2026-08-09T09:00:00Z' },
    { id: 'b', status: 'pending_signup', placement_hold_until: '2026-08-09T09:00:00Z', placement_hold_firm: true },
    { id: 'c', status: 'pending_signup', placement_hold_until: '2026-08-20T09:00:00Z' },
    { id: 'd', status: 'registered', placement_hold_until: '2026-08-09T09:00:00Z' },
    { id: 'e', status: 'pending_signup' },
  ], now);
  assert.deepEqual(rows.map((r) => r.id), ['a']);
});
