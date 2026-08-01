/**
 * Server-side twin of `client/src/utils/healthQuestions.js`.
 *
 * The two packages do not share a module, so the convention lives in both — and
 * it has to, because the client decides what to render and the server decides
 * what it will accept. If one of them forgets that a screening question may be
 * answered "yes", a child with a condition either cannot register or is
 * recorded as healthy.
 *
 * A question's line in the template carries its markers up front:
 *   "?"  screening — answered כן/לא, and "yes" never blocks the form
 *   "@"  addressed to a parent only; absent when an adult signs for themselves
 *   "!"  a "yes" here needs a doctor's written approval attached
 */

export const SCREENING_PREFIX = '?';
export const CHILD_ONLY_PREFIX = '@';
export const CLEARANCE_PREFIX = '!';

function parseMarkers(rawLabel) {
  let label = String(rawLabel || '').trim();
  let screening = false;
  let childOnly = false;
  let clearance = false;
  for (;;) {
    if (label.startsWith(SCREENING_PREFIX)) {
      screening = true;
      label = label.slice(SCREENING_PREFIX.length).trim();
    } else if (label.startsWith(CHILD_ONLY_PREFIX)) {
      childOnly = true;
      label = label.slice(CHILD_ONLY_PREFIX.length).trim();
    } else if (label.startsWith(CLEARANCE_PREFIX)) {
      clearance = true;
      label = label.slice(CLEARANCE_PREFIX.length).trim();
    } else break;
  }
  return { label, screening, childOnly, clearance };
}

/** A screening question is written in the template with a leading "?". */
export function isScreeningQuestion(question) {
  if (!question) return false;
  if (question.kind) return question.kind === 'screen';
  return parseMarkers(question.label).screening;
}

/** True for a clause that only makes sense when signing for someone else. */
export function isChildOnlyQuestion(question) {
  if (!question) return false;
  if (question.audience) return question.audience === 'child';
  return parseMarkers(question.label).childOnly;
}

/** True when a "yes" here has to be backed by a doctor's written approval. */
export function requiresClearance(question) {
  if (!question) return false;
  if (typeof question.requiresClearance === 'boolean') return question.requiresClearance;
  return parseMarkers(question.label).clearance;
}

/** The label without the markers that classified it. */
export function questionLabel(question) {
  return parseMarkers(question?.label).label;
}

/**
 * The questions that apply to this signer.
 *
 * The server has to agree with the form about which clauses were shown.
 * Demanding an answer to a parent-only clause from an adult who signed for
 * themselves would reject a submission that is complete.
 */
export function questionsForSigner(questions = [], { isAdultSelf = false } = {}) {
  if (!isAdultSelf) return questions || [];
  return (questions || []).filter((question) => !isChildOnlyQuestion(question));
}

/**
 * Only an explicit `requireYes` makes a confirmation mandatory — the same rule
 * the old `filter(q => q.requireYes)` applied. Templates predating the field
 * leave it undefined, and reading that as mandatory would demand a tick on
 * "does the child have asthma?" before the form could be submitted.
 */
export function mustConfirm(question) {
  if (isScreeningQuestion(question)) return false;
  return question?.requireYes === true;
}

/**
 * Why a participant's declaration is not complete, or '' when it is.
 *
 * A screening question is unanswered until it is true or false. Anything else —
 * `undefined`, `null`, a missing key — is a question nobody was asked, and it
 * must not be filed as "no".
 */
export function declarationGap(questions = [], answers = {}, name = '') {
  const given = answers || {};
  for (const question of questions || []) {
    const answer = given[question.id];
    if (isScreeningQuestion(question)) {
      if (answer !== true && answer !== false) {
        return `יש לענות על כל שאלות הבריאות עבור ${name}`;
      }
      continue;
    }
    if (mustConfirm(question) && answer !== true) {
      return `יש לסמן את כל סעיפי ההצהרה עבור ${name}`;
    }
  }
  return '';
}

/** True when anything was answered "yes, this applies". */
export function hasPositiveScreening(questions = [], answers = {}) {
  return (questions || []).some(
    (question) => isScreeningQuestion(question) && (answers || {})[question.id] === true
  );
}

/** The questions answered "yes" that a doctor's approval has to cover. */
export function clearanceTriggers(questions = [], answers = {}) {
  return (questions || []).filter(
    (question) => requiresClearance(question) && (answers || {})[question.id] === true
  );
}

/** True when this participant may not be filed without a doctor's approval. */
export function needsMedicalClearance(questions = [], answers = {}) {
  return clearanceTriggers(questions, answers).length > 0;
}
