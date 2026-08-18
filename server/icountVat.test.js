import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createInvRec } from './icount.js';

const originalToken = process.env.ICOUNT_API_TOKEN;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalToken === undefined) delete process.env.ICOUNT_API_TOKEN;
  else process.env.ICOUNT_API_TOKEN = originalToken;
  globalThis.fetch = originalFetch;
});

describe('iCount VAT-inclusive invoice', () => {
  it('marks gross POS prices as VAT-inclusive and keeps the payment equal to the cart total', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    let sentFields = null;
    globalThis.fetch = async (_url, options) => {
      sentFields = Object.fromEntries(options.body.entries());
      return {
        status: 200,
        text: async () => JSON.stringify({ status: true, doc_id: 'doc-1', docnum: '1001' }),
      };
    };

    const result = await createInvRec({
      clientName: 'Test customer',
      items: [{ description: 'Wall entry', unitprice: 35, quantity: 1 }],
      paymentMethod: 'cash',
    });

    assert.equal(sentFields.vattype, '0');
    assert.equal(sentFields['items[0][unitprice_incvat]'], '35');
    assert.equal(sentFields['items[0][unitprice]'], undefined);
    assert.equal(sentFields['cash[sum]'], '35');
    assert.equal(result.paidAmount, 35);
  });
});
