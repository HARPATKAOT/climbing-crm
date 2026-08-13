import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountWithVat,
  chargeAmount,
  netAmount,
  normalizePriceIncludesVat,
  vatBreakdown,
} from './vat.js';

describe('vat helpers', () => {
  it('treats entered price as including VAT by default', () => {
    assert.equal(normalizePriceIncludesVat(undefined), true);
    assert.equal(chargeAmount(118), 118);
    assert.equal(netAmount(118), 100);
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

describe('vat rate handling', () => {
  it('adds the rate to the price instead of replacing it', () => {
    // `base * (1 + Number(rate) || VAT_RATE)` grouped as `(1 + rate) || VAT_RATE`,
    // so an unreadable rate charged 18% *of* the price rather than price + 18%.
    assert.equal(chargeAmount(100, false, 0.17), 117);
    assert.equal(amountWithVat(100, 0.17), 117);
    assert.equal(netAmount(117, true, 0.17), 100);
  });

  it('keeps a VAT-exempt line at zero rather than charging 18%', () => {
    assert.equal(chargeAmount(100, false, 0), 100);
    assert.equal(netAmount(100, true, 0), 100);
    assert.deepEqual(vatBreakdown(100, false, 0), {
      entered: 100,
      includesVat: false,
      net: 100,
      gross: 100,
      vat: 0,
      rate: 0,
    });
  });

  it('falls back to the standard rate only when none was given', () => {
    assert.equal(chargeAmount(100, false, undefined), 118);
    assert.equal(chargeAmount(100, false, null), 118);
    assert.equal(chargeAmount(100, false, ''), 118);
  });

  it('refuses a rate it cannot read instead of inventing one', () => {
    for (const bad of ['abc', NaN, -0.1, 1.5, 18, {}]) {
      assert.throws(() => chargeAmount(100, false, bad), /שיעור מע״מ לא תקין/);
      assert.throws(() => netAmount(100, true, bad), /שיעור מע״מ לא תקין/);
      assert.throws(() => vatBreakdown(100, false, bad), /שיעור מע״מ לא תקין/);
    }
  });
});
