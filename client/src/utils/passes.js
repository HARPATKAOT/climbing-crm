/**
 * Display text for a pass (מנוי / כרטיסייה).
 *
 * The status field holds raw English values written by the server
 * (`active` / `depleted` / `expired` / `void` — the last one set when the sale
 * behind the pass is credited). Screens must never print those as-is.
 */

export function passStatusLabel(pass) {
  const isPunch = pass?.pass_type === 'punch_card';
  switch (String(pass?.status || '')) {
    case 'active':
      return 'פעיל';
    case 'depleted':
      return isPunch ? 'נגמרו הכניסות' : 'נגמר';
    case 'expired':
      return 'פג תוקף';
    case 'void':
      return isPunch ? 'בוטלה בזיכוי' : 'בוטל בזיכוי';
    default:
      return pass?.status ? 'לא פעיל' : '';
  }
}

/** `בתוקף עד 29.07.2027`, or an explicit note when nothing limits the pass. */
export function passValidityText(pass) {
  const [year, month, day] = String(pass?.valid_until || '').split('-');
  if (!year || !month || !day) return 'בלי תאריך תפוגה';
  return `בתוקף עד ${day}.${month}.${year}`;
}

/**
 * `נקנתה ב-28.7.2026, 21:35` — when the pass was issued into the file.
 * Falls back to the validity start for rows saved before `created_at` existed.
 */
export function passPurchasedText(pass) {
  const raw = String(pass?.created_at || pass?.valid_from || '');
  if (!raw) return '';
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return '';
  const verb = pass?.pass_type === 'punch_card' ? 'נקנתה' : 'נקנה';
  const stamp = raw.includes('T') ? when.toLocaleString('he-IL') : when.toLocaleDateString('he-IL');
  return `${verb} ב-${stamp}`;
}

/**
 * One line under the pass name. The expiry date is shown while it still means
 * something — on a cancelled or used-up pass the status is the whole story.
 */
export function passSubtitle(pass) {
  const parts = [
    pass?.pass_type === 'punch_card' ? 'כרטיסייה' : 'מנוי',
    passStatusLabel(pass),
  ];
  if (String(pass?.status || '') === 'active') parts.push(passValidityText(pass));
  return parts.filter(Boolean).join(' · ');
}
