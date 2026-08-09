import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLeadEntryScopes,
  matchesLeadSearch,
} from './leadUtils.js';

const parents = [
  { id: 'p-active', name: 'דנה כהן', phone: '0501112222', status: 'lead_new' },
  { id: 'p-archived', name: 'תומר בר-און', phone: '0544593116', status: 'archived' },
];

const students = [
  { id: 's-active', name: 'נועה כהן', parentId: 'p-active', status: 'lead_new' },
  // A recent message may reactivate the trainee while the family card remains archived.
  { id: 's-archived-parent', name: 'תומר בר-און', parentId: 'p-archived', status: 'lead_new' },
];

test('working and archive-inclusive customer scopes stay independent', () => {
  const scopes = buildLeadEntryScopes(students, parents);

  assert.deepEqual(scopes.working.map((entry) => entry.key), ['s-active']);
  assert.deepEqual(
    scopes.archiveInclusive.map((entry) => entry.key),
    ['s-active', 's-archived-parent']
  );
});

test('an archived customer is searchable by name and partial local phone', () => {
  const { archiveInclusive } = buildLeadEntryScopes(students, parents);
  const tomer = archiveInclusive.find((entry) => entry.key === 's-archived-parent');

  assert.equal(matchesLeadSearch(tomer, 'תומר בר-און'), true);
  assert.equal(matchesLeadSearch(tomer, '544593116'), true);
  assert.equal(matchesLeadSearch(tomer, '972544593116'), true);
  assert.equal(matchesLeadSearch(tomer, 'דנה'), false);
});
