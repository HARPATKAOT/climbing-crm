import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSessionWindow,
  enrichParentInboundFromMessages,
  enrichParentInboundFromSiblings,
} from './sessionWindow.js';

test('session window opens within 24 hours of inbound', () => {
  const now = Date.parse('2026-07-22T10:00:00.000Z');
  const result = getSessionWindow('2026-07-22T09:58:00.000Z', now);
  assert.equal(result.open, true);
});

test('session window stays closed without inbound', () => {
  const result = getSessionWindow(null, Date.now());
  assert.equal(result.open, false);
  assert.equal(result.label, 'סגור');
});

test('enrich parent inbound from newer thread message', () => {
  const parent = {
    id: 'p1',
    last_inbound_whatsapp: '2026-07-20T10:00:00.000Z',
  };
  const messages = [
    { direction: 'outbound', channel: 'whatsapp', created_at: '2026-07-22T08:00:00.000Z' },
    { direction: 'inbound', channel: 'whatsapp', created_at: '2026-07-22T09:58:00.000Z', message: 'מה קורה ?' },
  ];
  const enriched = enrichParentInboundFromMessages(parent, messages);
  assert.equal(enriched.last_inbound_whatsapp, '2026-07-22T09:58:00.000Z');
});

test('enrich keeps parent timestamp when it is newer', () => {
  const parent = {
    id: 'p1',
    last_inbound_whatsapp: '2026-07-22T11:00:00.000Z',
  };
  const messages = [
    { direction: 'inbound', channel: 'whatsapp', created_at: '2026-07-22T09:58:00.000Z' },
  ];
  const enriched = enrichParentInboundFromMessages(parent, messages);
  assert.equal(enriched.last_inbound_whatsapp, '2026-07-22T11:00:00.000Z');
});

test('enrich copies newer inbound from duplicate parent sibling', () => {
  const parent = {
    id: 'p-050',
    phone: '0508862878',
    last_inbound_whatsapp: null,
  };
  const siblings = [
    {
      id: 'p-972',
      phone: '972508862878',
      last_inbound_whatsapp: '2026-07-23T05:22:24.772Z',
    },
  ];
  const enriched = enrichParentInboundFromSiblings(parent, siblings);
  assert.equal(enriched.last_inbound_whatsapp, '2026-07-23T05:22:24.772Z');
  const now = Date.parse('2026-07-23T05:23:00.000Z');
  assert.equal(getSessionWindow(enriched.last_inbound_whatsapp, now).open, true);
});
