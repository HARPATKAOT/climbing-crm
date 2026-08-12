import { chargeAmount, netAmount, normalizePriceIncludesVat, roundMoney, VAT_RATE } from './vat.js';

/**
 * תמחור אירוע לפי מספר משתתפים.
 *
 * מחירון הקיר לא בנוי ממחיר אחד לאירוע. רוב שורותיו הן מחיר לראש עם מינימום
 * משתתפים (70₪ לראש ממינימום 20), חלקן עם תוספת שונה מעבר למינימום (50₪ לראש
 * עד 20, ואז 40₪ לכל ילד נוסף) וחלקן עם תקרת חיוב (110₪ לראש ממינימום 15, עד
 * 2,500₪). ארבעת השדות כאן מכסים את כל השורות האלה; מה שהם לא מכסים — כמו
 * תוספת מדריך לכל שלושה ילדים — נשאר תמחור ידני, במכוון.
 *
 * הקובץ הזה תאום ל-client/src/utils/activityPricing.js. שינוי בנוסחה חייב לקרות
 * בשניהם, אחרת המסך יראה סכום אחד והחיוב יצא אחר.
 */

export const CHARGE_BASES = ['flat', 'per_participant'];

export function normalizeChargeBasis(value) {
  return value === 'per_participant' ? 'per_participant' : 'flat';
}

/** מספר שלם אי-שלילי, או null כשהשדה ריק. null ו-0 הם אותה תשובה: אין מינימום. */
export function normalizeCount(value) {
  if (value === '' || value === null || value === undefined) return null;
  const count = Math.floor(Number(value));
  if (!Number.isFinite(count) || count <= 0) return null;
  return count;
}

