import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chargeAmount,
  icountVatType,
  netAmount,
  normalizePriceIncludesVat,
  vatBreakdown,
} from './vat.js';

describe('vat helpers', () => {
  it('treats entered price as including VAT by default', () => {
    assert.equal(normalizePriceIncludesVat(undefined), true);
    assert.equal(chargeAmount(118), 118);
    assert.equal(netAmount(118), 100);
    assert.equal(icountVatType(), 2);
    assert.equal(normalizePriceIncludesVat(false), false);
    assert.equal(chargeAmount(100, false), 118);
    assert.equal(netAmount(100, false), 100);
  });

  it('keeps charge equal to entered price when includes VAT', () => {
    assert.equal(chargeAmount(118, true), 118);
    assert.equal(netAmount(118, true), 100);
  });

  it('builds a clear breakdown for both modes', () => {
    assert.deepEqual(vatBreakdown(2500, false), {
      entered: 2500,
      includesVat: false,
      net: 2500,
      gross: 2950,
      vat: 450,
      rate: 0.18,
    });
    assert.deepEqual(vatBreakdown(118, true), {
      entered: 118,
      includesVat: true,
      net: 100,
      gross: 118,
      vat: 18,
      rate: 0.18,
    });
  });
});
