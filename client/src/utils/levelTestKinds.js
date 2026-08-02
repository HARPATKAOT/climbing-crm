/** סוגי מבחן (רמה / אבטחה / הובלה) — תוויות, צבעים ואייקונים משותפים. */

import { Award, Mountain, Shield } from 'lucide-react';

export const TEST_KIND = {
  level: {
    key: 'level',
    label: 'מבחן רמה',
    shortLabel: 'רמה',
    Icon: Award,
    accent: '#38BDF8',
    bg: 'rgba(56,189,248,0.10)',
    border: 'rgba(56,189,248,0.28)',
  },
  security: {
    key: 'security',
    label: 'מבחן אבטחה',
    shortLabel: 'בטיחות',
    Icon: Shield,
    accent: '#FBBF24',
    bg: 'rgba(251,191,36,0.10)',
    border: 'rgba(251,191,36,0.28)',
  },
  lead: {
    key: 'lead',
    label: 'מבחן הובלה',
    shortLabel: 'הובלה',
    Icon: Mountain,
    accent: '#A78BFA',
    bg: 'rgba(167,139,250,0.12)',
    border: 'rgba(167,139,250,0.32)',
  },
};

export const TEST_KINDS = [TEST_KIND.level, TEST_KIND.security, TEST_KIND.lead];

/** תואם ל־TEST_TYPE_COLORS הישן בקבצי הממשק */
export const TEST_TYPE_COLORS = {
  level: {
    accent: TEST_KIND.level.accent,
    bg: TEST_KIND.level.bg,
    border: TEST_KIND.level.border,
  },
  security: {
    accent: TEST_KIND.security.accent,
    bg: TEST_KIND.security.bg,
    border: TEST_KIND.security.border,
  },
  lead: {
    accent: TEST_KIND.lead.accent,
    bg: TEST_KIND.lead.bg,
    border: TEST_KIND.lead.border,
  },
};

export function normalizeTestKindKey(testType) {
  if (testType === 'security') return 'security';
  if (testType === 'lead') return 'lead';
  if (testType === 'top-rope' || testType === 'top_rope') return 'level';
  return 'level';
}

export function testKindMeta(testType) {
  return TEST_KIND[normalizeTestKindKey(testType)] || TEST_KIND.level;
}
