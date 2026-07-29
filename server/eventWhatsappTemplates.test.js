import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  EVENT_HOST_PAYMENT_FALLBACKS,
  ensureEventWhatsappTemplates,
  findApprovedEventTemplate,
  isEventWhatsappTemplate,
  resolveEventTemplate,
} from './eventWhatsappTemplates.js';
import { LIVE_API_BASE, LIVE_APP_BASE } from './publicLinks.js';

function makeDb(store) {
  return {
    store,
    get: (table) => store[table] || [],
    insert: (table, row) => {
      if (!store[table]) store[table] = [];
      store[table].push(row);
      return row;
    },
  };
}

test('ensureEventWhatsappTemplates creates both drafts once', () => {
  const db = makeDb({ message_templates: [] });
  const first = ensureEventWhatsappTemplates({ db });
  assert.equal(first.hostPayment.meta_name, EVENT_HOST_PAYMENT_TEMPLATE);
  assert.equal(first.participantLink.meta_name, EVENT_PARTICIPANT_LINK_TEMPLATE);
  assert.equal(first.hostPayment.status, 'DRAFT');
  assert.match(first.hostPayment.name, /אירוע/);
  assert.match(first.participantLink.name, /אירוע/);
  assert.equal(first.hostPayment.footer, '');
  assert.equal(first.participantLink.footer, '');
  // Staff need to know what each system template is for without asking.
  assert.match(first.hostPayment.usage, /\S/);
  assert.match(first.participantLink.usage, /\S/);

  const second = ensureEventWhatsappTemplates({ db });
  assert.equal(second.hostPayment.id, first.hostPayment.id);
  assert.equal(second.participantLink.id, first.participantLink.id);
  assert.equal(db.store.message_templates.length, 2);
});

test('event buttons point at the API redirect, so a domain move needs no re-approval', () => {
  const original = { front: process.env.FRONTEND_URL, api: process.env.PUBLIC_API_URL };
  try {
    // Even a staff machine on localhost must seed the live redirect host.
    process.env.FRONTEND_URL = 'http://localhost:3001';
    process.env.PUBLIC_API_URL = 'http://localhost:5001';
    const db = makeDb({ message_templates: [] });
    const { hostPayment, participantLink } = ensureEventWhatsappTemplates({ db });
    assert.equal(hostPayment.buttons[0].url, `${LIVE_API_BASE}/eh/{{1}}`);
    assert.equal(participantLink.buttons[0].url, `${LIVE_API_BASE}/ev/{{1}}`);
    for (const url of [hostPayment.buttons[0].url, participantLink.buttons[0].url]) {
      assert.ok(!url.includes('localhost'));
      assert.ok(!url.includes('vercel.app'), 'button must not name the site host');
    }
  } finally {
    for (const [key, value] of [['FRONTEND_URL', original.front], ['PUBLIC_API_URL', original.api]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('resolveEventTemplate falls back while v4 waits for Meta review', () => {
  const approvedV3 = {
    id: 'tpl-event-host-payment-v3',
    meta_name: EVENT_HOST_PAYMENT_FALLBACKS[0],
    status: 'APPROVED',
    active_for_send: true,
  };
  const pendingV4 = {
    id: 'tpl-event-host-payment-v4',
    meta_name: EVENT_HOST_PAYMENT_TEMPLATE,
    status: 'DRAFT',
    active_for_send: false,
  };
  const db = makeDb({ message_templates: [pendingV4, approvedV3] });
  assert.equal(resolveEventTemplate(db, 'host').meta_name, EVENT_HOST_PAYMENT_FALLBACKS[0]);

  db.store.message_templates[0] = { ...pendingV4, status: 'APPROVED' };
  assert.equal(resolveEventTemplate(db, 'host').meta_name, EVENT_HOST_PAYMENT_TEMPLATE);
  assert.equal(resolveEventTemplate(db, 'participant'), null);
});

test('isEventWhatsappTemplate and findApprovedEventTemplate', () => {
  const draft = {
    id: 'tpl-event-host-payment-v3',
    meta_name: EVENT_HOST_PAYMENT_TEMPLATE,
    status: 'DRAFT',
    active_for_send: false,
  };
  assert.equal(isEventWhatsappTemplate(draft), true);
  assert.equal(isEventWhatsappTemplate({ meta_name: 'other' }), false);

  const db = makeDb({
    message_templates: [
      { ...draft, status: 'APPROVED', active_for_send: true },
    ],
  });
  assert.ok(findApprovedEventTemplate(db, EVENT_HOST_PAYMENT_TEMPLATE));
  assert.equal(findApprovedEventTemplate(db, EVENT_PARTICIPANT_LINK_TEMPLATE), null);
});

test('publicBase rejects localhost and falls back to live app', async () => {
  const { publicBase } = await import('./eventWhatsappTemplates.js');
  // Asserted against the shared constant so moving the site needs one edit.
  assert.equal(publicBase('http://localhost:3001'), LIVE_APP_BASE);
  assert.ok(!LIVE_APP_BASE.includes('localhost'));
});
