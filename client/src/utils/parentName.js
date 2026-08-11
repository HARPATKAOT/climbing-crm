/**
 * The public forms ask for a first name and a surname separately, because
 * deriving the surname from the last word of a free-text name gets it backwards
 * for everyone who writes their family name first — and that name reaches the
 * household matcher and the invoice, not just the screen.
 *
 * The CRM still stores one readable `name` (first then surname) next to the
 * separate surname, so nothing that only knows about `name` had to change.
 */

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/** First name and surname joined in the order the CRM stores them. */
export function joinParentName(first, lastName) {
  return [clean(first), clean(lastName)].filter(Boolean).join(' ');
}

/**
 * Fill both boxes from a card that may predate the split.
 *
 * A stored surname is trusted as-is; without one, the last word of the full
 * name is the only guess available — the same guess the CRM has always made,
 * kept here so an existing parent is not shown an empty surname field.
 */
export function splitParentName({ name, lastName } = {}) {
  const storedLast = clean(lastName);
  const parts = clean(name).split(' ').filter(Boolean);
  if (storedLast) {
    // Drop the surname from the tail of the full name so re-joining the two
    // fields does not repeat it.
    //
    // Only the last word was compared, so a surname of two words — "שינברג
    // באדר" — never matched and never came off. The first-name box then held
    // the whole name, saving appended the surname again, and the card grew a
    // second copy of it; the edit read as though it had been thrown away.
    // Stripped repeatedly, so a card that already doubled shows correctly and
    // heals itself the next time it is saved.
    const tail = storedLast.split(' ').filter(Boolean);
    while (parts.length > tail.length && parts.slice(-tail.length).join(' ') === storedLast) {
      parts.splice(-tail.length);
    }
    return { first: parts.join(' '), lastName: storedLast };
  }
  if (parts.length > 1) {
    const last = parts.pop();
    return { first: parts.join(' '), lastName: last };
  }
  return { first: parts.join(' '), lastName: '' };
}
