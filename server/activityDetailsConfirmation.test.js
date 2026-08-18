import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETAILS_CONFIRMATION_TEXT,
  activityDetailsSnapshot,
  confirmActivityDetails,
  findDetailsConfirmation,
} from './activityDetailsConfirmation.js';
import { verifySignatureEvidenceEvent } from './signatureEvidence.js';

function createDb() {
  const store = { activity_detail_confirmations: [], signature_evidence: [] };
  return {
    store,
    get: (table) => store[table] || [],
    insert: (table, row) => {
      store[table] ||= [];
      store[table].push(row);
      return row;
    },
    appendOnly: async (table, event) => {
      store[table] ||= [];
      store[table].push(event);
      return { ok: true, record: event };
    },
  };
}

const activity = {
  id: 'trip-1',
  name: 'קלימנוס',
  registration_page_title: 'טיול לקלימנוס - יוון',
  date: '2026-08-24',
  end_date: '2026-08-30',
  registration_page_body: 'תוכנית הטיול: טיסה לקוס, מעבורת, ימי טיפוס.',
  what_to_bring: 'נעלי טיפוס ורתמה',
};

const persist = async () => ({ ok: true });
const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';

test('the snapshot freezes the plan from the activity row, sections included', () => {
  const snapshot = activityDetailsSnapshot(activity);
  assert.equal(snapshot.name, 'טיול לקלימנוס - יוון');
  assert.equal(snapshot.date, '2026-08-24');
  assert.equal(snapshot.endDate, '2026-08-30');
  assert.equal(snapshot.details, 'תוכנית הטיול: טיסה לקוס, מעבורת, ימי טיפוס.');
  assert.deepEqual(snapshot.sections, { what_to_bring: 'נעלי טיפוס ורתמה' });
});

test('confirming writes a sealed row and appends verifiable evidence', async () => {
  const db = createDb();
  const record = await confirmActivityDetails({
    db,
    persist,
    activity,
    parent: { id: 'parent-1', name: 'אמה ורדימון', phone: '0528742802' },
    participantNames: ['אלמה ורדימון'],
    signerName: 'אמה ורדימון',
    signerPhone: '0528742802',
    signature,
    phoneVerification: { verified: true, method: 'whatsapp_code', phone: '0528742802' },
    requestContext: { requestId: 'req-1' },
  });
  assert.match(record.id, /^adc_/);
  assert.equal(record.activity_id, 'trip-1');
  assert.equal(record.parent_id, 'parent-1');
  assert.deepEqual(record.participant_names, ['אלמה ורדימון']);
  assert.equal(record.form_snapshot.confirmationText, DETAILS_CONFIRMATION_TEXT);
  assert.equal(record.form_snapshot.activity.details, activity.registration_page_body);
  assert.equal(record.form_snapshot.evidence.payloadHash.length, 64);
  assert.equal(db.store.activity_detail_confirmations.length, 1);
  assert.equal(db.store.signature_evidence.length, 1);
  const event = db.store.signature_evidence[0];
  assert.equal(event.document_type, 'activity_details_confirmation');
  assert.equal(event.document_id, record.id);
  assert.ok(verifySignatureEvidenceEvent(event));
  // The journal's own copy of what was signed carries the plan text.
  assert.equal(event.payload.signedContent.activity.details, activity.registration_page_body);
});

test('a missing signature or name is refused before anything is written', async () => {
  const db = createDb();
  await assert.rejects(
    () => confirmActivityDetails({ db, persist, activity, signerName: 'אמה', signature: '' }),
    /חסרה חתימה/
  );
  await assert.rejects(
    () => confirmActivityDetails({ db, persist, activity, signerName: '', signature }),
    /חסר שם החותם/
  );
  assert.equal(db.store.activity_detail_confirmations.length, 0);
  assert.equal(db.store.signature_evidence.length, 0);
});

test('a failed durable write refuses instead of keeping a half-saved confirmation', async () => {
  const db = createDb();
  await assert.rejects(
    () => confirmActivityDetails({
      db,
      persist: async () => ({ ok: false }),
      activity,
      signerName: 'אמה',
      signature,
    }),
    /שמירת האישור נכשלה/
  );
  assert.equal(db.store.signature_evidence.length, 0);
});

test('one confirmation per parent — found by card id or by phone', () => {
  const db = createDb();
  db.store.activity_detail_confirmations.push({
    id: 'adc_1', activity_id: 'trip-1', parent_id: 'parent-1', signer_phone: '0528742802', status: 'approved',
  });
  const phonesMatch = (a, b) =>
    String(a).replace(/\D/g, '') === String(b).replace(/\D/g, '');
  assert.ok(findDetailsConfirmation(db, 'trip-1', { parentId: 'parent-1' }));
  assert.ok(findDetailsConfirmation(db, 'trip-1', { phone: '052-874-2802', phonesMatch }));
  assert.equal(findDetailsConfirmation(db, 'trip-2', { parentId: 'parent-1' }), null);
  assert.equal(findDetailsConfirmation(db, 'trip-1', { parentId: 'parent-9' }), null);
});
