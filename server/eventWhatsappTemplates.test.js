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
  assert.ok(first.hostPayment.buttons[0].url.includes('/event-host/{{1}}'));
  assert.ok(first.participantLink.buttons[0].url.includes('/event/{{1}}'));

  const second = ensureEventWhatsappTemplates({ db });
  assert.equal(second.hostPayment.id, first.hostPayment.id);
  assert.equal(second.participantLink.id, first.participantLink.id);
  assert.equal(db.store.message_templates.length, 2);
});

test('isEventWhatsappTemplate and findApprovedEventTemplate', () => {
  const draft = {
    id: 'tpl-event-host-payment',
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
