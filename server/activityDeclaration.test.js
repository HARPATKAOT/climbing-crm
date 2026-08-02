import test from 'node:test';
import assert from 'node:assert/strict';
import {
  declarationSlugForActivity,
  declarationTemplateForActivity,
  defaultSlugForType,
} from './activityDeclaration.js';

/** The declarations as the health screen stores them: each names its activity. */
const TEMPLATES = [
  { slug: 'wall', activityType: 'wall', isDefault: true },
  { slug: 'event', activityType: 'event' },
  { slug: 'trip', activityType: 'trip' },
];

test('the declaration marked for an activity is the one that activity uses', () => {
  assert.equal(defaultSlugForType('trip', TEMPLATES), 'trip');
  assert.equal(defaultSlugForType('event', TEMPLATES), 'event');
  assert.equal(defaultSlugForType('wall', TEMPLATES), 'wall');
});

test('the three types that preceded the merge behave like an event', () => {
  for (const legacy of ['birthday', 'school', 'company']) {
    assert.equal(defaultSlugForType(legacy, TEMPLATES), 'event', legacy);
  }
});

test('changing which declaration is marked changes what gets signed', () => {
  // The owner points trips at the wall-activity declaration instead, from the
  // health screen. Nothing in the code names slugs, so this just follows.
  const retagged = [
    { slug: 'wall', activityType: 'wall' },
    { slug: 'event', activityType: 'trip' },
  ];
  assert.equal(defaultSlugForType('trip', retagged), 'event');
});

test('a type nobody marked falls through to the default declaration', () => {
  assert.equal(declarationSlugForActivity({ type: 'personal_training' }, TEMPLATES), '');
  assert.equal(declarationSlugForActivity({ type: 'route_building' }, TEMPLATES), '');
  assert.equal(declarationSlugForActivity({}, TEMPLATES), '');
});

test('a declaration that was switched off is not used', () => {
  const off = [{ slug: 'trip', activityType: 'trip', isActive: false }];
  assert.equal(defaultSlugForType('trip', off), '');
});

test('an explicit choice on the event wins over the activity type', () => {
  assert.equal(declarationSlugForActivity({ type: 'trip', form_template_slug: 'event' }, TEMPLATES), 'event');
  assert.equal(declarationSlugForActivity({ type: 'event', form_template_slug: 'trip' }, TEMPLATES), 'trip');
});

test('the stored "wall" is not read as a choice', () => {
  // Every activity has carried form_template_slug: 'wall' since long before
  // anyone could pick one, so honouring it would send a trip to the wall form
  // exactly as before — the bug this is meant to end.
  assert.equal(declarationSlugForActivity({ type: 'trip', form_template_slug: 'wall' }, TEMPLATES), 'trip');
  assert.equal(declarationSlugForActivity({ type: 'other', form_template_slug: 'wall' }, TEMPLATES), 'wall');
});

test('the templates are read from the db and the id is passed through', () => {
  const seen = [];
  const db = { get: (t) => (t === 'form_templates' ? TEMPLATES : []) };
  const resolve = (_db, args) => { seen.push(args); return { slug: args.templateSlug }; };
  declarationTemplateForActivity(db, { type: 'trip', form_template_id: 'ft_x' }, resolve);
  assert.deepEqual(seen[0], { templateId: 'ft_x', templateSlug: 'trip' });
});
