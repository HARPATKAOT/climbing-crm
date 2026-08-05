import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  createSignatureEvidenceEvent,
  evidenceReference,
  sha256,
  verifySignatureEvidenceEvent,
} from './signatureEvidence.js';

test('canonical JSON and hashes do not depend on key order', () => {
  assert.equal(canonicalJson({ b: 2, a: { z: 1, y: 0 } }), canonicalJson({ a: { y: 0, z: 1 }, b: 2 }));
  assert.equal(sha256(canonicalJson({ b: 2, a: 1 })), sha256(canonicalJson({ a: 1, b: 2 })));
});

test('signature evidence contains a sealed content and signature reference', () => {
  const event = createSignatureEvidenceEvent({
    documentType: 'health', documentId: 'hd1',
    signer: { parentId: 'p1', name: 'דלק איל' },
    participant: { studentId: 's1', name: 'דלק איל' },
    contentSnapshot: { answers: { m1: false } },
    signature: 'data:image/png;base64,abc',
  });
  assert.match(event.payload_hash, /^[a-f0-9]{64}$/);
  assert.match(event.seal, /^[a-f0-9]{64}$/);
  assert.match(event.payload.signatureHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(event.payload.signedContent, { answers: { m1: false } });
  assert.equal(event.payload.signatureArtifact, 'data:image/png;base64,abc');
  assert.equal(event.payload.schemaVersion, 2);
  assert.equal(evidenceReference(event).id, event.id);
  assert.equal(verifySignatureEvidenceEvent(event), true);
  assert.equal(verifySignatureEvidenceEvent({
    ...event, payload: { ...event.payload, occurredAt: 'tampered' },
  }), false);
});
