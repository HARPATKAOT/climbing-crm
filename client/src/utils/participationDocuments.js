export const PARTICIPATION_SCOPE_LABELS = Object.freeze({
  wall: 'פעילות בקיר',
  trip: 'יציאה לטיול הליכה / סנפלינג / טיפוס / מערנות',
});

export const CANONICAL_HEALTH_QUESTIONS = Object.freeze([
  { id: 'm1', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אסתמה, קוצר נשימה או מחלת ריאות?' },
  { id: 'm2', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיות לב, לחץ דם, סחרחורות או התעלפויות?' },
  { id: 'm3', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש אפילפסיה או אירועי אובדן הכרה?' },
  { id: 'm4', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם יש בעיה אורתופדית (גב, פרקים, שברים, פריקות חוזרות) שמגבילה פעילות מאומצת?' },
  { id: 'm5', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: true, label: 'האם עברתם ניתוח, אשפוז או פציעה משמעותית בשנה האחרונה, או שרופא הגביל פעילות גופנית?' },
  { id: 'm6', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש נטילת תרופות קבועות?' },
  { id: 'm7', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש אלרגיה שהצוות צריך להכיר (מזון, תרופות, עקיצות)?' },
  // Mirrors server/participationDocuments.js — including the skipped m10, which
  // belonged to a question the unified-waiver migration removed.
  { id: 'm11', kind: 'screen', requireYes: false, audience: 'adult_female', requiresClearance: true, label: 'האם המשתתפת בהריון?' },
  { id: 'm9', kind: 'screen', requireYes: false, audience: 'all', requiresClearance: false, label: 'האם יש מגבלה רפואית, אבחנה או מידע אחר שחשוב שנדע ולא נשאלנו עליו כאן?' },
]);

const PARTICIPATION_SCOPES = ['wall', 'trip'];

export function normalizeParticipationScope(value) {
  const scope = String(value || '').trim().toLowerCase();
  if (scope === 'event' || scope === 'birthday') return 'wall';
  return PARTICIPATION_SCOPES.includes(scope) ? scope : 'wall';
}

export function participationDocumentScope(doc, waiver) {
  const explicit = String(waiver?.scope || doc?.scope || '').trim().toLowerCase();
  if (explicit) return normalizeParticipationScope(explicit);

  const match = String(doc?.fileName || '').match(/participation-waiver_(wall|event|trip)/i);
  return normalizeParticipationScope(match?.[1]);
}

export function filterAndSortDocumentRows(rows, filter = 'all') {
  return [...rows]
    .filter((row) => {
      if (filter === 'all') return true;
      if (filter === 'health' || filter === 'participation') return row.category === filter;
      if (filter.startsWith('participation:')) {
        return row.category === 'participation' && row.scope === filter.split(':')[1];
      }
      return true;
    })
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

export function participationScopeValidity(waivers, now = Date.now()) {
  const result = { wall: false, trip: false };

  for (const waiver of waivers || []) {
    if (waiver?.status && waiver.status !== 'approved') continue;
    const scope = participationDocumentScope(null, waiver);
    const expiry = new Date(waiver?.expires_at || waiver?.expiresAt || 0);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() >= now) {
      result[scope] = true;
    }
  }

  return result;
}
