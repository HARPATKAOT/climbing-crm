import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManualDeclaration } from './manualDeclarationSecurity.js';

test('manual declarations discard client-controlled signature and identity metadata', () => {
  const row = normalizeManualDeclaration({
    id: 'attacker-id',
    studentName: '  נועה כהן ',
    signedBy: ' אמא כהן ',
    signed: false,
    signedDate: '1999-01-01',
    signature_url: 'data:image/svg+xml,evil',
    phoneVerification: { token: 'secret' },
    answers: { q1: true, q2: 'yes' },
    notes: 'paper form',
  }, { actor: 'staff@example.com', today: '2026-08-14' });

  assert.equal(row.studentName, 'נועה כהן');
  assert.equal(row.signedBy, 'אמא כהן');
  assert.equal(row.signed, true);
  assert.equal(row.signedDate, '2026-08-14');
  assert.deepEqual(row.answers, { q1: true, q2: false });
  assert.equal(row.source, 'staff_manual');
  assert.equal(row.created_by, 'staff@example.com');
  assert.equal('id' in row, false);
  assert.equal('signature_url' in row, false);
  assert.equal('phoneVerification' in row, false);
});

test('manual declarations require both participant and signer names', () => {
  assert.throws(() => normalizeManualDeclaration({ signedBy: 'הורה' }), /שם המתאמן/);
  assert.throws(() => normalizeManualDeclaration({ studentName: 'ילד' }), /שם החותם/);
});
