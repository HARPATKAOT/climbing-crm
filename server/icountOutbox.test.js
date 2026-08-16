process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueIcountEvent, processOutbox, reviveOutboxRow, MAX_OUTBOX_ATTEMPTS } from './icountOutbox.js';
import { reconcileMonth, runIcountReconciliation } from './icountReconciliation.js';

function makeStore(seed = {}) {
  const tables = { ...seed };
  return {
    tables,
    get: (table) => tables[table] || [],
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      tables[table].push({ created_at: new Date().toISOString(), ...record });
      return tables[table][tables[table].length - 1];
    },
    update: (table, id, record) => {
      const list = tables[table] || [];
      const index = list.findIndex((row) => String(row.id) === String(id));
      if (index >= 0) list[index] = record;
      return record;
    },
  };
}

test('enqueue with the same idempotency key never duplicates', () => {
  const store = makeStore();
  const first = enqueueIcountEvent(store, { event_type: 'invrec_create', payload: { a: 1 }, idempotency_key: 'sale:1' });
  const second = enqueueIcountEvent(store, { event_type: 'invrec_create', payload: { a: 1 }, idempotency_key: 'sale:1' });
  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(store.get('icount_outbox').length, 1);
  assert.throws(() => enqueueIcountEvent(store, { event_type: 'x', payload: {} }), /idempotency_key/);
});

test('worker sends due events and records the result', async () => {
  const store = makeStore();
  enqueueIcountEvent(store, { event_type: 'invrec_create', payload: { clientName: 'דנה' }, idempotency_key: 'sale:2' });
  const calls = [];
  const summary = await processOutbox(store, {
    icountClient: { createInvRec: async (payload) => { calls.push(payload); return { docnum: '1001' }; } },
    allowRealDocs: true,
  });
  assert.equal(summary.sent, 1);
  assert.equal(calls.length, 1);
  const row = store.get('icount_outbox')[0];
  assert.equal(row.status, 'sent');
  assert.deepEqual(row.result, { docnum: '1001' });
});

test('sandbox gate: outside production no document call ever reaches iCount', async () => {
  const store = makeStore();
  enqueueIcountEvent(store, { event_type: 'invrec_create', payload: {}, idempotency_key: 'sale:3' });
  let reached = false;
  const summary = await processOutbox(store, {
    icountClient: { createInvRec: async () => { reached = true; return {}; } },
    allowRealDocs: false,
  });
  assert.equal(reached, false, 'מסמך אמיתי כמעט הונפק מסביבת פיתוח');
  assert.equal(summary.mocked, 1);
  assert.equal(store.get('icount_outbox')[0].result.mock, true);
});

test('failure backs off exponentially and dies into an inbox item after max attempts', async () => {
  const store = makeStore();
  enqueueIcountEvent(store, { event_type: 'refund_doc', payload: {}, idempotency_key: 'refund:9' });
  const failing = { createRefundDoc: async () => { throw new Error('iCount 500'); } };
  // ה-enqueue מסמן זמינות "עכשיו" אמיתי — השעון המדומה חייב להתחיל אחריו.
  let clock = new Date(Date.now() + 1000);
  for (let attempt = 1; attempt <= MAX_OUTBOX_ATTEMPTS; attempt += 1) {
    await processOutbox(store, { icountClient: failing, allowRealDocs: true, now: clock });
    const row = store.get('icount_outbox')[0];
    assert.equal(row.attempts, attempt);
    if (attempt < MAX_OUTBOX_ATTEMPTS) {
      assert.equal(row.status, 'pending');
      assert.ok(row.next_attempt_at > clock.toISOString(), 'ה-retry חייב להידחות קדימה');
      clock = new Date(new Date(row.next_attempt_at).getTime() + 1000);
    } else {
      assert.equal(row.status, 'dead');
    }
  }
  const inboxItem = store.get('finance_inbox_items').find((row) => row.item_type === 'sync_error');
  assert.ok(inboxItem, 'כשל סופי חייב פריט inbox — אסור שהנפקה תיכשל בשקט');
  // כפתור "נסה שוב"
  reviveOutboxRow(store, store.get('icount_outbox')[0].id);
  assert.equal(store.get('icount_outbox')[0].status, 'pending');
  assert.equal(store.get('icount_outbox')[0].attempts, 0);
});

