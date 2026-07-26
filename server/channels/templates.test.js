import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeRemoteTemplates,
  findLocalTemplateMatch,
  preferMetaTemplate,
  mapMetaStatus,
} from './templates.js';

test('preferMetaTemplate keeps APPROVED over PENDING', () => {
  const approved = { id: '1', name: 'hello', status: 'APPROVED' };
  const pending = { id: '2', name: 'hello', status: 'PENDING' };
  assert.equal(preferMetaTemplate(pending, approved).id, '1');
  assert.equal(preferMetaTemplate(approved, pending).id, '1');
});

test('dedupeRemoteTemplates collapses same name+language to best status', () => {
  const remote = [
    { id: 'p', name: 'hello', language: 'he', status: 'PENDING' },
    { id: 'a', name: 'hello', language: 'he', status: 'APPROVED' },
    { id: 'x', name: 'other', language: 'he', status: 'PENDING' },
  ];
  const out = dedupeRemoteTemplates(remote);
  assert.equal(out.length, 2);
  const hello = out.find((t) => t.name === 'hello');
  assert.equal(hello.id, 'a');
  assert.equal(hello.status, 'APPROVED');
});

test('findLocalTemplateMatch prefers meta_id then best status', () => {
  const existing = [
    { id: 'old', meta_name: 'hello', language: 'he', status: 'PENDING', meta_id: '111' },
    { id: 'good', meta_name: 'hello', language: 'he', status: 'APPROVED', meta_id: '222' },
  ];
  assert.equal(
    findLocalTemplateMatch(existing, { id: '111', name: 'hello', language: 'he' }).id,
    'old'
  );
  assert.equal(
    findLocalTemplateMatch(existing, { name: 'hello', language: 'he' }).id,
    'good'
  );
});

test('mapMetaStatus normalizes Meta events', () => {
  assert.equal(mapMetaStatus('APPROVED'), 'APPROVED');
  assert.equal(mapMetaStatus('PENDING'), 'PENDING');
  assert.equal(mapMetaStatus('REJECTED'), 'REJECTED');
  assert.equal(mapMetaStatus('DISABLED'), 'REJECTED');
  assert.equal(mapMetaStatus('PAUSED'), 'PENDING');
});
