import test from 'node:test';
import assert from 'node:assert/strict';
import { secureCheckInRecord } from './checkInSecurity.js';

test('check-in identity and time come from server-owned records', () => {
  const row = secureCheckInRecord({
    student: { id: 's1', name: 'נועה' },
    group: { id: 'g1', name: 'נוער' },
    documents: { ok: true, state: 'valid', label: 'תקין' },
    now: new Date('2026-08-14T09:00:00.000Z'),
  });
  assert.deepEqual(row, {
    climber_id: 's1',
    climber_name: 'נועה',
    group_name: 'נוער',
    timestamp: '2026-08-14T09:00:00.000Z',
    medical_approved: true,
    documents_state: 'valid',
    documents_label: 'תקין',
    source: 'wall_entry',
  });
});

test('check-in refuses an unknown student', () => {
  assert.throws(() => secureCheckInRecord({}), (err) => err.status === 404);
});
