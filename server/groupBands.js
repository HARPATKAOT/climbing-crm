/**
 * Matching a group to an Israeli grade letter. Lives on its own so both the
 * keyword layer (`whatsapp.js`) and the model's tools (`botTools.js`) can use
 * it without importing each other.
 */

function stripWeekdayMarkers(text) {
  return String(text || '')
    .replace(/יום\s*[א-ו]['׳']?/g, ' ')
    // "ב׳+ה׳" means Mon+Thu — not grade ב׳.
    .replace(/[א-ו]['׳']?\s*\+\s*[א-ו]['׳']?/g, ' ');
}

/** Grade token in a band like א'-ב' — not the ב inside בוגרת / בוגרים. */
function gradeBandIncludesLetter(text, letter) {
  const t = String(text || '').replace(/׳/g, "'");
  const asStart = new RegExp(`(?:^|[^א-ת])${letter}'?(?=\\s*[-–]|\\s*$|[^א-ת])`);
  const afterDash = new RegExp(`[-–]\\s*${letter}'?(?=\\s*$|[^א-ת])`);
  return asStart.test(t) || afterDash.test(t);
}

/**
 * True when the group's age band includes this Israeli grade letter (א–ו).
 * Prefer ageCategory (source of truth). Name is only a fallback when category is
 * empty, and weekday markers are stripped so "ב׳+ה׳" never counts as כיתה ב׳.
 */
export function groupMatchesGradeLetter(group, letter) {
  if (!letter) return false;
  const category = String(group?.ageCategory || '').trim();
  if (category) return gradeBandIncludesLetter(category, letter);
  return gradeBandIncludesLetter(stripWeekdayMarkers(group?.name || ''), letter);
}
