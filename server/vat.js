/** Israel standard VAT rate used by this account. */
export const VAT_RATE = 0.18;

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function normalizePriceIncludesVat(value, fallback = false) {
  if (value === true || value === 1 || value === '1' || value === 'true') return true;
  if (value === false || value === 0 || value === '0' || value === 'false') return false;
  return !!fallback;
}

/** Amount the customer should pay (gross). */
export function chargeAmount(price, includesVat = false, rate = VAT_RATE) {
  const base = roundMoney(Number(price) || 0);
  if (includesVat) return base;
  return roundMoney(base * (1 + Number(rate) || VAT_RATE));
}

/** Net amount before VAT. */
export function netAmount(price, includesVat = false, rate = VAT_RATE) {
  const base = roundMoney(Number(price) || 0);
  if (!includesVat) return base;
  const vat = Number(rate) || VAT_RATE;
  return roundMoney(base / (1 + vat));
}

/** iCount vattype: 1 = prices before VAT, 2 = prices include VAT. */
export function icountVatType(includesVat = false) {
  return includesVat ? 2 : 1;
}

export function vatBreakdown(price, includesVat = false, rate = VAT_RATE) {
  const entered = roundMoney(Number(price) || 0);
  const net = netAmount(entered, includesVat, rate);
  const gross = chargeAmount(entered, includesVat, rate);
  return {
    entered,
    includesVat: !!includesVat,
    net,
    gross,
    vat: roundMoney(gross - net),
    rate: Number(rate) || VAT_RATE,
  };
}
