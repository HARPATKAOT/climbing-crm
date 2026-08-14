import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveGroupPlacement } from './groupPlacement.js';

test('group placement prefers an active hold over membership and waitlists', () => {
  const result = deriveGroupPlacement(
    { groupIds: ['fixed'] },
    {
      hold: { status: 'active', group_ids: ['held'] },
      waitlists: [{ status: 'waiting', group_id: 'waiting' }],
    },
  );
  assert.deepEqual(result, { mode: 'hold', groupIds: ['held'] });
});

test('group placement exposes waitlist groups without treating them as membership', () => {
  const result = deriveGroupPlacement(
    { groupIds: [] },
    { waitlists: [{ status: 'waiting', group_id: 'g1' }, { status: 'removed', group_id: 'g2' }] },
  );
  assert.deepEqual(result, { mode: 'waitlist', groupIds: ['g1'] });
});

test('a fixed placement stays primary when the trainee also waits for another group', () => {
  const result = deriveGroupPlacement(
    { groupIds: ['fixed'] },
    { waitlists: [{ status: 'waiting', group_id: 'waiting' }] },
  );
  assert.deepEqual(result, { mode: 'fixed', groupIds: ['fixed'] });
});
