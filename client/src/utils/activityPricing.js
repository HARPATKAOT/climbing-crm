import { chargeAmount, formatIls, netAmount, normalizePriceIncludesVat, roundMoney, VAT_RATE } from './vat.js';

/**
 * תמחור אירוע לפי מספר משתתפים — תאום של server/activityPricing.js.
 *
 * הנוסחה כאן ובשרת חייבות להישאר זהות: המסך מראה למי שעורך את האירוע כמה זה
 * יעלה, והשרת הוא זה שמחייב בפועל. הבדל ביניהן הוא הבטחה שבורה ללקוח.
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

export function eventChargeBreakdown(source = {}, { participants } = {}) {
  const basis = normalizeChargeBasis(source.charge_basis);
  const includesVat = normalizePriceIncludesVat(source.price_includes_vat);
  const perHead = roundMoney(Number(source.price) || 0);
  const minParticipants = normalizeCount(source.min_participants);
  const cap = normalizeMoney(source.max_charge);
  const extraPerHead = normalizeMoney(source.extra_participant_price);
  const registeredCount = normalizeCount(participants) || 0;

  if (basis !== 'per_participant') {
    // התקרה לא מועברת כאן: אירוע שהיה „לפי ראש” עם תקרה 2,500 ועבר למחיר קבוע
    // של 3,000 היה מחויב 2,500. תקרה מגבילה מכפלה, ולמחיר אחד אין מה להגביל.
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

export function hostChargeBreakdown(activity = {}, { registeredCount = 0, numbers = null } = {}) {
  const override = normalizeCount(activity.host_charge_participants);
  const participants = override != null ? override : registeredCount;
  if (!numbers) return eventChargeBreakdown(activity, { participants });
  return ruleChargeBreakdown(numbers, { participants });
}

/* ── מחירון: מדרגות ותאום של מנוע השרת ───────────────────────────────────── */

export const PRICE_METHODS = ['flat', 'per_head', 'brackets'];

export function normalizePriceMethod(value) {
  return PRICE_METHODS.includes(value) ? value : 'flat';
}

/**
 * מדרגות: `[{ up_to, amount }]`, ממוינות ובלי חורים.
 *
 * הגבול הוא „עד כמה” בלבד. שני גבולות לעריכה ידנית פירושם שאפשר להקליד 1-10
 * ואז 12-15, ואז קבוצה של 11 לא נופלת בשום מדרגה.
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

export function bracketFor(brackets, count) {
  const rows = normalizeBrackets(brackets);
  if (!rows.length || !(count >= 1)) return null;
  return rows.find((row) => count <= row.up_to) || null;
}

/**
 * מחיר לפי מדרגות — מחיר קבוצתי שטוח. קבוצה של 3 משלמת כמו קבוצה של 10.
 * מעל המדרגה האחרונה מסרבים לתמחר במקום להמציא מספר שאיש לא קבע.
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

/** חיוב לפי שורת מחירון. */
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
 * סולם המדרגות מנושן — ארבע מדרגות ממחיר משתתף יחיד.
 * המדרגה הרביעית אינה מעוגלת: 6,550 × 1.4 = 9,170, ועיגול ל-50 היה נותן 9,150.
 */
export function ladderFromSingle(singlePrice) {
  const base = Number(singlePrice) || 0;
  if (base <= 0) return [];
  const r50 = (value) => Math.round(value / 50) * 50;
  const first = r50(9.5 * base);
  const second = r50(1.7 * first);
  const third = r50(1.15 * second);
  return [
    { up_to: 10, amount: first },
    { up_to: 15, amount: second },
    { up_to: 20, amount: third },
    { up_to: 30, amount: roundMoney(1.4 * third) },
  ];
}

/**
 * שורת ההסבר שמופיעה מתחת לשדות המחיר ובכרטיס התשלום.
 *
 * מי שעורך את האירוע צריך לראות את החשבון עצמו, לא רק את התוצאה — אחרת אי אפשר
 * להבחין בין "מחויב על 20 כי כך נרשמו" לבין "מחויב על 20 כי זה המינימום".
 */
