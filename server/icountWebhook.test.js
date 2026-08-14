import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIpnUrl, signWebhookPaymentId } from './icount.js';

test('iCount IPN URLs contain a payment-bound signature, not the reusable secret', () => {
  const previousSecret = process.env.ICOUNT_WEBHOOK_SECRET;
  const previousBase = process.env.PUBLIC_API_URL;
  try {
    process.env.ICOUNT_WEBHOOK_SECRET = 'do-not-leak-this-secret';
    process.env.PUBLIC_API_URL = 'https://api.example.test';
    const url = new URL(buildIpnUrl({ paymentId: 'pay-123' }));
    assert.equal(url.searchParams.get('payment_id'), 'pay-123');
    assert.equal(url.searchParams.get('secret'), null);
    assert.equal(url.searchParams.get('signature'), signWebhookPaymentId('pay-123'));
    assert.notEqual(signWebhookPaymentId('pay-123'), signWebhookPaymentId('pay-456'));
  } finally {
    if (previousSecret === undefined) delete process.env.ICOUNT_WEBHOOK_SECRET;
    else process.env.ICOUNT_WEBHOOK_SECRET = previousSecret;
    if (previousBase === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousBase;
  }
});
