import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  getPublicApiBase,
  isLocalPublicApiBase,
  buildPaymentRedirectUrl,
  buildPaymentRedirectToken,
  buildPaymentUrl,
  extractCcClearing,
} from './icount.js';
import { verifyPublicRedirectToken } from './security.js';

const ENV_KEYS = [
  'PUBLIC_API_URL',
  'RENDER_EXTERNAL_URL',
  'NODE_ENV',
  'PORT',
  'ICOUNT_EVENT_PAY_PAGE_URL',
  'PUBLIC_LINK_SECRET',
];

function snapshotEnv() {
  const snap = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

describe('getPublicApiBase matches environment', () => {
  const snap = snapshotEnv();

  afterEach(() => {
    restoreEnv(snap);
  });

  it('prefers PUBLIC_API_URL when set', () => {
    process.env.PUBLIC_API_URL = 'https://example.test/api/';
    delete process.env.RENDER_EXTERNAL_URL;
    assert.equal(getPublicApiBase(), 'https://example.test/api');
    assert.equal(isLocalPublicApiBase(), false);
  });

  it('falls back to localhost outside production', () => {
    delete process.env.PUBLIC_API_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.NODE_ENV;
    process.env.PORT = '5001';
    process.env.PUBLIC_LINK_SECRET = 'public-link-test-secret';
    assert.equal(getPublicApiBase(), 'http://localhost:5001');
    assert.equal(isLocalPublicApiBase(), true);
    const token = buildPaymentRedirectToken('pa1');
    assert.notEqual(token, 'pa1');
    assert.equal(verifyPublicRedirectToken(token, 'payment'), 'pa1');
    assert.equal(buildPaymentRedirectUrl('pa1'), `http://localhost:5001/r/${encodeURIComponent(token)}`);
  });

  it('falls back to live API in production', () => {
    delete process.env.PUBLIC_API_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    process.env.NODE_ENV = 'production';
    assert.equal(getPublicApiBase(), 'https://climbing-crm-api.onrender.com');
    assert.equal(isLocalPublicApiBase(), false);
  });
});

describe('extractCcClearing', () => {
  it('reads confirmation code and card details from doc info', () => {
    const clearing = extractCcClearing({
      doc_info: {
        has_cc: true,
        cc: [
          {
            confirmation_code: '044263',
            card_number: '7024',
            card_type: 'VISA',
          },
        ],
      },
    });
    assert.equal(clearing.cc_confirmation_code, '044263');
    assert.equal(clearing.cc_last4, '7024');
    assert.equal(clearing.cc_card_type, 'VISA');
    assert.equal(clearing.has_cc, true);
  });
});

describe('buildPaymentUrl customer details', () => {
  const snap = snapshotEnv();

  afterEach(() => {
    restoreEnv(snap);
  });

  it('sends separate first name, last name and identity number', async () => {
    process.env.ICOUNT_EVENT_PAY_PAGE_URL = 'https://example.test/pay';
    const result = await buildPaymentUrl({
      amount: 100,
      name: 'דלק אייל',
      lastName: 'אייל',
      idNumber: '032-702-656',
      pageKind: 'event',
    });
    const url = new URL(result);
    assert.equal(url.searchParams.get('ccfname'), 'דלק');
    assert.equal(url.searchParams.get('cclname'), 'אייל');
    assert.equal(url.searchParams.get('ccid'), '032702656');
  });

  it('splits a legacy full name when no separate last name exists', async () => {
    process.env.ICOUNT_EVENT_PAY_PAGE_URL = 'https://example.test/pay';
    const result = await buildPaymentUrl({
      name: 'דניאל כהן',
      pageKind: 'event',
    });
    const url = new URL(result);
    assert.equal(url.searchParams.get('ccfname'), 'דניאל');
    assert.equal(url.searchParams.get('cclname'), 'כהן');
  });
});
