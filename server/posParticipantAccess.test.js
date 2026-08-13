import test from 'node:test';
import assert from 'node:assert/strict';
import { participantPaymentAccess } from './posParticipantAccess.js';

test('a participant from the payer household remains allowed', () => {
  assert.deepEqual(
    participantPaymentAccess({ inPayerHousehold: true, wallEligible: false }),
    { allowed: true, kind: 'household' }
  );
});

test('an unrelated participant is allowed only with valid wall documents', () => {
  assert.deepEqual(
    participantPaymentAccess({ inPayerHousehold: false, wallEligible: true }),
    { allowed: true, kind: 'approved_guest' }
  );
  assert.deepEqual(
    participantPaymentAccess({ inPayerHousehold: false, wallEligible: false }),
    { allowed: false, kind: 'guest_documents_required' }
  );
});
