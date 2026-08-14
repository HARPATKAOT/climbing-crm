import test from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedStudentEditFields } from './studentUpdateSecurity.js';

test('student customer edits cannot forge health, status or ownership fields', () => {
  assert.deepEqual(unsupportedStudentEditFields({ name: 'A', notes: '', source: 'crm' }), []);
  assert.deepEqual(
    unsupportedStudentEditFields({ healthSignedAt: 'now', waiverSignedAt: 'now', status: 'registered', parentId: 'p2' }),
    ['healthSignedAt', 'waiverSignedAt', 'status', 'parentId']
  );
});
