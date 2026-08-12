import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTemplates, isParticipationFormTemplate } from './conversationTemplatePicker.js';

const rows = [
  { id: 'event-1', meta_name: 'event_participant_link_v4', name: 'אירוע · קישור למשתתפים' },
  { id: 'event-2', meta_name: 'event_participant_link_v3', name: 'אירוע · קישור למשתתפים' },
  { id: 'pay', meta_name: 'payment_link', name: 'payment_link' },
  { id: 'legacy', meta_name: 'coustumer_details', name: 'coustumer_details' },
  { id: 'join', meta_name: 'customer_details_v2', name: 'מילוי פרטים · טופס המערכת' },
  { id: 'participation', meta_name: 'participation_form_link', name: 'טופס השתתפות · קישור למילוי' },
];

test('the conversation picker hides workflow, duplicate and legacy templates', () => {
  assert.deepEqual(
    conversationTemplates(rows, { hasStudent: true }).map((template) => template.id),
    ['join', 'participation']
  );
});

test('a student-specific participation form is hidden on a parent-only conversation', () => {
  assert.deepEqual(
    conversationTemplates(rows, { hasStudent: false }).map((template) => template.id),
    ['join']
  );
});

test('archived manual templates stay out of the working picker', () => {
  const templates = conversationTemplates([
    { id: 'join', meta_name: 'customer_details_v2', archived: true },
  ], { hasStudent: true });
  assert.equal(templates.length, 0);
});

test('once the owner picks the list, the flag on the row decides — not the catalog', () => {
  const picked = conversationTemplates([
    { id: 'join', meta_name: 'customer_details_v2', manual_send: false },
    { id: 'hello', meta_name: 'hello', name: 'ברכה', body: 'שלום {{1}}', manual_send: true },
  ], { hasStudent: true });
  assert.deepEqual(picked.map((t) => t.id), ['hello']);
  assert.equal(picked[0].presentation.title, 'ברכה');
});

test('a template the owner added shows its opening line, not an empty description', () => {
  const [picked] = conversationTemplates([
    { id: 'x', meta_name: 'x', name: 'תזכורת', body: '\nשלום {{1}}, נתראה מחר\nפרטים בהמשך', manual_send: true },
  ], { hasStudent: false });
  assert.equal(picked.presentation.description, 'שלום {{1}}, נתראה מחר');
});

test('the participation form is recognised by its stable Meta name', () => {
  assert.equal(isParticipationFormTemplate({ meta_name: 'participation_form_link' }), true);
  assert.equal(isParticipationFormTemplate({ meta_name: 'event_participant_link_v4' }), false);
});
