/** רמות טיפוס וצבעי הקיר (תגיות מבחן). */

import { Anchor, Mountain } from 'lucide-react';

export const LEVELS = [
  '5A', '5B', '5C',
  '6A', '6B', '6C',
  '7A', '7B', '7C',
  '8A', '8B', '8C',
];

/** צבע לפי סדרת הרמה: 5 כחול · 6 ירוק · 7 כתום · 8 אדום */
export const LEVEL_COLOR = {
  '5A': '#3B82F6', '5B': '#3B82F6', '5C': '#3B82F6',
  '6A': '#16A34A', '6B': '#16A34A', '6C': '#16A34A',
  '7A': '#F97316', '7B': '#F97316', '7C': '#F97316',
  '8A': '#EF4444', '8B': '#EF4444', '8C': '#EF4444',
};

export const LEVEL_POINTS = {
  '5A': 1, '5B': 2, '5C': 3,
  '6A': 4, '6B': 5, '6C': 6,
  '7A': 7, '7B': 8, '7C': 9,
  '8A': 10, '8B': 11, '8C': 12,
};

export function levelColor(grade) {
  return LEVEL_COLOR[grade] || null;
}

export function levelRank(grade) {
  const i = LEVELS.indexOf(grade);
  return i === -1 ? -1 : i;
}

/** סגנון מסלול במבחן רמה — צבע נפרד מצבעי הרמות (5–8) */
export const ROUTE_STYLE = {
  'top-rope': { key: 'top-rope', label: 'טופ רופ', Icon: Anchor,   color: '#38BDF8' },
  lead:       { key: 'lead',     label: 'הובלה',   Icon: Mountain, color: '#C084FC' },
};

export function routeStyleMeta(style) {
  if (style === 'top_rope' || style === 'top-rope') return ROUTE_STYLE['top-rope'];
  if (style === 'lead') return ROUTE_STYLE.lead;
  return null;
}
