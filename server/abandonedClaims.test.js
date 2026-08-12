import test from 'node:test';
import assert from 'node:assert/strict';
import { abandonedClaims, claimIsStale, CLAIM_STALE_MS } from './botReplyClaims.js';

const NOW = new Date('2026-08-12T09:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const store = (rows) => ({ get: () => rows });

test('תור שמת באמצע נספר רק אחרי שחלון ההתיישנות עבר', () => {
  const db = store([
    { id: 'fresh', status: 'sending', phone: '1', claimed_at: ago(60 * 1000) },
    { id: 'stuck', status: 'sending', phone: '2', claimed_at: ago(CLAIM_STALE_MS + 60 * 1000) },
  ]);
  assert.deepEqual(abandonedClaims(db, { now: NOW }).map((r) => r.id), ['stuck']);
});

test('תור שהסתיים אינו נטוש, ומה שכבר דווח אינו חוזר', () => {
  const db = store([
    { id: 'sent', status: 'sent', phone: '1', claimed_at: ago(60 * 60 * 1000) },
    { id: 'told', status: 'sending', phone: '2', claimed_at: ago(60 * 60 * 1000), staff_notified_at: ago(1000) },
    { id: 'silent', status: 'silent', phone: '3', claimed_at: ago(60 * 60 * 1000) },
  ]);
  assert.deepEqual(abandonedClaims(db, { now: NOW }), []);
});

test('תור מלפני יומיים כבר אינו תור לטיפול', () => {
  const db = store([
    { id: 'ancient', status: 'sending', phone: '1', claimed_at: ago(48 * 60 * 60 * 1000) },
  ]);
  assert.deepEqual(abandonedClaims(db, { now: NOW }), []);
});

test('התיישנות היא חמש דקות, והיא מה שמאפשר ניסיון חוזר', () => {
  const at = ago(CLAIM_STALE_MS + 1000);
  assert.equal(claimIsStale({ status: 'sending', claimed_at: at }, NOW.getTime()), true);
  assert.equal(claimIsStale({ status: 'sending', claimed_at: ago(1000) }, NOW.getTime()), false);
  assert.equal(claimIsStale({ status: 'sent', claimed_at: at }, NOW.getTime()), false);
});