/** סכום אי-שלילי, או null כשהשדה ריק. */
export function normalizeMoney(value) {
  if (value === '' || value === null || value === undefined) return null;
  const amount = roundMoney(Number(value));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/**
 * הפירוט המלא של חיוב אירוע.
 *
 * `participants` הוא מספר הנרשמים בפועל (או המספר שנקבע ידנית). הוא לא נכנס
 * לחישוב כמו שהוא: המינימום הוא רצפת חיוב, ולכן 12 נרשמים במינימום 15 מחויבים
 * כ-15. זו החלטה עסקית מכוונת — המינימום לא חוסם הרשמה, הוא רק קובע ממה מחייבים.
 */
export function eventChargeBreakdown(source = {}, { participants } = {}) {
  const basis = normalizeChargeBasis(source.charge_basis);
  const includesVat = normalizePriceIncludesVat(source.price_includes_vat);
  const perHead = roundMoney(Number(source.price) || 0);
  const minParticipants = normalizeCount(source.min_participants);
  const cap = normalizeMoney(source.max_charge);
  const extraPerHead = normalizeMoney(source.extra_participant_price);
  const registeredCount = normalizeCount(participants) || 0;

  if (basis !== 'per_participant') {
    // מחיר קבוע לאירוע — ההתנהגות שהייתה כאן מאז ומתמיד, ומה שכל אירוע קיים
    // ממשיך לקבל כל עוד לא בחרו במפורש אחרת.
    //
    // התקרה **לא** מועברת כאן. אירוע שהיה „לפי ראש” עם תקרה של 2,500 ועבר
    // למחיר קבוע של 3,000 היה מחויב 2,500: התקרה נשארה בשורה, המסך כבר לא הציג
    // אותה, והיא המשיכה לחתוך בשקט. תקרה היא מגבלה על מכפלה, ולמחיר אחד אין מה
    // להגביל.
    return finish({
      basis,
      includesVat,
      perHead,
      extraPerHead: null,
      minParticipants: null,
      cap: null,
      registeredCount,
      billableCount: null,
      baseCount: 0,
      extraCount: 0,
      subtotal: perHead,
    });
  }

  const billableCount = Math.max(registeredCount, minParticipants || 0);
  // תוספת בלי מינימום היא חסרת משמעות: אין ממה "לעבור". במצב כזה כל המשתתפים
  // מחויבים במחיר הבסיס, ולא כולם בתעריף התוספת.
  const tiered = extraPerHead != null && minParticipants > 0;
  const baseCount = tiered ? Math.min(billableCount, minParticipants) : billableCount;
  const extraCount = tiered ? Math.max(0, billableCount - minParticipants) : 0;
  const subtotal = roundMoney(perHead * baseCount + (tiered ? extraPerHead * extraCount : 0));

  return finish({
    basis,
    includesVat,
    perHead,
    extraPerHead: tiered ? extraPerHead : null,
    minParticipants,
    cap,
    registeredCount,
    billableCount,
    baseCount,
    extraCount,
    subtotal,
  });
}

function finish(parts) {
  const { cap, subtotal, includesVat } = parts;
  const capped = cap != null && subtotal > cap;
  // התקרה נקובה באותו מצב מע״מ כמו המחיר עצמו — מי שהקליד "עד 2,500 לפני מע״מ"
  // מתכוון לאותם 2,500 שבשדה המחיר.
  const entered = capped ? cap : roundMoney(subtotal);
  return {
    ...parts,
    capped,
    entered,
    net: netAmount(entered, includesVat),
    gross: chargeAmount(entered, includesVat),
    vat: roundMoney(chargeAmount(entered, includesVat) - netAmount(entered, includesVat)),
    rate: VAT_RATE,
  };
}

/**
 * הסכום לחיוב המזמין, ומספר המשתתפים שעליו הוא נשען.
 *
 * `host_charge_participants` הוא תיקון ידני של הצוות (מישהו נרשם ולא הגיע, או
 * הגיע בלי להירשם). כשהוא ריק — סופרים את הנרשמים בפועל.
 *
 * `numbers` הוא כלל מהמחירון, כשהאירוע מקושר לאחד. כשהוא null ההתנהגות זהה
 * לחלוטין להתנהגות שהייתה כאן לפני המחירון, ולכן אירוע ותיק לא זז.
 */
export function hostChargeBreakdown(activity = {}, { registeredCount = 0, numbers = null } = {}) {
  const override = normalizeCount(activity.host_charge_participants);
  const participants = override != null ? override : registeredCount;
  if (!numbers) return eventChargeBreakdown(activity, { participants });
  return ruleChargeBreakdown(numbers, { participants });
}

/**
 * חיוב לפי שורת מחירון.
 *
 * מדרגות מקבלות ענף משלהן כי הן מחיר קבוצתי שטוח ולא מכפלה של ראשים; שאר
 * השיטות נופלות למנוע הרגיל עם המספרים של הכלל במקום אלה של האירוע.
 */
export function ruleChargeBreakdown(numbers = {}, { participants } = {}) {
  if (numbers.method === 'brackets') return bracketBreakdown(numbers, { participants });
  const flat = numbers.method === 'flat';
  return eventChargeBreakdown({
    charge_basis: flat ? 'flat' : 'per_participant',
    price: flat ? numbers.event_price : numbers.participant_price,
    price_includes_vat: numbers.price_includes_vat,
    min_participants: numbers.min_participants,
    extra_participant_price: numbers.extra_participant_price,
    max_charge: numbers.max_charge,
  }, { participants });
}

/**
 * מדרגות: `[{ up_to, amount }]`, ממוינות ובלי חורים.
 *
 * המדרגה מוגדרת ב„עד כמה” בלבד ולא בטווח מ־עד, ובכוונה: שני גבולות לעריכה
 * ידנית פירושם שאפשר להקליד „1-10” ואז „12-15”, ואז קבוצה של 11 לא נופלת בשום
 * מדרגה. עם גבול אחד חור הוא בלתי אפשרי מבנית.
 */
export function normalizeBrackets(rows) {
  if (!Array.isArray(rows)) return [];
  const byCeiling = new Map();
  for (const row of rows) {
    const upTo = normalizeCount(row?.up_to);
    const amount = normalizeMoney(row?.amount);
    if (upTo == null || amount == null) continue;
    byCeiling.set(upTo, { up_to: upTo, amount });
  }
  return [...byCeiling.values()].sort((a, b) => a.up_to - b.up_to);
}

/** המדרגה שקבוצה בגודל הזה נופלת בה. null מעל המדרגה האחרונה או מתחת ל-1. */
export function bracketFor(brackets, count) {
  const rows = normalizeBrackets(brackets);
  if (!rows.length || !(count >= 1)) return null;
  return rows.find((row) => count <= row.up_to) || null;
}

/**
 * מחיר לפי מדרגות — מחיר קבוצתי שטוח, לא מכפלה של ראשים.
 *
 * קבוצה של 3 משלמת בדיוק כמו קבוצה של 10. מעל המדרגה האחרונה המנוע מסרב לתמחר
 * במקום להמציא: להשלים חמישה ראשים בחינם או להכפיל מחיר-לראש הם שניהם מספר
 * שאף אחד לא קבע. מוסיפים שורת מדרגה — זו לחיצה אחת במסך המחירון.
 */
export function bracketBreakdown(numbers = {}, { participants } = {}) {
  const includesVat = normalizePriceIncludesVat(numbers.price_includes_vat);
  const brackets = normalizeBrackets(numbers.brackets);
  const billableCount = normalizeCount(participants) || 0;
  const bracket = bracketFor(brackets, billableCount);
  const base = {
    basis: 'brackets',
    includesVat,
    perHead: normalizeMoney(numbers.participant_price),
    brackets,
    bracket,
    topBracket: brackets.length ? brackets[brackets.length - 1] : null,
    billableCount,
    registeredCount: billableCount,
    minParticipants: null,
    extraPerHead: null,
    cap: null,
    capped: false,
    baseCount: 0,
    extraCount: 0,
  };
  if (!bracket) {
    return {
      ...base,
      unpriced: true,
      unpricedReason: !brackets.length
        ? 'no_brackets'
        : billableCount < 1 ? 'no_participants' : 'over_top',
      entered: 0,
      net: 0,
      gross: 0,
      vat: 0,
      rate: VAT_RATE,
    };
  }
  const entered = roundMoney(bracket.amount);
  const gross = chargeAmount(entered, includesVat);
  const net = netAmount(entered, includesVat);
  return {
    ...base,
    unpriced: false,
    entered,
    net,
    gross,
    vat: roundMoney(gross - net),
    rate: VAT_RATE,
  };
}
