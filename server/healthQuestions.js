/**
 * Server-side twin of `client/src/utils/healthQuestions.js`.
 *
 * The two packages do not share a module, so the convention lives in both — and
 * it has to, because the client decides what to render and the server decides
 * what it will accept. If one of them forgets that a screening question may be
 * answered "yes", a child with a condition either cannot register or is
 * recorded as healthy.
 */

export const SCREENING_PREFIX = '?';

/** A screening question is written in the template with a leading "?". */
export function isScreeningQuestion(question) {
  if (!question) return false;
  if (question.kind) return question.kind === 'screen';
  return String(question.label || '').trim().startsWith(SCREENING_PREFIX);
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
