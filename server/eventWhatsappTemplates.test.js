import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
  ensureEventWhatsappTemplates,
  findApprovedEventTemplate,
  isEventWhatsappTemplate,
} from './eventWhatsappTemplates.js';

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
  const first = ensureEventWhatsappTemplates({
    db,
    publicAppBase: 'https://example.com',
  });
  assert.equal(first.hostPayment.meta_name, EVENT_HOST_PAYMENT_TEMPLATE);
  assert.equal(first.participantLink.meta_name, EVENT_PARTICIPANT_LINK_TEMPLATE);
  assert.equal(first.hostPayment.status, 'DRAFT');
  assert.match(first.hostPayment.name, /אירוע/);
  assert.match(first.participantLink.name, /אירוע/);
  assert.equal(first.hostPayment.footer, '');
  assert.equal(first.participantLink.footer, '');
  assert.ok(first.hostPayment.buttons[0].url.startsWith('https://example.com/event-host/'));
  assert.ok(first.participantLink.buttons[0].url.startsWith('https://example.com/event/'));

  const second = ensureEventWhatsappTemplates({ db });
  assert.equal(second.hostPayment.id, first.hostPayment.id);
  assert.equal(second.participantLink.id, first.participantLink.id);
  assert.equal(db.store.message_templates.length, 2);
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
  assert.equal(
    publicBase('http://localhost:3001'),
    'https://client-omega-topaz-35.vercel.app'
  );
});
