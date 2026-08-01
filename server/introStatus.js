/**
 * Paying for an intro training at the register is the one moment in the journey
 * that the CRM can see by itself, so the trainee's status should move without
 * anyone remembering to change it.
 *
 * The product is recognised by an explicit `is_intro_training` flag when the
 * owner sets one, and otherwise by its name — the wall calls it
 * "אימון היכרות" (also spelled הכירות), and that name is what appears on the
 * pricelist today.
 */

const INTRO_NAME = /היכרות|הכירות/;

/** Stages that already are, or are past, "paid for an intro training". */
const AT_OR_PAST_INTRO_PAID = new Set(['intro_paid', 'registered', 'archived']);

export function isIntroTrainingItem(item) {
  if (!item) return false;
  if (item.is_intro_training === true) return true;
  const haystack = [
    item.name,
    item.description,
    item.category,
    ...(Array.isArray(item.categories) ? item.categories : []),
  ]
    .filter(Boolean)
    .join(' ');
  return INTRO_NAME.test(haystack);
}

export function saleHasIntroTraining(lines = []) {
  return (Array.isArray(lines) ? lines : []).some(
    (line) => isIntroTrainingItem(line?.item) || isIntroTrainingItem(line)
  );
}

/**
 * Should this sale move the trainee to `intro_paid`?
 * Only forward: a registered child who buys an intro for a sibling's friend
 * must not be dragged backwards.
 */
export function shouldMarkIntroPaid(student, lines = []) {
  if (!student?.id) return false;
  if (!saleHasIntroTraining(lines)) return false;
  return !AT_OR_PAST_INTRO_PAID.has(String(student.status || ''));
}
