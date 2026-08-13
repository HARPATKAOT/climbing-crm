import test from 'node:test';
import assert from 'node:assert/strict';
import {
  participationTemplateForActivity,
  participationTemplateScope,
} from './activityParticipationForm.js';

const templates = [
  { id: 'wall-id', slug: 'wall', activityTypes: ['wall'], isDefault: true },
  { id: 'trip-id', slug: 'trip', activityTypes: ['trip'] },
];

test('the event type selects the matching participation form', () => {
  assert.equal(participationTemplateForActivity({ type: 'event' }, templates)?.slug, 'wall');
  assert.equal(participationTemplateForActivity({ type: 'trip' }, templates)?.slug, 'trip');
});

test('an explicit event-level choice wins over the activity type', () => {
  assert.equal(participationTemplateForActivity({
    type: 'event',
    form_template_id: 'trip-id',
  }, templates)?.slug, 'trip');
});

test('the historical wall slug on a trip does not hide the trip form', () => {
  assert.equal(participationTemplateForActivity({
    type: 'trip',
    form_template_slug: 'wall',
  }, templates)?.slug, 'trip');
});

test('the selected template supplies the scope stored on the event', () => {
  assert.equal(participationTemplateScope(templates[1]), 'trip');
});
