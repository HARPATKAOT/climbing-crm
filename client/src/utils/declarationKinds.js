/**
 * Which activity a signed declaration belongs to.
 *
 * A family can hold several: the wall for the weekly class, a birthday party,
 * an outdoor trip. They are separate documents covering separate risks, and in
 * the personal file they must not read as one repeated line — a staff member
 * looking for "did they sign for the trip" needs to see the answer, not count
 * identical rows.
 *
 * The slug is what the public link carries (/health, /health/birthday,
 * /health/trip) and what the declaration records as `templateSlug`.
 */

const KINDS = {
  wall: { key: 'wall', label: 'קיר טיפוס', badge: 'badge-amber' },
  birthday: { key: 'birthday', label: 'יום הולדת', badge: 'badge-purple' },
  trip: { key: 'trip', label: 'יציאה / טיול', badge: 'badge-cyan' },
};

/** An unrecognised or missing slug reads as the wall — the default form. */
export const DEFAULT_KIND = KINDS.wall;

/**
 * @param {string|object} source a slug, or anything carrying `templateSlug`
 *        (a declaration, or a document row that was resolved to one)
 */
export function declarationKind(source) {
  const slug = typeof source === 'string'
    ? source
    : String(source?.templateSlug || source?.template_slug || '');
  return KINDS[String(slug).trim().toLowerCase()] || DEFAULT_KIND;
}

/** True when the slug names an activity other than the everyday wall form. */
export function isSpecialActivity(source) {
  return declarationKind(source).key !== DEFAULT_KIND.key;
}

export const DECLARATION_KINDS = KINDS;
