import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAiSuggestionApprovalAccess } from './aiApprovalSecurity.js';

const paidActivity = { id: 'a1', registration_mode: 'paid_per_participant', price: 100 };

function staff(modules = {}, sensitive = {}) {
  return { role: 'staff', modules, sensitive };
}

test('AI approvals re-check the permission of the mutated business object', () => {
  assert.doesNotThrow(() => assertAiSuggestionApprovalAccess(
    staff({ assistant: 'edit' }),
    { type: 'create_task', args: {} }
  ));
  assert.throws(
    () => assertAiSuggestionApprovalAccess(
      staff({ assistant: 'edit' }),
      { type: 'add_customer_note', args: { parent_id: 'p1' } }
    ),
    (err) => err.status === 403 && /עריכת לקוחות/.test(err.message)
  );
  assert.doesNotThrow(() => assertAiSuggestionApprovalAccess(
    staff({ assistant: 'edit', customers: 'edit' }),
    { type: 'add_customer_note', args: { parent_id: 'p1' } }
  ));
  assert.throws(
    () => assertAiSuggestionApprovalAccess(
      staff({ assistant: 'edit' }),
      { type: 'add_activity_interest', args: { activity_id: 'a1' } }
    ),
    (err) => err.status === 403 && /עריכת נרשמים/.test(err.message)
  );
});

test('AI cannot mark an activity registration paid without finance access', () => {
  const registrationEditor = staff({ assistant: 'edit', activity_registrations: 'edit' });
  assert.doesNotThrow(() => assertAiSuggestionApprovalAccess(
    registrationEditor,
    { type: 'register_to_activity', args: { activity_id: 'a1', payment_status: 'pending' } },
    paidActivity
  ));
  assert.doesNotThrow(() => assertAiSuggestionApprovalAccess(
    registrationEditor,
    { type: 'register_to_activity', args: { activity_id: 'a1' } },
    paidActivity
  ));
  assert.throws(
    () => assertAiSuggestionApprovalAccess(
      registrationEditor,
      { type: 'register_to_activity', args: { activity_id: 'a1', payment_status: 'paid' } },
      paidActivity
    ),
    (err) => err.status === 403 && /הרשאת כספים/.test(err.message)
  );
  assert.doesNotThrow(() => assertAiSuggestionApprovalAccess(
    staff(
      { assistant: 'edit', activity_registrations: 'edit' },
      { finance: true }
    ),
    { type: 'register_to_activity', args: { activity_id: 'a1', payment_status: 'paid' } },
    paidActivity
  ));
});

test('owners retain approval access across modules', () => {
  assert.doesNotThrow(() => assertAiSuggestionApprovalAccess(
    { role: 'owner' },
    { type: 'register_to_activity', args: { payment_status: 'paid' } },
    paidActivity
  ));
});
