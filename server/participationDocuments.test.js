import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeParticipationScope,
  scopeForActivity,
} from './participationDocuments.js';

test('only wall and trip are canonical participation scopes', () => {
  assert.equal(normalizeParticipationScope('wall'), 'wall');
  assert.equal(normalizeParticipationScope('trip'), 'trip');
  assert.equal(normalizeParticipationScope('event'), 'wall');
  assert.equal(normalizeParticipationScope('birthday'), 'wall');
});

test('every indoor activity uses wall while field trips remain separate', () => {
  for (const type of ['event', 'birthday', 'school', 'company', 'personal_training', 'class']) {
    assert.equal(scopeForActivity({ type }), 'wall', type);
  }
  assert.equal(scopeForActivity({ type: 'trip' }), 'trip');
  assert.equal(scopeForActivity({ type: 'event', participation_scope: 'event' }), 'wall');
  assert.equal(scopeForActivity({ type: 'event', participation_scope: 'trip' }), 'trip');
});
