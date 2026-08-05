import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterAndSortDocumentRows,
  participationDocumentScope,
  participationScopeValidity,
} from './participationDocuments.js';

test('infers participation scope from durable data before the file name', () => {
  assert.equal(participationDocumentScope({ fileName: 'participation-waiver_wall.pdf' }, { scope: 'trip' }), 'trip');
  assert.equal(participationDocumentScope({ fileName: 'participation-waiver_event_123.pdf' }, null), 'wall');
  assert.equal(participationDocumentScope({}, null), 'wall');
});

test('filters unified document rows and keeps newest first', () => {
  const rows = [
    { id: 'old-health', category: 'health', createdAt: '2026-01-01T10:00:00Z' },
    { id: 'trip', category: 'participation', createdAt: '2026-03-01T10:00:00Z' },
    { id: 'new-health', category: 'health', createdAt: '2026-02-01T10:00:00Z' },
  ];

  assert.deepEqual(
    filterAndSortDocumentRows(rows, 'all').map((row) => row.id),
    ['trip', 'new-health', 'old-health'],
  );
  assert.deepEqual(
    filterAndSortDocumentRows(rows, 'health').map((row) => row.id),
    ['new-health', 'old-health'],
  );
  assert.deepEqual(
    filterAndSortDocumentRows(rows, 'participation').map((row) => row.id),
    ['trip'],
  );
});

test('marks each participation scope valid independently', () => {
  const now = new Date('2026-08-05T10:00:00Z').getTime();
  const status = participationScopeValidity([
    { scope: 'wall', status: 'approved', expires_at: '2027-08-31T20:59:59Z' },
    { scope: 'event', status: 'approved', expires_at: '2026-08-04T20:59:59Z' },
    { scope: 'trip', status: 'pending', expires_at: '2027-08-31T20:59:59Z' },
  ], now);

  assert.deepEqual(status, { wall: true, trip: false });
});
