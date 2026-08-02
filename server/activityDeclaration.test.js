import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declarationSlugForActivity,
  declarationTemplateForActivity,
} from './activityDeclaration.js';

test('a trip signs the trip declaration', () => {
  assert.equal(declarationSlugForActivity({ type: 'trip' }), 'trip');
});

test('an event signs the wall-activity declaration', () => {
  assert.equal(declarationSlugForActivity({ type: 'event' }), 'event');
});

test('the three types that preceded the merge behave like an event', () => {
  for (const legacy of ['birthday', 'school', 'company']) {
    assert.equal(declarationSlugForActivity({ type: legacy }), 'event', legacy);
  }
});

test('anything else falls through to the default declaration', () => {
  assert.equal(declarationSlugForActivity({ type: 'personal_training' }), '');
  assert.equal(declarationSlugForActivity({ type: 'route_building' }), '');
  assert.equal(declarationSlugForActivity({}), '');
});

test('an explicit choice on the event wins over its type', () => {
  assert.equal(declarationSlugForActivity({ type: 'trip', form_template_slug: 'event' }), 'event');
  assert.equal(declarationSlugForActivity({ type: 'event', form_template_slug: 'trip' }), 'trip');
});

test('the stored "wall" is not read as a choice', () => {
  // Every activity has carried form_template_slug: 'wall' since long before
  // anyone could pick one, so honouring it would send a trip to the wall form
  // exactly as before — the bug this is meant to end.
  assert.equal(declarationSlugForActivity({ type: 'trip', form_template_slug: 'wall' }), 'trip');
  // With no type to go on it still means the default, which is the wall.
  assert.equal(declarationSlugForActivity({ type: 'other', form_template_slug: 'wall' }), 'wall');
});

test('an id on the event is passed through to the resolver', () => {
  const seen = [];
  const resolve = (_db, args) => { seen.push(args); return { slug: args.templateSlug }; };
  declarationTemplateForActivity({}, { type: 'trip', form_template_id: 'ft_x' }, resolve);
  assert.deepEqual(seen[0], { templateId: 'ft_x', templateSlug: 'trip' });
});
