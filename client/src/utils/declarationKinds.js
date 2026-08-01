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
 *
 * The icon is the one the leads list already uses per activity — the same mark
 * has to mean the same declaration wherever it appears, in the list and in the
 * customer file.
 */

import { Footprints, Gift, ScrollText, FileText } from 'lucide-react';

const KINDS = {
  wall: { key: 'wall', label: 'קיר טיפוס', Icon: ScrollText, badge: 'badge-amber', color: '#FCD34D' },
  birthday: { key: 'birthday', label: 'יום הולדת', Icon: Gift, badge: 'badge-purple', color: '#C4B5FD' },
  trip: { key: 'trip', label: 'יציאה / טיול', Icon: Footprints, badge: 'badge-cyan', color: '#5EEAD4' },
};

/** טופס נוסף שנבנה בבית ואינו אחד הסוגים המוכרים. */
export const GENERIC_KIND = { key: 'custom', label: 'טופס נוסף', Icon: FileText, badge: 'badge-gray', color: 'var(--text-3)' };

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

/**
 * הסוג של תבנית טופס, לפי סוג הפעילות שנבחר לה ואם אין — לפי הקישור.
 * תבנית שאינה אחד הסוגים המוכרים מקבלת את הסוג הכללי, כדי שהמסך יציג את
 * הכותרת שלה במקום להתחזות לטופס הקיר.
 */
export function templateKind(template) {
  const activity = String(template?.activityType || template?.activity_type || '').trim().toLowerCase();
  if (KINDS[activity]) return KINDS[activity];
  const slug = String(template?.slug || '').trim().toLowerCase();
  return KINDS[slug] || GENERIC_KIND;
}

/**
 * השם הקצר של תבנית לכפתור בחירה. הכותרות המלאות פותחות כולן באותן חמש מילים
 * („הצהרת בריאות ובטיחות + הסרת אחריות — …”), ומה שמבדיל ביניהן הוא הזנב.
 */
export function templateShortLabel(template) {
  const kind = templateKind(template);
  if (kind.key !== GENERIC_KIND.key) return kind.label;
  const title = String(template?.title || '').trim();
  const tail = title.split(/[—–-]/).pop().trim();
  return tail || title || kind.label;
}

/** True when the slug names an activity other than the everyday wall form. */
export function isSpecialActivity(source) {
  return declarationKind(source).key !== DEFAULT_KIND.key;
}

export const DECLARATION_KINDS = KINDS;
