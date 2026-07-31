/**
 * "Is this child already on another parent's file?" — asked by every public
 * form once a child's name and date of birth are filled in.
 *
 * The answer only ever offers a link; a failed or slow check must never block a
 * registration, so every error resolves to "no match".
 */
export async function checkKnownChild({ name, birthDate, phone = '' } = {}) {
  const child = String(name || '').trim();
  const born = String(birthDate || '').trim();
  if (!child || !born) return { match: false };
  try {
    const params = new URLSearchParams({ name: child, birthDate: born, phone });
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
 */
export async function checkKnownFamily({ parentName, phone = '' } = {}) {
  const parts = String(parentName || '').trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  if (lastName.length < 2) return { families: [] };
  try {
    const params = new URLSearchParams({ lastName, phone });
    const response = await fetch(`/api/public/family-check?${params.toString()}`);
    if (!response.ok) return { families: [] };
    const body = await response.json();
    return { families: Array.isArray(body?.families) ? body.families : [] };
  } catch {
    return { families: [] };
  }
}

/** The fields a confirmed link adds to a participant before it is submitted. */
export function linkFieldsFor(known) {
  if (!known?.linked) return {};
  return {
    link_student_id: known.student_id,
    reuse_health: !!known.health_valid,
  };
}
