/**
 * חיוב הפרש כשמתאמן עובר לפעמיים בשבוע באמצע מחזור ההשכרה.
 *
 * דמי השכרת הנעליים נקבעים לפי התדירות (ראו shoesBasePrice), אבל התשלום
 * נגבה פעם אחת בתחילת חצי העונה. מתאמן שמוסיף אימון שבועי אחרי שכבר שילם
 * נשאר עם המחיר הזול עד סוף החצי, והפריט כבר במצב „שולם” ולכן אינו ניתן
 * לבחירה מחדש בדף התשלום.
 *
 * מה שנגבה כאן הוא **רק ההפרש על מה שנותר**: הפער בין שני מחירי הבסיס,
 * כפול החלק של חצי העונה שטרם נוצל. איפוס מחזור ההשכרה היה גובה חצי עונה
 * מלאה במחיר הגבוה — כלומר פעמיים על אותם חודשים.
 *
 * אין כאן עמודה חדשה: התדירות ששולמה נקראת מצילום התשלום עצמו.
 */

import {
  halfMonthUnits,
  normalizeEquipmentSettings,
  parseDayDate,
  resolveSeasonHalves,
  shoesBasePrice,
  frequencyLabelFor,
} from './equipmentService.js';

const DAY_MS = 86400000;

/**
 * באיזו תדירות שולמה השכרת הנעליים הפעילה.
 *
 * נקרא מתשלומי הציוד ששולמו מאז שההשכרה התחילה, ולא מהפריט עצמו: התדירות
 * מצולמת על התשלום ברגע החיוב, ותשלום הפרש מאוחר יותר מעלה אותה. לוקחים את
 * הגבוה שבהם, כך שחיוב הפרש שכבר שולם לא ייווצר שוב.
 *
 * ‏null על כל התשלומים = נגבה לפני שהיו שני מחירים, כלומר פעם בשבוע.
 */
export function paidWeeklySessions(payments = [], shoesRow = null) {
  const studentId = String(shoesRow?.student_id || '');
  if (!studentId) return 1;
  const since = parseDayDate(shoesRow?.rental_starts_at || shoesRow?.paid_at);

  let sessions = 1;
  for (const payment of Array.isArray(payments) ? payments : []) {
    if (!payment || payment.status !== 'paid') continue;
    if (!payment.equipment_payment && !payment.equipment_shoes_upgrade) continue;
    // תשלום מעונה קודמת אינו מעיד על ההשכרה הנוכחית.
    const paidAt = parseDayDate(payment.paid_at);
    if (since && paidAt && paidAt.getTime() < since.getTime()) continue;

    const allocations = Array.isArray(payment.equipment_allocations)
      ? payment.equipment_allocations
      : [];
    const forStudent = allocations.find((a) => String(a?.student_id || '') === studentId);
    const recorded = forStudent
      ? Number(forStudent.weekly_sessions)
      : (String(payment.student_id || '') === studentId
        ? Number(payment.equipment_upgrade_to_sessions ?? payment.equipment_weekly_sessions)
        : NaN);
    if (Number.isFinite(recorded) && recorded > sessions) sessions = recorded;
  }
  return sessions;
}

/**
 * הצעת חיוב הפרש לפריט נעליים ששולם.
 *
 * @returns {{eligible:boolean, reason:string, amount:number, price_gap:number,
 *   from_sessions:number, to_sessions:number, from_label:string, to_label:string,
 *   remaining_units:number, total_units:number, valid_until:string|null}}
 */
export function shoesUpgradeQuote({
  settings = {},
  shoesRow = null,
  payments = [],
  weeklySessions = 1,
  refDate = new Date(),
} = {}) {
  const s = normalizeEquipmentSettings(settings);
  const to = Math.max(1, Math.round(Number(weeklySessions) || 1));
  const from = paidWeeklySessions(payments, shoesRow);

  const none = (reason) => ({
    eligible: false,
    reason,
    amount: 0,
    price_gap: 0,
    from_sessions: from,
    to_sessions: to,
    from_label: frequencyLabelFor(from),
    to_label: frequencyLabelFor(to),
    remaining_units: 0,
    total_units: 0,
    valid_until: null,
  });

  if (!shoesRow || shoesRow.item_type !== 'shoes') return none('הפריט אינו נעליים');
  if (shoesRow.payment_status !== 'paid') {
    // עוד לא שולם — התמחור הרגיל כבר יגבה את המחיר הנכון.
    return none('ההשכרה עדיין לא שולמה — אין הפרש לגבות');
  }

  const priceGap = shoesBasePrice(s, to) - shoesBasePrice(s, from);
  if (priceGap <= 0) return none('אין פער מחיר בין התדירות ששולמה לתדירות הנוכחית');

  const ref = parseDayDate(refDate) || parseDayDate(new Date());
  const half = resolveSeasonHalves(s, ref).current;
  const totalUnits = halfMonthUnits(half.start, half.endExclusive);
  if (totalUnits <= 0) return none('חצי העונה אינו מוגדר כראוי');

  // חלון ההשכרה שנרכש בפועל גובר על חצי העונה המחושב — הוא מה שההורה שילם עליו.
  const rentalEnd = parseDayDate(shoesRow.rental_ends_at);
  const endExclusive = rentalEnd
    ? new Date(rentalEnd.getTime() + DAY_MS)
    : half.endExclusive;

  if (ref.getTime() >= endExclusive.getTime()) {
    return none('תקופת ההשכרה הסתיימה — אין מה לגבות');
  }

  // אותן יחידות שבהן תומחרה ההשכרה מלכתחילה: חודשים בעיגול לחצי חודש.
  let remainingUnits = halfMonthUnits(ref, endExclusive);
  // פחות מחצי חודש מתעגל לאפס. גבייה על זנב כזה נראית כמו קנס, לא כמו הפרש.
  if (remainingUnits <= 0) return none('נותר פחות מחצי חודש להשכרה — אין הפרש לגבות');
  if (remainingUnits > totalUnits) remainingUnits = totalUnits;

  const amount = Math.round((priceGap * remainingUnits) / totalUnits);
  if (amount <= 0) return none('ההפרש מתאפס אחרי החישוב היחסי');

  return {
    eligible: true,
    reason: '',
    amount,
    price_gap: priceGap,
    from_sessions: from,
    to_sessions: to,
    from_label: frequencyLabelFor(from),
    to_label: frequencyLabelFor(to),
    remaining_units: remainingUnits,
    total_units: totalUnits,
    valid_until: new Date(endExclusive.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
}

export function describeShoesUpgrade(quote, studentName = '') {
  const who = String(studentName || '').trim();
  return `השלמת דמי השכרת נעליים${who ? ` — ${who}` : ''}: מעבר מ${quote.from_label} ל${quote.to_label}`;
}
