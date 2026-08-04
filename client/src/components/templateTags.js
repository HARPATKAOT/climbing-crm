/**
 * Coloured chip for a message template's purpose ("הצהרת בריאות", "תשלום"…).
 *
 * Common labels get a fixed colour so the same chip looks the same everywhere;
 * anything else is hashed into the palette, so a new label is instantly
 * distinguishable without anyone maintaining a list.
 */

const PALETTE = [
  { text: '#34D399', bg: 'rgba(52,211,153,0.16)' },   // green
  { text: '#38BDF8', bg: 'rgba(56,189,248,0.16)' },   // blue
  { text: '#FBBF24', bg: 'rgba(251,191,36,0.16)' },   // amber
  { text: '#A78BFA', bg: 'rgba(167,139,250,0.16)' },  // violet
  { text: '#FB7185', bg: 'rgba(251,113,133,0.16)' },  // rose
  { text: '#2DD4BF', bg: 'rgba(45,212,191,0.16)' },   // teal
  { text: '#FB923C', bg: 'rgba(251,146,60,0.16)' },   // orange
];

const FIXED = {
  'הצהרת בריאות': PALETTE[5],
  'טופס השתתפות': PALETTE[5],
  'תשלום': PALETTE[0],
  'הרשמה': PALETTE[6],
  'ציוד': PALETTE[3],
  'אירועים': PALETTE[2],
  'חוגים': PALETTE[1],
  'שיווק': PALETTE[4],
  'מילוי פרטים': PALETTE[1],
};

/** Labels offered in the editor — free text is still allowed. */
export const SUGGESTED_TEMPLATE_TAGS = Object.keys(FIXED);

export function templateTagColor(tag) {
  const label = String(tag || '').trim();
  if (!label) return null;
  if (FIXED[label]) return FIXED[label];
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 100000;
  }
  return PALETTE[hash % PALETTE.length];
}

/** Inline style for the chip — used in screens that share no stylesheet. */
export function templateTagStyle(tag) {
  const color = templateTagColor(tag);
  if (!color) return null;
  return {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
    color: color.text,
    background: color.bg,
    border: `1px solid ${color.text}55`,
  };
}
