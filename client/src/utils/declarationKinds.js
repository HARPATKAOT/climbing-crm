/**
 * Which activity a signed declaration belongs to.
 *
 * A family can hold two participation scopes: every activity at the wall, and
 * an outdoor trip. They are separate documents covering separate risks.
 *
 * The slug is what the public link carries (/health, /health/trip) and what the
 * declaration records as `templateSlug`. Historical event/birthday slugs are
 * read as wall.
 *
 * The icon is the one the leads list already uses per activity — the same mark
 * has to mean the same declaration wherever it appears, in the list and in the
 * customer file.
 */

import { Footprints, FileText, HeartPulse, Stethoscope, createLucideIcon } from 'lucide-react';

/** A simple front-facing climber on Lucide's 24×24 grid. */
export const WallClimber = createLucideIcon('WallClimber', [
  ['circle', { cx: '12', cy: '5.2', r: '2', key: 'head' }],
  ['path', { d: 'M12 7.7v6.8', key: 'body' }],
  ['path', { d: 'm12 9.4-4-1.8L6 3.8', key: 'left-arm' }],
  ['path', { d: 'm12 9.4 4-1.8 2-3.8', key: 'right-arm' }],
  ['path', { d: 'm12 14.5-3.6 1.2-1.5 4', key: 'left-leg' }],
  ['path', { d: 'm12 14.5 3.4 1.2 1.3 4.8', key: 'right-leg' }],
  ['path', { d: 'M4.2 20.6h2.4', key: 'foothold' }],
]);

const KINDS = {
  wall: { key: 'wall', label: 'פעילות בקיר', Icon: WallClimber, badge: 'badge-amber', color: '#FCD34D' },
  trip: { key: 'trip', label: 'יציאה / טיול', Icon: Footprints, badge: 'badge-cyan', color: '#5EEAD4' },
};

/** הצהרות שנחתמו לפני השינוי נושאות את הכינוי הישן, וצריכות להיקרא נכון. */
const LEGACY_KIND_SLUGS = { birthday: 'wall', event: 'wall' };

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
  const key = String(slug).trim().toLowerCase();
  return KINDS[key] || KINDS[LEGACY_KIND_SLUGS[key]] || DEFAULT_KIND;
}

/**
 * הסוג של תבנית טופס, לפי סוג הפעילות שנבחר לה ואם אין — לפי הקישור.
 * תבנית שאינה אחד הסוגים המוכרים מקבלת את הסוג הכללי, כדי שהמסך יציג את
 * הכותרת שלה במקום להתחזות לטופס הקיר.
 */
export function templateKind(template) {
  const activity = String(template?.activityType || template?.activity_type || '').trim().toLowerCase();
  if (KINDS[activity] || KINDS[LEGACY_KIND_SLUGS[activity]]) {
    return KINDS[activity] || KINDS[LEGACY_KIND_SLUGS[activity]];
  }
  const slug = String(template?.slug || '').trim().toLowerCase();
  return KINDS[slug] || KINDS[LEGACY_KIND_SLUGS[slug]] || GENERIC_KIND;
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

/**
 * Everything that can sit in the customer's approvals folder.
 *
 * A participation approval, a health declaration and a doctor's note are three
 * different papers with three different expiry rules, and the folder lists them
 * side by side. Each one therefore carries its own icon and its own colour, so
 * a line can be told apart without reading it. `title` is the full name on the
 * tag; `label` is the short word used by the filter buttons.
 */
const FILE_KINDS = {
  wall: {
    ...KINDS.wall, title: 'אישור השתתפות — קיר טיפוס', label: 'קיר',
    bg: 'rgba(252,211,77,0.12)', border: 'rgba(252,211,77,0.32)',
  },
  trip: {
    ...KINDS.trip, title: 'אישור השתתפות — טיול', label: 'טיול',
    bg: 'rgba(94,234,212,0.12)', border: 'rgba(94,234,212,0.32)',
  },
  health: {
    key: 'health', title: 'הצהרת בריאות', label: 'בריאות',
    Icon: HeartPulse, badge: 'badge-blue', color: '#7DD3FC',
    bg: 'rgba(125,211,252,0.12)', border: 'rgba(125,211,252,0.32)',
  },
  clearance: {
    key: 'clearance', title: 'אישור רופא', label: 'רופא',
    Icon: Stethoscope, badge: 'badge-purple', color: '#C4B5FD',
    bg: 'rgba(196,181,253,0.12)', border: 'rgba(196,181,253,0.32)',
  },
};

/**
 * The kind of a single line in the approvals folder.
 * @param {{category?: string, scope?: string, clearance?: boolean}} row
 */
export function documentRowKind(row = {}) {
  if (row.clearance) return FILE_KINDS.clearance;
  if (row.category !== 'participation') return FILE_KINDS.health;
  return FILE_KINDS[declarationKind(row.scope).key] || FILE_KINDS.wall;
}

export const DOCUMENT_FILE_KINDS = FILE_KINDS;