export function describeEventCharge(breakdown) {
  if (!breakdown) return '';
  if (breakdown.unpriced) {
    if (breakdown.unpricedReason === 'over_top') {
      return `מעל ${breakdown.topBracket?.up_to || ''} משתתפים — נדרשת הצעת מחיר`;
    }
    if (breakdown.unpricedReason === 'no_participants') return 'צריך מספר משתתפים כדי לתמחר';
    if (breakdown.unpricedReason === 'missing_rule') return 'שורת המחירון לא נמצאה';
    return 'עדיין אין מדרגות במחירון';
  }
  if (breakdown.entered <= 0) return '';
  if (breakdown.basis === 'brackets') {
    const perHead = breakdown.billableCount
      ? ` · ${formatIls(roundMoney(breakdown.entered / breakdown.billableCount))} לראש`
      : '';
    return `${breakdown.billableCount} משתתפים · מדרגה עד ${breakdown.bracket.up_to} · `
      + `${formatIls(breakdown.entered)} לקבוצה${perHead} · לתשלום ${formatIls(breakdown.gross)}`;
  }
  if (breakdown.basis !== 'per_participant') {
    return `${formatIls(breakdown.entered)} לאירוע · לתשלום ${formatIls(breakdown.gross)}`;
  }

  const parts = [];
  if (breakdown.extraCount > 0) {
    parts.push(`${breakdown.baseCount} × ${formatIls(breakdown.perHead)}`);
    parts.push(`${breakdown.extraCount} נוספים × ${formatIls(breakdown.extraPerHead)}`);
  } else {
    parts.push(`${breakdown.billableCount} משתתפים × ${formatIls(breakdown.perHead)}`);
  }

  let line = `${parts.join(' + ')} = ${formatIls(breakdown.entered)}`;
  if (breakdown.capped) line += ` (תקרה ${formatIls(breakdown.cap)})`;
  if (breakdown.minParticipants && breakdown.registeredCount < breakdown.minParticipants) {
    line += ` · לפי מינימום ${breakdown.minParticipants}`;
  }
  return `${line} · לתשלום ${formatIls(breakdown.gross)}`;
}

/**
 * תקציר שורת מחירון — אומר על מה גובים ולא רק כמה.
 * „70₪ לראש · מינימום 20” הוא מה שמבדיל בין שתי שורות שהמחיר הבודד שלהן זהה.
 */
export function describePriceRule(rule) {
  if (!rule) return '';
  const method = normalizePriceMethod(rule.method);
  const suffix = normalizePriceIncludesVat(rule.price_includes_vat) ? ' כולל מע״מ' : '';
  if (method === 'flat') {
    const price = normalizeMoney(rule.event_price);
    return price ? `${formatIls(price)} לאירוע${suffix}` : 'בלי מחיר';
  }
  if (method === 'brackets') {
    const rows = normalizeBrackets(rule.brackets);
    if (!rows.length) return 'מדרגות — עדיין ריק';
    const bits = [`${rows.length} מדרגות`, `עד ${rows[rows.length - 1].up_to} משתתפים`];
    const single = normalizeMoney(rule.participant_price);
    if (single) bits.push(`${formatIls(single)} למשתתף יחיד`);
    return bits.join(' · ');
  }
  const bits = [`${formatIls(normalizeMoney(rule.participant_price) || 0)} לראש${suffix}`];
  const min = normalizeCount(rule.min_participants);
  if (min) bits.push(`מינימום ${min}`);
  const extra = normalizeMoney(rule.extra_participant_price);
  if (extra && min) bits.push(`${formatIls(extra)} לכל נוסף`);
  const cap = normalizeMoney(rule.max_charge);
  if (cap) bits.push(`עד ${formatIls(cap)}`);
  return bits.join(' · ');
}

/** המספרים בלבד — מה שמגדיר כמה עולה, בלי שם והערות. תאום של השרת. */
export function ruleNumbers(rule = {}) {
  return {
    method: normalizePriceMethod(rule.method),
    price_includes_vat: normalizePriceIncludesVat(rule.price_includes_vat),
    event_price: normalizeMoney(rule.event_price),
    participant_price: normalizeMoney(rule.participant_price),
    min_participants: normalizeCount(rule.min_participants),
    extra_participant_price: normalizeMoney(rule.extra_participant_price),
    max_charge: normalizeMoney(rule.max_charge),
    brackets: normalizeBrackets(rule.brackets),
  };
}
