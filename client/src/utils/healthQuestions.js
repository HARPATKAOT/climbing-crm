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

/**
 * Some clauses only exist because a parent is signing for a child — "a child
 * under 11 is not left without an adult". Shown to an adult signing for
 * themselves they are not merely noise: they are a declaration about a child
 * who is not there, ticked by someone it does not apply to.
 *
 * A clause written with a leading "@" is addressed to a parent only.
 */
export const CHILD_ONLY_PREFIX = '@';

/**
 * A screening question where "yes" means a doctor has already had a say —
 * a limitation on physical activity, a recent operation. There the wall is not
 * the one to decide whether climbing is safe, so the form asks for the doctor's
 * written approval instead of taking the answer on trust.
 *
 * Written in the template as "!" together with the "?" that makes it a
 * screening question: "?!האם רופא הגביל פעילות גופנית…".
 */
export const CLEARANCE_PREFIX = '!';

/** Strips the leading markers and reports which were present. */
function parseMarkers(rawLabel) {
  let label = String(rawLabel || '').trim();
  let screening = false;
  let childOnly = false;
  let clearance = false;
  // Any order, so "?!", "!?" and "?@" all read the same.
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

/** The questions answered "yes" that a doctor's approval has to cover. */
export function clearanceTriggers(questions = [], answers = {}) {
  return (questions || []).filter((q) => requiresClearance(q) && answers?.[q.id] === true);
}

/** True when this participant may not sign without a doctor's approval attached. */
export function needsMedicalClearance(questions = [], answers = {}) {
  return clearanceTriggers(questions, answers).length > 0;
}

/**
 * A question that only applies to an adult woman — the pregnancy question.
 *
 * Asked of a child, of a man, or of a girl it is at best noise and at worst
 * offensive, and a form that asks it of everyone teaches people to answer
 * without reading.
 */
export function isAdultFemaleQuestion(question) {
  if (!question) return false;
  return question.audience === 'adult_female';
}

/**
 * Whether this participant is the one the pregnancy question is for: an adult
 * woman. A girl is not asked it either — 18 is the line, and a participant who
 * signs for themselves counts as an adult even without a birth date on file.
 */
export function signsAsAdultFemale(participant) {
  const gender = String(participant?.gender || '').trim().toLowerCase();
  if (!['female', 'f', 'נקבה', 'בת'].includes(gender)) return false;
  if (participant?.type === 'adult' || participant?.isAdult === true) return true;
  const birth = String(participant?.birthDate || participant?.birth_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return false;
  const [year, month, day] = birth.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - year;
  const hadBirthday = (now.getMonth() + 1) > month
    || ((now.getMonth() + 1) === month && now.getDate() >= day);
  if (!hadBirthday) age -= 1;
  return age >= 18;
}


/**
 * The questions that actually apply to this signer.
 *
 * Everything downstream — what is rendered, what counts as unanswered, and what
 * is written into the signed PDF — runs off this one list, so a clause that is
 * not shown can never end up recorded as agreed to.
 */
export function questionsForSigner(questions = [], { isAdultSelf = false, isAdultFemale = false } = {}) {
  return (questions || []).filter((q) => {
    if (isAdultFemaleQuestion(q)) return isAdultFemale;
    return !(isAdultSelf && isChildOnlyQuestion(q));
  });
}

/** The label without the markers that classified it. */
export function questionLabel(question) {
  return parseMarkers(question?.label).label;
}

/**
 * Only an explicit `requireYes` makes a confirmation mandatory.
 *
 * Templates written before this field existed leave it undefined, and the old
 * code read that as optional. Treating it as mandatory would turn their
 * questions — "does the child have asthma?" — into boxes that must be ticked
 * before the form will submit.
 */
export function mustConfirm(question) {
  if (isScreeningQuestion(question)) return false;
  return question?.requireYes === true;
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

/**
 * What to write in the detail box under a question answered "yes".
 *
 * One generic prompt ("מה המצב, ממתי, והאם נקבעה הגבלה") asked the wrong thing
 * of half the questions: the answer to a medication question is a list of
 * medicines, and the answer to an allergy question is what happens on contact.
 * Asking precisely is what makes the detail usable by an instructor.
 */
const DETAIL_PROMPTS = {
  m6: 'אילו תרופות, במה הן מטפלות, והאם יש מגבלה או תופעה שחשוב שנדע',
  m7: 'למה האלרגיה, מה קורה בחשיפה, והאם יש מזרק אפינפרין (אפיפן)',
  m11: 'באיזה שבוע, והאם רופא/ה נתן/ה הנחיה לגבי פעילות גופנית',
};

export function detailPrompt(question) {
  return DETAIL_PROMPTS[String(question?.id || '')] || 'מה המצב, ממתי, והאם נקבעה הגבלה';
}

/** Fresh answers for a participant: confirmations unticked, screening unanswered. */
export function blankAnswers(questions = []) {
  const answers = {};
  (questions || []).forEach((q) => {
    answers[q.id] = isScreeningQuestion(q) ? null : false;
  });
  return answers;
}
