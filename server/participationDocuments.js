export const PARTICIPATION_SCOPES = Object.freeze({
  WALL: 'wall',
  EVENT: 'event',
  TRIP: 'trip',
});

export const PARTICIPATION_SCOPE_LABELS = Object.freeze({
  wall: 'פעילות בקיר',
  event: 'השתתפות באירוע',
  trip: 'יציאה לטיול הליכה / סנפלינג / טיפוס / מערנות',
});

export const DOCTOR_CLEARANCE_QUESTION_IDS = Object.freeze(['m2', 'm3', 'm4', 'm5', 'm8']);

/** The health declaration is global and identical in every participation flow. */
export const CANONICAL_HEALTH_QUESTIONS = Object.freeze([
  { id: 'm1', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'm2', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיות לב, לחץ דם, סחרחורות או התעלפויות?' },
  { id: 'm3', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש אפילפסיה או אירועי אובדן הכרה?' },
  { id: 'm4', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים, פריקות חוזרות) שמגבילה פעילות מאומצת?' },
  { id: 'm5', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם עברתם ניתוח, אשפוז או פציעה משמעותית בשנה האחרונה?' },
  { id: 'm6', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש נטילת תרופות קבועות?' },
  { id: 'm7', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אלרגיה שהצוות צריך להכיר (מזון, תרופות, עקיצות)?' },
  { id: 'm8', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם רופא הגביל פעילות גופנית בשנה האחרונה?' },
  { id: 'm9', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש מגבלה רפואית, אבחנה או מידע אחר שחשוב שנדע ולא נשאלנו עליו כאן?' },
]);

export function normalizeParticipationScope(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'birthday') return PARTICIPATION_SCOPES.EVENT;
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
  if (['birthday', 'event', 'company', 'school'].includes(kind)) return PARTICIPATION_SCOPES.EVENT;
  return PARTICIPATION_SCOPES.WALL;
}
