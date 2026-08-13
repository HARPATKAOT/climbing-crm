const DEFAULT_POS_SHORTCUT_NAMES = [
  'כניסה לקיר',
  'השכרת נעליים',
  'ארטיק תמרה',
];

const DEFAULT_POS_SHORTCUT_ORDER = new Map(
  DEFAULT_POS_SHORTCUT_NAMES.map((name, index) => [name, index])
);

function productName(item) {
  return String(item?.name || '').trim();
}

/**
 * Existing catalogues predate the explicit shortcut field. Give the three
 * requested counter products a one-time-compatible default, while an explicit
 * true/false saved from the editor always wins.
 */
export function isPosShortcut(item) {
  if (item?.pos_shortcut !== undefined && item?.pos_shortcut !== null) {
    return item.pos_shortcut === true;
  }
  return DEFAULT_POS_SHORTCUT_ORDER.has(productName(item));
}

/** The requested defaults lead; additional marked products retain catalog order. */
export function comparePosShortcuts(a, b) {
  const aOrder = DEFAULT_POS_SHORTCUT_ORDER.get(productName(a));
  const bOrder = DEFAULT_POS_SHORTCUT_ORDER.get(productName(b));
  if (aOrder !== undefined || bOrder !== undefined) {
    return (aOrder ?? DEFAULT_POS_SHORTCUT_NAMES.length) - (bOrder ?? DEFAULT_POS_SHORTCUT_NAMES.length);
  }
  return 0;
}

export { DEFAULT_POS_SHORTCUT_NAMES };
