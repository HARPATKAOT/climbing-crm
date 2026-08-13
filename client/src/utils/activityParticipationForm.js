import { isEventType } from './eventKinds.js';
import { normalizeParticipationScope } from './participationDocuments.js';

/** The legal scopes a participation-form template says it serves. */
export function participationTemplateScopes(template = {}) {
  const raw = Array.isArray(template.activityTypes)
    ? template.activityTypes
    : (Array.isArray(template.activity_types)
      ? template.activity_types
      : [template.activityType || template.activity_type || template.slug]);

  return [...new Set(raw
    .filter(Boolean)
    .map((value) => normalizeParticipationScope(value)))];
}

/** Wall events share one approval; outdoor trips use the trip approval. */
export function participationScopeForEventType(type) {
  return normalizeParticipationScope(isEventType(type) ? 'wall' : type);
}

export function participationTemplateScope(template = {}) {
  return participationTemplateScopes(template)[0] || 'wall';
}

/**
 * Resolve the option the event editor should mark as selected.
 *
 * An id means the team made an explicit choice. Old rows all carried the slug
 * `wall`, even trips, so a slug-only wall value is treated as the historical
 * default and the activity type remains the source of truth.
 */
export function participationTemplateForActivity(activity = {}, templates = []) {
  const active = (templates || []).filter((template) => template?.isActive !== false);
  const byId = activity.form_template_id || activity.formTemplateId;
  if (byId) {
    const explicit = active.find((template) => String(template.id) === String(byId));
    if (explicit) return explicit;
  }

  const rawSlug = String(activity.form_template_slug || activity.formTemplateSlug || '')
    .trim()
    .toLowerCase();
  if (rawSlug && rawSlug !== 'wall') {
    const explicit = active.find((template) => String(template.slug).toLowerCase() === rawSlug);
    if (explicit) return explicit;
  }

  const wantedScope = activity.participation_scope || activity.participationScope
    ? normalizeParticipationScope(activity.participation_scope || activity.participationScope)
    : participationScopeForEventType(activity.type);

  return active.find((template) => participationTemplateScopes(template).includes(wantedScope))
    || active.find((template) => template.isDefault)
    || active[0]
    || null;
}
