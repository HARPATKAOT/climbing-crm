/** Israel standard VAT rate used by this account. */
export const VAT_RATE = 0.18;
export const DEFAULT_PRICE_INCLUDES_VAT = true;

/**
 * The rate to apply, or the standard one when none was given.
 *
 * A rate of 0 is a real answer — a VAT-exempt line — so it must survive, which
 * `Number(rate) || VAT_RATE` does not. Anything that is not a number between 0
 * and 1 is not a rate at all: falling back to 18% there would quietly charge
 * VAT nobody asked for, so it throws instead.
 */
function resolveRate(rate) {
  if (rate === undefined || rate === null || rate === '') return VAT_RATE;
  const value = Number(rate);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`שיעור מע״מ לא תקין: ${rate}`);
  }
  return value;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizePriceIncludesVat(value, fallback = DEFAULT_PRICE_INCLUDES_VAT) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return !!fallback;
}

/**
 * Amount the customer should pay (gross).
 *
 * The multiplier used to be written `base * (1 + Number(rate) || VAT_RATE)`.
 * `+` binds tighter than `||`, so the group was `(1 + rate) || VAT_RATE`: an
 * unreadable rate collapsed to 0.18 and the customer was charged *eighteen
 * percent of the price* instead of the price plus eighteen percent. The same
 * line sat on the invoice total in icount.js. Nobody hit it because every
 * caller uses the default, which is exactly why it survived this long.
 */
export function chargeAmount(price, includesVat = DEFAULT_PRICE_INCLUDES_VAT, rate = VAT_RATE) {
  const base = roundMoney(Number(price) || 0);
  if (includesVat) return base;
  return roundMoney(base * (1 + resolveRate(rate)));
}

/** Net amount before VAT. */
export function netAmount(price, includesVat = DEFAULT_PRICE_INCLUDES_VAT, rate = VAT_RATE) {
  const base = roundMoney(Number(price) || 0);
  if (!includesVat) return base;
  return roundMoney(base / (1 + resolveRate(rate)));
}

/** iCount vattype: 1 = prices before VAT, 0 = prices include VAT. */
export function icountVatType(includesVat = DEFAULT_PRICE_INCLUDES_VAT) {
  return includesVat ? 0 : 1;
}

export function vatBreakdown(price, includesVat = DEFAULT_PRICE_INCLUDES_VAT, rate = VAT_RATE) {
  const entered = roundMoney(Number(price) || 0);
  const net = netAmount(entered, includesVat, rate);
  const gross = chargeAmount(entered, includesVat, rate);
  return {
    entered,
    includesVat: !!includesVat,
    net,
    gross,
    vat: roundMoney(gross - net),
    rate: resolveRate(rate),
  };
}
