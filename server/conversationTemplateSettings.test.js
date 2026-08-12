import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MANUAL_TEMPLATE_NAMES,
  canSendManually,
  manualSendBlockReason,
  withManualSendFlag,
} from './conversationTemplateSettings.js';

const approved = (extra) => ({ status: 'APPROVED', ...extra });

test('a template whose button holds a personal link can never be sent by hand', () => {
  const eventTemplate = approved({
    meta_name: 'event_host_payment_v4',
    buttons: [{ type: 'URL', url: 'https://api.example.com/eh/{{1}}' }],
  });
  assert.equal(canSendManually(eventTemplate), false);
  assert.match(manualSendBlockReason(eventTemplate), /קישור אישי/);
});

test('the participation form keeps its dynamic button — the send path fills it', () => {
  assert.equal(canSendManually(approved({
    meta_name: 'participation_form_link',
    buttons: [{ type: 'URL', url: 'https://api.example.com/f/{{1}}' }],
  })), true);
});

test('archived and unapproved templates are refused with their own reason', () => {
  assert.match(manualSendBlockReason(approved({ meta_name: 'x', archived: true })), /ארכיון/);
  assert.match(manualSendBlockReason({ meta_name: 'x', status: 'DRAFT' }), /לא מאושרת/);
});

test('a plain approved template is offered once it is on the list', () => {
  const rows = [
    approved({ id: 'a', meta_name: 'hello' }),
    approved({ id: 'b', meta_name: 'customer_details_v2' }),
  ];
  const flagged = withManualSendFlag(rows, ['hello']);
  assert.equal(flagged[0].manual_send, true);
  assert.equal(flagged[1].manual_send, false);
});

test('a name on the list that cannot be sent by hand stays off', () => {
  const [row] = withManualSendFlag(
    [approved({ meta_name: 'payment_link', buttons: [{ url: 'https://x/r/{{1}}' }] })],
    ['payment_link']
  );
  assert.equal(row.manual_send, false);
  assert.ok(row.manual_send_block);
});

test('the shipped default is the pair the composer always offered', () => {
  assert.deepEqual([...DEFAULT_MANUAL_TEMPLATE_NAMES], ['customer_details_v2', 'participation_form_link']);
});
