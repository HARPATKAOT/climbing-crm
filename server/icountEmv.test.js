import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  chargeEmv,
  createInvRec,
  emvStatus,
  emvTimeoutMs,
  findCcChargeByConfirmation,
  listCcCharges,
} from './icount.js';

const originalToken = process.env.ICOUNT_API_TOKEN;
const originalTimeout = process.env.ICOUNT_EMV_TIMEOUT_MS;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalToken === undefined) delete process.env.ICOUNT_API_TOKEN;
  else process.env.ICOUNT_API_TOKEN = originalToken;
  if (originalTimeout === undefined) delete process.env.ICOUNT_EMV_TIMEOUT_MS;
  else process.env.ICOUNT_EMV_TIMEOUT_MS = originalTimeout;
  globalThis.fetch = originalFetch;
});

/** מחליף את ה-fetch ומחזיר את מה שנשלח בפועל, לפי endpoint. */
function stubIcount(responder) {
  const seen = [];
  globalThis.fetch = async (url, options) => {
    const endpoint = String(url).split('/api/v3.php/')[1] || '';
    const fields = Object.fromEntries(options.body.entries());
    seen.push({ endpoint, fields, signal: options.signal });
    return { json: async () => responder(endpoint, fields) };
  };
  return seen;
}

describe('cc/emv — חיוב במסוף', () => {
  it('שולח סכום ומטבע, ומחזיר את מספר האישור', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    const seen = stubIcount(() => ({
      status: true,
      success: true,
      confirmation_code: '0616038',
      cc_type: 'VISA',
      cc_last4: '4398',
    }));

    const result = await chargeEmv({ clientId: '1554', sum: 120.004, email: 'a@b.c' });

    assert.equal(seen[0].endpoint, 'cc/emv');
    assert.equal(seen[0].fields.sum, '120');
    assert.equal(seen[0].fields.currency_code, 'ILS');
    assert.equal(seen[0].fields.client_id, '1554');
    // תשלום אחד אינו נשלח כלל — זו ברירת המחדל של iCount.
    assert.equal(seen[0].fields.num_of_payments, undefined);
    assert.ok(seen[0].signal, 'לחיוב במסוף חייבת להיות תקרת זמן');
    assert.equal(result.confirmationCode, '0616038');
    assert.equal(result.cardType, 'VISA');
    assert.equal(result.cardLast4, '4398');
  });

  it('כרטיס שנדחה הוא כישלון ודאי — מותר לחייב שוב', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    stubIcount(() => ({ status: true, success: false, error_description: 'הכרטיס נדחה' }));

    await assert.rejects(
      () => chargeEmv({ sum: 50, clientName: 'לקוח' }),
      (err) => err.indeterminate === false && /נדחה/.test(err.message)
    );
  });

  it('תום זמן אינו כישלון ודאי — ייתכן שהכסף נגבה', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    globalThis.fetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    };

    await assert.rejects(
      () => chargeEmv({ sum: 50, clientName: 'לקוח' }),
      (err) => err.indeterminate === true && err.code === 'timeout'
    );
  });

  it('שגיאת רשת גם היא אינה ודאית', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };

    await assert.rejects(
      () => chargeEmv({ sum: 50, clientName: 'לקוח' }),
      (err) => err.indeterminate === true && err.code === 'network'
    );
  });

  it('סכום אפס נדחה בלי לגעת במסוף', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    const seen = stubIcount(() => ({ status: true }));
    await assert.rejects(() => chargeEmv({ sum: 0 }), (err) => err.code === 'bad_sum');
    assert.equal(seen.length, 0);
  });

  it('תקרת הזמן ניתנת לכוונון בגבולות שפויים בלבד', () => {
    delete process.env.ICOUNT_EMV_TIMEOUT_MS;
    assert.equal(emvTimeoutMs(), 180000);
    process.env.ICOUNT_EMV_TIMEOUT_MS = '90000';
    assert.equal(emvTimeoutMs(), 90000);
    process.env.ICOUNT_EMV_TIMEOUT_MS = '5';
    assert.equal(emvTimeoutMs(), 180000);
  });
});

describe('חשבונית על חיוב שנעשה במסוף', () => {
  it('נושאת את מספר האישור, הכרטיס ומפתח כפילות', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    const seen = stubIcount(() => ({ status: true, doc_id: 'd1', docnum: '4200' }));

    await createInvRec({
      clientName: 'לקוח מדלפק',
      items: [{ description: 'כניסה לקיר', unitprice: 60, quantity: 2 }],
      paymentMethod: 'emv',
      cc: { confirmationCode: '0616038', last4: '4398', cardType: 'VISA', numOfPayments: 1 },
      sanityString: 'emv-0616038',
    });

    const f = seen[0].fields;
    assert.equal(f['cc[0][sum]'], '120');
    assert.equal(f['cc[0][confirmation_code]'], '0616038');
    assert.equal(f['cc[0][card_number]'], '4398');
    assert.equal(f['cc[0][card_type]'], 'VISA');
    assert.equal(f.sanity_string, 'emv-0616038');
    assert.equal(f['cash[sum]'], undefined, 'חיוב אשראי לא נרשם כמזומן');
  });
});

describe('מצב מסוף הסליקה', () => {
  it('זמין רק כשהמודול דלוק, הסליקה דלוקה ויש מכשיר', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    stubIcount(() => ({
      status: true,
      company_settings: { emv_enabled: true, cc_enabled: true, emv_devices: ['111'] },
    }));
    const ok = await emvStatus({ force: true });
    assert.equal(ok.available, true);
    assert.deepEqual(ok.devices, ['111']);

    stubIcount(() => ({
      status: true,
      company_settings: { emv_enabled: true, cc_enabled: true, emv_devices: [] },
    }));
    const noDevice = await emvStatus({ force: true });
    assert.equal(noDevice.available, false);
    assert.match(noDevice.reason, /מכשיר/);
  });

  it('כשל בבדיקה מחזיר „לא זמין” ולא זורק — הקופה ממשיכה לעבוד', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const status = await emvStatus({ force: true });
    assert.equal(status.available, false);
    assert.ok(status.reason);
  });
});

describe('יומן חיובי האשראי', () => {
  it('מנרמל שורה ומזהה חיוב שכבר יש עליו מסמך', async () => {
    process.env.ICOUNT_API_TOKEN = 'test-token';
    stubIcount(() => ({
      status: true,
      results_list: [{
        cc_bill_log_id: '79413854',
        confirmation_code: '0616038',
        cctotal: '200',
        cc_cardnumber: '4398',
        cc_cardtype: 'MASTERCARD',
        cc_numofpayments: '1',
        cc_charge_date: '2026-08-16',
        docnumber: '4168',
        refunded: '0',
      }],
    }));

    const [row] = await listCcCharges({ date: '2026-08-16' });
    assert.equal(row.ccBillLogId, '79413854');
    assert.equal(row.charged, 200);
    assert.equal(row.cardLast4, '4398');
    assert.equal(row.docnumber, '4168');
    assert.equal(row.alreadyRefunded, false);

    const found = await findCcChargeByConfirmation({ confirmationCode: '0616038' });
    assert.equal(found.ccBillLogId, '79413854');
  });
});
