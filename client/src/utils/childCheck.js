/**
 * "Is this child already on another parent's file?" — asked by every public
 * form once a child's name and date of birth are filled in.
 *
 * The answer only ever offers a link; a failed or slow check must never block a
 * registration, so every error resolves to "no match".
 */
export async function checkKnownChild({ name, birthDate, idNumber = '', phone = '', templateSlug = '', verificationToken = '' } = {}) {
  const child = String(name || '').trim();
  const born = String(birthDate || '').trim();
  const id = String(idNumber || '').replace(/\D/g, '');
  // An ID identifies the child on its own; otherwise the name and the birth
  // date are only meaningful together.
  if (!id && (!child || !born)) return { match: false };
  try {
    // Which declaration is being filled. Whether the matched child is already
    // covered is only an answer about a particular form.
    const params = new URLSearchParams({ name: child, birthDate: born, idNumber: id, phone });
    if (templateSlug) params.set('templateSlug', templateSlug);
    if (verificationToken) params.set('verificationToken', verificationToken);
    const response = await fetch(`/api/public/child-check?${params.toString()}`);
    if (!response.ok) return { match: false };
    const body = await response.json();
    // Two children share this name and birth date: staff must sort it out, so
    // the form offers nothing rather than guessing which family this is.
    if (body?.ambiguous) return { match: false };
    return body || { match: false };
  } catch {
    return { match: false };
  }
}

/**
 * Families already on file under the same surname — the only thread between
 * two parents of one household who registered different children.
 *
 * The forms ask for the surname in its own field, so it arrives here already
 * separated. Deriving it from the last word of a full name is only a fallback
 * for callers that still pass one, and it is wrong for anyone who writes their
 * family name first.
 */
export async function checkKnownFamily({ parentName, lastName: explicitLast, phone = '', verificationToken = '' } = {}) {
  const parts = String(parentName || '').trim().split(/\s+/).filter(Boolean);
  const lastName = String(explicitLast || '').trim()
    || (parts.length > 1 ? parts[parts.length - 1] : '');
  if (lastName.length < 2) return { families: [] };
  try {
    const params = new URLSearchParams({ lastName, phone });
    if (verificationToken) params.set('verificationToken', verificationToken);
    const response = await fetch(`/api/public/family-check?${params.toString()}`);
    if (!response.ok) return { families: [] };
    const body = await response.json();
    return { families: Array.isArray(body?.families) ? body.families : [] };
  } catch {
    return { families: [] };
  }
}

/**
 * Translate a surname lookup into selection state without inventing consent.
 * In particular, an empty result is not the explicit "new family" sentinel
 * (`''`): the server also returns an empty list for a phone it already knows.
 */
export function familySelectionAfterLookup({
  families = [],
  currentSelection = null,
  answeredForKey = '',
  checkKey = '',
} = {}) {
  if (!Array.isArray(families) || families.length === 0) return null;
  if (answeredForKey !== checkKey) return null;
  return currentSelection;
}

/** A discovered child match is a question, never implicit consent to ignore it. */
export function needsChildAnswer(match) {
  return match?.match === true && match.linked !== true && match.linked !== false;
}

/** The fields a confirmed link adds to a participant before it is submitted. */
export function linkFieldsFor(known) {
  if (!known?.linked) return {};
  return {
    link_student_id: known.student_id,
    reuse_health_document: !!(known.health_document_valid ?? known.health_valid),
    reuse_waiver: !!(known.waiver_valid ?? known.health_valid),
  };
}