test('client_upsert maintains icount_links', async () => {
  const store = makeStore();
  enqueueIcountEvent(store, {
    event_type: 'client_upsert',
    payload: { parent: { id: 'p1', name: 'אורי' } },
    idempotency_key: 'parent:p1:v1',
  });
  await processOutbox(store, {
    icountClient: { ensureClient: async () => ({ clientId: '777', created: true }) },
    allowRealDocs: true, // גם client_upsert חסום מחוץ לפרודקשן
  });
  const link = store.get('icount_links')[0];
  assert.equal(link.entity_type, 'parent');
  assert.equal(link.local_id, 'p1');
  assert.equal(link.icount_id, '777');
});

// ─── reconciliation ─────────────────────────────────────────────────────────

const paidPayment = (over = {}) => ({
  id: over.id ?? 'pay1',
  status: 'paid',
  amount: over.amount ?? 350,
  paid_at: over.paid_at ?? '2026-07-10T10:00:00Z',
  icount_doc_number: over.icount_doc_number,
});

const revenueDoc = (over = {}) => ({
  id: over.id ?? 'doc1',
  doctype: over.doctype ?? 'invrec',
  docnum: over.docnum ?? '2001',
  document_date: over.document_date ?? '2026-07-10',
  total_gross: over.total_gross ?? 350,
  vat_amount: over.vat_amount ?? 53.39,
  is_storno: false,
});

test('a balanced month produces no inbox items', () => {
  const store = makeStore();
  const detail = reconcileMonth(store, {
    month: '2026-07',
    payments: [paidPayment({ icount_doc_number: '2001' })],
    documents: [revenueDoc()],
  });
  assert.equal(detail.status, 'balanced');
  assert.equal(detail.gap_agorot, 0);
  assert.equal(store.get('finance_inbox_items').length, 0);
});

test('a payment without a document becomes an explained inbox item', () => {
  const store = makeStore();
  const detail = reconcileMonth(store, {
    month: '2026-07',
    payments: [paidPayment({ icount_doc_number: '2001' }), paidPayment({ id: 'pay2', amount: 200 })],
    documents: [revenueDoc()],
  });
  assert.equal(detail.status, 'gap');
  assert.equal(detail.undocumented_count, 1);
  assert.equal(detail.undocumented_agorot, 20000);
  // הפער כולו מוסבר על ידי התשלום חסר-המסמך — אין פריט "פער לא מוסבר"
  assert.equal(detail.unexplained_gap_agorot, 0);
  const items = store.get('finance_inbox_items');
  assert.equal(items.filter((row) => row.item_type === 'charge_without_document').length, 1);
  assert.equal(items.filter((row) => row.item_type === 'reconciliation_gap').length, 0);
});

test('an unexplained gap raises its own item; credit notes count negative', () => {
  const store = makeStore();
  const detail = reconcileMonth(store, {
    month: '2026-07',
    payments: [paidPayment({ icount_doc_number: '2001', amount: 350 })],
    documents: [
      revenueDoc(),
      revenueDoc({ id: 'doc2', docnum: '2002', doctype: 'refund', total_gross: 100, vat_amount: 15.25 }),
    ],
  });
  // מסמכים: 350 - 100 = 250; גבייה: 350 ⇒ פער 100 ש״ח לא מוסבר
  assert.equal(detail.documented_agorot, 25000);
  assert.equal(detail.unexplained_gap_agorot, 10000);
  const gapItem = store.get('finance_inbox_items').find((row) => row.item_type === 'reconciliation_gap');
  assert.ok(gapItem);
  assert.match(gapItem.detail, /בירור/);
});

test('runIcountReconciliation covers the requested months and is idempotent', () => {
  const store = makeStore({
    payments: [paidPayment({ icount_doc_number: '2001' })],
    finance_documents: [revenueDoc()],
  });
  const first = runIcountReconciliation(store, { months: 3, now: '2026-08-15T00:00:00Z' });
  assert.equal(first.months, 3);
  const again = runIcountReconciliation(store, { months: 3, now: '2026-08-15T00:00:00Z' });
  assert.equal(again.months, 3);
  // ריצה שנייה מעדכנת את אותן שורות, לא מכפילה
  assert.equal(store.get('finance_reconciliation_items').length, 3);
});
