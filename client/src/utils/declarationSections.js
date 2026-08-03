/**
 * The three parts of a declaration, each with a heading that says what it is.
 *
 * The parts were already there — medical screening, the undertakings about the
 * activity, and the binding waiver — but only some of them were named, so a
 * signer scrolled from tick boxes into a legal text with nothing marking where
 * one ended and the next began.
 *
 * The waiver names itself: its first line is its own title ("כתב הצהרה, ויתור
 * והסרת אחריות — …"), written per activity by the declaration script. It is
 * lifted out of the body so it can be shown as a heading rather than read as
 * the first sentence of the contract.
 */

/**
 * `{{שם החותם}}` in a template's text becomes the name typed on the form.
 *
 * The clauses were written to name the person taking the risk on themselves,
 * which is the whole point of them. Left unsubstituted — as the activity page
 * did — the signer reads a placeholder instead of their own name.
 */
export function withSignerName(text, signerName = '') {
  const signer = String(signerName || '').trim() || 'החתום/ה מטה';
  return String(text || '').replace(/\{\{\s*(שם החותם|signer)\s*\}\}/g, signer);
}

const CONFIRM_TITLES = {
  trip: 'הבנת אופי הטיול',
  event: 'הבנת אופי הפעילות',
  wall: 'הבנת אופי הפעילות',
};

const WAIVER_FALLBACK_TITLE = 'כתב הצהרה, ויתור והסרת אחריות';

/** Splits the waiver into its own title line and the clauses under it. */
export function splitWaiverText(text) {
  const full = String(text || '').trim();
  if (!full) return { title: WAIVER_FALLBACK_TITLE, body: '' };
  const [first, ...rest] = full.split('\n');
  if (first.trim().startsWith('כתב')) {
    return { title: first.trim(), body: rest.join('\n').trim() };
  }
  return { title: WAIVER_FALLBACK_TITLE, body: full };
}

/** The heading for each part, for one template. */
export function declarationSectionTitles(template) {
  const slug = String(template?.slug || template?.activityType || '').trim();
  return {
    health: 'הצהרת בריאות',
    confirm: CONFIRM_TITLES[slug] || 'הבנת אופי הפעילות',
    waiver: splitWaiverText(template?.waiverText).title,
  };
}
