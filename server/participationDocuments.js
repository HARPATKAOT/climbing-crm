export const PARTICIPATION_SCOPES = Object.freeze({
  WALL: 'wall',
  TRIP: 'trip',
});

export const PARTICIPATION_SCOPE_LABELS = Object.freeze({
  wall: 'פעילות בקיר',
  trip: 'יציאה לטיול הליכה / סנפלינג / טיפוס / מערנות',
});

// m8 asked the second half of m5 — a doctor's limitation in the last year —
// and both demanded the same certificate. It is one question now.
export const DOCTOR_CLEARANCE_QUESTION_IDS = Object.freeze(['m2', 'm3', 'm4', 'm5', 'm11']);

/** The health declaration is global and identical in every participation flow. */
export const CANONICAL_HEALTH_QUESTIONS = Object.freeze([
  { id: 'm1', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'm2', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיות לב, לחץ דם, סחרחורות או התעלפויות?' },
  { id: 'm3', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש אפילפסיה או אירועי אובדן הכרה?' },
  { id: 'm4', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים, פריקות חוזרות) שמגבילה פעילות מאומצת?' },
  { id: 'm5', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם עברתם ניתוח, אשפוז או פציעה משמעותית בשנה האחרונה, או שרופא הגביל פעילות גופנית?' },
  { id: 'm6', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש נטילת תרופות קבועות?' },
  { id: 'm7', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אלרגיה שהצוות צריך להכיר (מזון, תרופות, עקיצות)?' },
  // Asked before the catch-all so m9 stays the last question on the screen.
  // The id skips m10: that number belonged to a claustrophobia question the
  // trip templates carried and the unified migration removed, and reusing it
  // would let an old answer be re-labelled as this one.
  { id: 'm11', kind: 'screen', requireYes: false, audience: 'adult_female', requiresClearance: true, label: 'האם המשתתפת בהריון?' },
  { id: 'm9', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש מגבלה רפואית, אבחנה או מידע אחר שחשוב שנדע ולא נשאלנו עליו כאן?' },
]);

export function normalizeParticipationScope(value) {
  const key = String(value || '').trim().toLowerCase();
  // `event` and its older name `birthday` used to be a separate wall waiver.
  // The risks and rules are now deliberately covered by the single wall scope;
  // keeping these aliases here makes old links, activities and signed records
  // compatible without creating a third document type again.
  if (key === 'event' || key === 'birthday') return PARTICIPATION_SCOPES.WALL;
  return Object.values(PARTICIPATION_SCOPES).includes(key) ? key : PARTICIPATION_SCOPES.WALL;
}

export function scopeForActivity(activity = {}) {
  // The legal domain is an activity property, not the wording template. Older
  // rows carry form_template_slug="wall" as a historical default, so using it
  // here would silently turn trips back into wall permissions.
  const explicit = activity.participation_scope || activity.participationScope || activity.scope;
  if (explicit) return normalizeParticipationScope(explicit);
  const kind = String(activity.type || activity.category || '').trim().toLowerCase();
  if (['trip', 'טיול', 'hike', 'rappelling', 'caving'].includes(kind)) return PARTICIPATION_SCOPES.TRIP;
  return PARTICIPATION_SCOPES.WALL;
}
