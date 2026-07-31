/**
 * A declaration form asks two different kinds of question, and answering them
 * with the same checkbox loses the difference.
 *
 * A **confirmation** is something the signer must agree to — "I will follow the
 * instructors". Not ticking it means the form is not finished.
 *
 * A **screening** question asks whether a medical condition exists. "Yes" is a
 * legitimate answer that has to be recordable: a child with asthma must be able
 * to register, and the instructor has to know. Rendered as a tick box it is
 * unusable either way — a required tick blocks the very people it is asking
 * about, and an optional one cannot tell "no" apart from "did not read".
 */

export const SCREENING_PREFIX = '?';

/** A screening question is written in the template with a leading "?". */
export function isScreeningQuestion(question) {
  if (!question) return false;
  if (question.kind) return question.kind === 'screen';
  return String(question.label || '').trim().startsWith(SCREENING_PREFIX);
}

/** The label without the marker that classified it. */
export function questionLabel(question) {
  const raw = String(question?.label || '').trim();
  if (!question?.kind && raw.startsWith(SCREENING_PREFIX)) {
    return raw.slice(SCREENING_PREFIX.length).trim();
  }
  return raw;
}

/** Confirmations default to mandatory; screening questions are never "tick to pass". */
export function mustConfirm(question) {
  if (isScreeningQuestion(question)) return false;
  return question?.requireYes !== false;
}

/**
 * Which questions still have no answer.
 *
 * Confirmations count as missing until ticked. Screening questions count as
 * missing until answered either way — `null` is "not asked yet", and a medical
 * question left blank is exactly what must not reach an instructor as "no".
 */
export function unansweredQuestions(questions = [], answers = {}) {
  return (questions || []).filter((q) => {
    const answer = answers?.[q.id];
    if (isScreeningQuestion(q)) return answer !== true && answer !== false;
    return mustConfirm(q) && answer !== true;
  });
}

/** True when anything was answered "yes, this applies" and needs describing. */
export function hasPositiveScreening(questions = [], answers = {}) {
  return (questions || []).some((q) => isScreeningQuestion(q) && answers?.[q.id] === true);
}

/** Fresh answers for a participant: confirmations unticked, screening unanswered. */
export function blankAnswers(questions = []) {
  const answers = {};
  (questions || []).forEach((q) => {
    answers[q.id] = isScreeningQuestion(q) ? null : false;
  });
  return answers;
}
