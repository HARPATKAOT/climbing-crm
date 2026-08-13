import crypto from 'crypto';
import {
  declarationSignedAt,
  healthExpiryDate,
  isHealthDeclarationValid,
  participationWaiverExpiryDate,
} from './healthValidity.js';
import {
  linkGuardian,
  linkHouseholdGuardians,
  guardianParentIds,
  expandHousehold,
  mergeFamily,
  normalizedIdNumber,
} from './studentGuardians.js';
import {
  declarationGap,
  isScreeningQuestion,
  needsMedicalClearance,
  questionsForSigner,
  signsAsAdultFemale,
} from './healthQuestions.js';
import { CANONICAL_HEALTH_QUESTIONS, normalizeParticipationScope } from './participationDocuments.js';
import { healthDocumentState, waiverDocumentState } from './participationEligibility.js';
import { addPendingSpouse, ensureHouseholdForParent } from './households.js';
import {
  appendSignatureEvidence,
  createSignatureEvidenceEvent,
  evidenceReference,
} from './signatureEvidence.js';

// The safety rules are not repeated here: they are the items ticked one by one
// on the declaration step, which is both better evidence and one list instead
// of two. Kept in step with the templates in the live database.
export const STANDARD_WAIVER_TEXT = `אני מצהיר/ה כי אני מודע/ת לסיכונים הכרוכים בפעילות המתקיימת ב"הרפתקאות (קיר בועז)", אני פוטר/ת את "הרפתקאות (קיר בועז)" ו/או מי מטעמו מכל אחריות לפגיעה אם תקרה למשתתף אותו אני רושם לפעילות, למעט אחריות המוטלת לפי דין בשל רשלנות של "הרפתקאות" או של מי שפעל מטעמה.

אני הח"מ מתחייב/ת בזאת למלא את כל הוראות הבטיחות שסימנתי בשלב הקודם.

אני מאשר/ת כי מסמך זה הוא חוזה מחייב לכל דבר ועניין, כי קראתי אותו והבנתי את תוכנו, וכי אני חותם/ת עליו מרצוני החופשי.`;

export const STANDARD_HEALTH_QUESTIONS = [
  {
    id: 'h1',
    requireYes: true,
    label: 'אני החתום/ה מטה מצהיר/ה בזאת שאני או האדם אותו אני רושם לחוג הטיפוס בריא/ה וכשיר/ה פיזית, נפשית וקוגניטיבית להשתתף בפעילות המתקיימת ב"הרפתקאות (קיר בועז)". אני מבין כי הפעילות עלולה להיות מסוכנת ולא ידוע לי על מגבלות שעלולות למנוע מהמשתתף פעילות בטוחה ובריאה.',
  },
  { id: 's1', requireYes: true, label: 'אין להשאיר ילד עד גיל 11 ללא ליווי מבוגר שלא במסגרת חוג מסודר' },
  { id: 's2', requireYes: true, label: 'נא להימנע מריצה והשתוללות בכל מתחם הקיר' },
  { id: 's3', requireYes: true, label: 'יש להישמע להוראות המדריכים' },
  { id: 's4', requireYes: true, label: 'הטיפוס יתאפשר רק לאחר קבלת תדריך בטיחות מלא ומעבר מבחן בטיחות בפני מדריך מטעם הקיר.' },
  { id: 's5', requireYes: true, label: 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך' },
];

export const HEALTH_DECLARATION_CONFIRMATION =
  'אני מאשר/ת שהמידע שמסרתי בהצהרת הבריאות מלא, נכון ומעודכן, ומתחייב/ת לעדכן את הצוות בכל שינוי במצב הבריאותי.';

function clean(value) {
  return String(value || '').trim();
}

function normalizedName(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('he');
}

/**
 * Forms sometimes include the family name although the imported card stores
 * only the given names (or the opposite). With an exact birth date and the
 * same household, that suffix difference must update the existing trainee,
 * not create a second child. Ambiguous candidates are intentionally ignored.
 */
export function sameHouseholdParticipantCandidate(db, parentId, input = {}, participantType = 'child') {
  const birthDate = clean(input.birthDate);
  const wanted = normalizedName(input.name);
  if (!birthDate || !wanted) return null;
  const candidates = (db.get('students') || []).filter((student) => {
    if (participantType === 'adult' ? student.isAdult !== true : student.isAdult === true) return false;
    if (String(student.birthDate || '').trim() !== birthDate) return false;
    const belongs = String(student.parentId || '') === String(parentId)
      || guardianParentIds(db, student).includes(parentId);
    if (!belongs) return false;
    const existing = normalizedName(student.name);
    return existing === wanted || existing.startsWith(wanted) || wanted.startsWith(existing);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function wantsReuse(participant) {
  return participant?.reuse_health === true
    || participant?.reuseHealth === true
    || participant?.reuse_declaration === true;
}

function wantsHealthReuse(participant) {
  if (participant?.reuse_health_document !== undefined) return participant.reuse_health_document === true;
  return wantsReuse(participant);
}

function wantsWaiverReuse(participant) {
  if (participant?.reuse_waiver !== undefined) return participant.reuse_waiver === true;
  return wantsReuse(participant);
}

const FORM_STATUS_PRESERVE = new Set([
  'registered',
  'active',
  'pending_signup',
  'details_completed',
  'awaiting_parent_confirmation',
  'awaiting_centre_confirmation',
  'waitlist',
  'intro_scheduled',
  'intro_paid',
  'past_registered',
]);

/** Signing documents must never move a participant backwards in the journey. */
export function statusAfterHealthSignature(previousStatus) {
  const status = String(previousStatus || '').trim();
  return FORM_STATUS_PRESERVE.has(status) ? status : 'details_completed';
}

/** Always the active default health template — used by public activity registration. */
export function resolveDefaultDeclarationTemplate(db) {
  return resolveDeclarationTemplate(db, {});
}

const TRIP_WAIVER_QUESTION_LABELS = Object.freeze({
  s4: 'כל אחת מהפעילויות טיפוס / סנפלינג / כניסה למערה תתאפשר רק למי שקיבל/ה תדריך מסודר ורק בהשגחת מדריך',
  s6: 'אם הפעילות כוללת כניסה למערה, חובה לחבוש קסדה ולהשתמש בתאורה, ואין להיכנס, להתפצל או לצאת ללא הוראת מדריך',
  s7: 'יש להצטייד במים בכמות מתאימה ולדווח מיד על תשישות, סחרחורת, קוצר נשימה או תחושה לא טובה',
});

function normalizeTripWaiverText(text) {
  return String(text || '')
    .replace(
      'היציאה כוללת פעילות אתגרית בשטח — גלישה על חבל (סנפלינג), טיפוס, מערנות (פעילות במערות) והליכה בשטח פתוח —',
      'היציאה כוללת פעילות אתגרית בשטח — טיפוס / סנפלינג / מערנות, בהתאם לפעילות שנבחרה —'
    )
    .replace(
      'ידוע לי כי פעילות במערה מוסיפה סיכונים משלה:',
      'אם הפעילות כוללת כניסה למערה, ידוע לי כי היא מוסיפה סיכונים משלה:'
    );
}

function normalizeLiabilityPartyText(text) {
  return String(text || '')
    .replace(
      '6. הוויתור שבסעיף 5 לא יחול, ואחריות המקום תעמוד בעינה, אך ורק במקרים בהם תוכח מעל לכל ספק רשלנות של המקום.',
      '6. אין בוויתור שבסעיף 5 כדי לגרוע מאחריות "הרפתקאות" לפי דין, לרבות בשל רשלנות של "הרפתקאות" או של מי שפעל מטעמה.'
    )
    .replace(
      'וזאת אלא אם יוכח כי הינה תוצאה של רשלנות המקום.',
      'למעט אחריות המוטלת לפי דין בשל רשלנות של "הרפתקאות" או של מי שפעל מטעמה.'
    );
}

/**
 * `[[…]]` marks the part of a waiver that only applies when a minor is being
 * signed for. An adult signing for themselves must not read a clause about
 * children who are not on the document.
 */
export function waiverTextForSigner(text, hasMinors) {
  const full = String(text || '');
  if (hasMinors) return full.replace(/\[\[([\s\S]*?)\]\]/g, '$1');
  return full
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    // A dropped fragment leaves the punctuation that framed it, and a dropped
    // whole clause leaves the blank line it sat on.
    .replace(/[ \t]+([,.])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function resolveDeclarationTemplate(db, { templateId, templateSlug } = {}) {
  const templates = db.get('form_templates') || [];
  const idCandidate = templateId
    ? templates.find((item) => String(item.id) === String(templateId))
    : null;
  const requestedScope = normalizeParticipationScope(
    idCandidate?.slug || templateSlug || 'wall'
  );
  const selected =
    (idCandidate
      && !['event', 'birthday'].includes(String(idCandidate.slug || '').toLowerCase())
      && idCandidate.isActive !== false
      ? idCandidate
      : null) ||
    templates.find((item) => normalizeParticipationScope(item.slug) === requestedScope
      && item.slug === requestedScope
      && item.isActive !== false) ||
    templates.find((item) => item.isDefault && item.isActive !== false) ||
    templates.find((item) => item.slug === 'wall' && item.isActive !== false);
  const selectedSlug = normalizeParticipationScope(selected?.slug || requestedScope);
  const medicalQuestions = CANONICAL_HEALTH_QUESTIONS.map((question) => ({ ...question }));
  // Old activity templates stored medical screening and scoped safety clauses
  // in one array. Health is now global, so every legacy screening question is
  // replaced with the canonical m1-m9 set (including removal of old m10), while
  // the activity-specific confirmations remain part of the waiver.
  const waiverQuestions = (selected?.healthQuestions || [])
    .filter((question) => {
      // This age/accompaniment notice is an operational rule, not a consent
      // the parent needs to grant as part of every trip declaration.
      if (selectedSlug === 'trip' && String(question?.id || '').toLowerCase() === 's1') return false;
      if (isScreeningQuestion(question)) return false;
      if (/^m\d+$/i.test(String(question?.id || ''))) return false;
      const label = String(question?.label || '').trim();
      if (/^q\d+$/i.test(String(question?.id || '')) && /^האם\b/.test(label)) return false;
      return true;
    })
    .map((question) => {
      const questionId = String(question?.id || '').toLowerCase();
      if (selectedSlug === 'trip' && TRIP_WAIVER_QUESTION_LABELS[questionId]) {
        return {
          ...question,
          label: TRIP_WAIVER_QUESTION_LABELS[questionId],
        };
      }
      return { ...question };
    });
  return {
    id: selected?.id || null,
    slug: selectedSlug,
    title: selected?.title || 'הצהרת בריאות ובטיחות + הסרת אחריות',
    // הכותרת של הפעילות והתמונה שלה נוסעות עם התבנית — הטופס הציבורי מציג
    // אותן מעל שם המסמך.
    headline: selected?.headline || '',
    coverImage: selected?.coverImage || '',
    // "אופי הפעילות והסיכונים" — בלעדיו הטופס נופל לנוסח הקבוע בקוד הקליינט,
    // שכבר אינו הנוסח שבתבנית החיה.
    activityNature: selected?.activityNature || '',
    waiverText: selectedSlug === 'trip'
      ? normalizeTripWaiverText(normalizeLiabilityPartyText(selected?.waiverText || STANDARD_WAIVER_TEXT))
      : normalizeLiabilityPartyText(selected?.waiverText || STANDARD_WAIVER_TEXT),
    // `healthQuestions` remains the combined compatibility shape consumed by
    // the existing UI. The two explicit arrays are the immutable document
    // boundaries used when records are saved.
    medicalQuestions,
    waiverQuestions,
    healthQuestions: [...medicalQuestions, ...waiverQuestions],
  };
}

/**
 * Slugs that name the same document. The wall-activity declaration was called
 * `birthday` until it turned out to cover company days and school groups too,
 * and signatures given under the old name still cover the same risks.
 */
const EQUIVALENT_TEMPLATE_SLUGS = { birthday: 'wall', event: 'wall' };

function templateKeyOf(value) {
  const key = String(value || '').trim().toLowerCase();
  return EQUIVALENT_TEMPLATE_SLUGS[key] || key;
}

/**
 * Whether a declaration covers the form being filled.
 *
 * Asked without a slug — the bot, a staff screen wanting to know if anything is
 * on file — any declaration counts. Asked about a particular form, only that
 * form's own counts: a child who signed for the wall never read the clauses
 * about rope descent and being far from help, so treating it as cover for a
 * trip would be filing a signature nobody gave.
 *
 * A declaration with no slug at all predates the split and is read as the wall
 * form, which is what everyone signed then.
 */
function declarationCovers(declaration, wantedKey) {
  if (!wantedKey) return true;
  const have = templateKeyOf(declaration?.templateSlug) || 'wall';
  return have === wantedKey;
}

function matchingDeclarations(db, {
  studentId = null,
  parentId = null,
  climberName = '',
  templateSlug = '',
} = {}) {
  const wantedKey = templateKeyOf(templateSlug);
  return (db.get('health_declarations') || [])
    .filter((declaration) => {
      if (!declarationCovers(declaration, wantedKey)) return false;
      if (studentId) {
        return String(declaration.studentId || '') === String(studentId);
      }
      if (!parentId) return false;
      if (String(declaration.parentId || '') !== String(parentId)) return false;
      if (declaration.studentId) return false;
      if (climberName && normalizedName(declaration.climberName || declaration.studentName) !== normalizedName(climberName)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const left = String(declarationSignedAt(b) || '');
      const right = String(declarationSignedAt(a) || '');
      return left.localeCompare(right);
    });
}

/** Latest declaration of the requested kind, including an expired one for display. */
export function findLatestDeclaration(db, options = {}) {
  return matchingDeclarations(db, options)[0] || null;
}

export function findLatestValidDeclaration(db, options = {}) {
  for (const declaration of matchingDeclarations(db, options)) {
    if (isHealthDeclarationValid(declarationSignedAt(declaration))) {
      return declaration;
    }
  }
  return null;
}

export function validateParticipantDeclarations(participants, template, { healthOnly = false } = {}) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw Object.assign(new Error('יש להוסיף לפחות משתתף אחד'), { status: 400 });
  }
  const templateQuestions = template.healthQuestions || [];
  const screeningQuestions = templateQuestions.filter(isScreeningQuestion);
  const questions = healthOnly
    ? (template.medicalQuestions?.length
        ? template.medicalQuestions
        : (screeningQuestions.length ? screeningQuestions : CANONICAL_HEALTH_QUESTIONS))
    : templateQuestions;
  for (const participant of participants) {
    const name = clean(participant.name);
    if (!name) throw Object.assign(new Error('חסר שם משתתף'), { status: 400 });
    if (participant.type !== 'adult' && !clean(participant.birthDate) && !participant.id) {
      throw Object.assign(new Error(`חסר תאריך לידה עבור ${name}`), { status: 400 });
    }
    const reuseHealth = wantsHealthReuse(participant);
    const reuseWaiver = healthOnly ? true : wantsWaiverReuse(participant);
    if (reuseHealth && reuseWaiver) continue;
    if (healthOnly && !(participant.healthAccepted === true || participant.healthAccepted === 'true')) {
      throw Object.assign(new Error(`חסר אישור הצהרת הבריאות עבור ${name}`), { status: 400 });
    }
    if (!healthOnly && !reuseWaiver && !(participant.waiverAccepted === true || participant.waiverAccepted === 'true')) {
      throw Object.assign(new Error(`חסר אישור כתב הוויתור עבור ${name}`), { status: 400 });
    }
    if (!clean(participant.signature)) {
      throw Object.assign(new Error(`חסרה חתימה עבור ${name}`), { status: 400 });
    }
    // Confirmations must be ticked; screening questions must be answered
    // either way, so a condition nobody was asked about is never filed as "no".
    // Parent-only clauses are excluded for an adult signing for themselves —
    // the form does not show them, so demanding them here would reject a
    // submission that is in fact complete.
    const asked = questionsForSigner(questions, {
      isAdultSelf: participant.type === 'adult',
      isAdultFemale: signsAsAdultFemale(participant),
    });
    if (!reuseHealth) {
      const gap = declarationGap(asked, participant.answers, name);
      if (gap) throw Object.assign(new Error(gap), { status: 400 });
    }
    // A doctor already limited this person's physical activity. The written
    // approval is a condition of filing the declaration at all — checked here
    // and not only in the form, which is the half of this a caller can skip.
    if (!reuseHealth && needsMedicalClearance(asked, participant.answers) && !participant.medicalClearance) {
      throw Object.assign(
        new Error(`נדרש אישור רופא להשתתפות בפעילות ספורטיבית עבור ${name}`),
        { status: 400 }
      );
    }
  }
}

async function requireDurable(persist, table, record) {
  const result = await persist(table, record);
  if (result?.ok === false) {
    const error = new Error(result.error || `שמירת ${table} נכשלה`);
    error.status = 503;
    throw error;
  }
}

/**
 * Shared CRM + declaration path for onboarding and activity registration.
 * The caller supplies the database facade and awaited durable writer.
 */
export async function saveCrmParticipants({
  db,
  persist,
  parent: parentInput,
  participants,
  template: templateInput,
  activityId = null,
  orderId = null,
  participationScope = null,
  phoneVerification = null,
  evidenceContext = null,
  allowEmptyParticipants = false,
  skipDocuments = false,
  healthOnly = false,
  source = 'form',
  onStudentCreated,
  onStudentStatusChanged,
  // Runs after the parent row is durable and before any document is written.
  // The registration order uses it to persist the order row first: waivers
  // carry order_id, and the database enforces that the order exists.
  onParentReady,
} = {}) {
  const parentName = clean(parentInput?.name);
  const phone = clean(parentInput?.phone);
  const email = clean(parentInput?.email);
  if (!parentName || !phone) {
    throw Object.assign(new Error('נדרשים שם הורה ומספר טלפון'), { status: 400 });
  }

  const template = templateInput || resolveDeclarationTemplate(db);
  if (!skipDocuments && (!allowEmptyParticipants || (participants || []).length > 0)) {
    validateParticipantDeclarations(participants, template, { healthOnly });
  }

  // The forms collect the surname in its own field. Storing it means the
  // household matcher and the invoice stop depending on the last word of a
  // free-text name, which is the wrong word whenever someone writes their
  // family name first.
  const lastName = clean(parentInput?.lastName || parentInput?.last_name);
  // אב / אם / אפוטרופוס — נשאל פעם אחת על ההורה, לא לכל ילד בנפרד.
  const relation = clean(parentInput?.relation);
  const idNumber = clean(parentInput?.idNumber || parentInput?.parentIdNum);

  // The phone is the usual key. An ID is a stronger one: the same parent
  // registering a second child from a different handset would otherwise open a
  // second card. Only an unambiguous match counts — if two cards somehow carry
  // the same ID, fall back to the phone rather than guessing between them.
  const idKey = normalizedIdNumber(idNumber);
  const byIdNumber = idKey.length >= 5
    ? (db.get('parents') || []).filter((row) => normalizedIdNumber(row.idNumber) === idKey)
    : [];
  const existingById = byIdNumber.length === 1 ? byIdNumber[0] : null;

  let parent = existingById || db.upsertParentByPhone(parentName, phone, email, {
    city: clean(parentInput?.city),
    idNumber,
    lastName,
    source,
  });
  parent = db.update('parents', parent.id, {
    name: parentName,
    lastName: lastName || parent.lastName || '',
    relation: relation || parent.relation || '',
    email: email || parent.email || '',
    city: clean(parentInput?.city) || parent.city || '',
    idNumber: idNumber || parent.idNumber || '',
    // מין ותאריך לידה נאספים בטופס הציבורי. בלי לשמור אותם, כל ביקור חוזר
    // פתח מחדש את חלונית "השלמת הפרטים" במקום כרטיס הסיכום.
    gender: clean(parentInput?.gender) || parent.gender || '',
    birthDate: clean(parentInput?.birthDate || parentInput?.birth_date) || parent.birthDate || '',
    // Reached through the ID from a number the card does not carry: record it,
    // so the next visit is recognised by phone like everyone else.
    phone: existingById ? (phone || parent.phone || '') : parent.phone,
  }) || parent;
  await requireDurable(persist, 'parents', parent);
  if (onParentReady) await onParentReady({ parent });

  const signedAt = new Date().toISOString();
  const signedDate = signedAt.slice(0, 10);
  // Named here so the approval can say what it approves. Taken from the row
  // rather than from the request: the signer's browser is not the authority on
  // when the outing is.
  const signedActivityRow = activityId ? (db.getOne?.('activities', activityId) || null) : null;
  const signedActivity = signedActivityRow
    ? {
        id: signedActivityRow.id,
        name: String(
          signedActivityRow.registration_page_title
          || signedActivityRow.registrationPageTitle
          || signedActivityRow.name
          || ''
        ).trim(),
        date: signedActivityRow.date || '',
        endDate: signedActivityRow.end_date || signedActivityRow.endDate || '',
      }
    : null;
  const savedParticipants = [];
  const declarations = [];
  const waivers = [];
  const medicalQuestions = template.medicalQuestions
    || CANONICAL_HEALTH_QUESTIONS.map((question) => ({ ...question }));
  const waiverQuestions = template.waiverQuestions
    || (template.healthQuestions || []).filter((question) => !isScreeningQuestion(question));
  const healthSnapshot = {
    documentType: 'health',
    title: 'הצהרת בריאות',
    confirmationText: HEALTH_DECLARATION_CONFIRMATION,
    templateId: template.id,
    templateSlug: template.slug,
    templateVersion: template.version || template.updated_at || template.updatedAt || null,
    // כל מה שנשאל ונענה — גם אישורי הבטיחות. התשובות בהצהרה כוללות אותם,
    // ו-snapshot שמחזיק רק את השאלות הרפואיות השאיר אותם בלי נוסח בעותק
    // החתום ("w1 ✓").
    healthQuestions: [...medicalQuestions, ...waiverQuestions],
    ...(phoneVerification ? { phoneVerification } : {}),
  };
  const waiverSnapshot = {
    documentType: 'participation_waiver',
    id: template.id,
    scope: normalizeParticipationScope(template.slug),
    title: template.title,
    templateVersion: template.version || template.updated_at || template.updatedAt || null,
    waiverText: template.waiverText,
    waiverQuestions,
    // Whether the phone on the form answered a one-time code before signing.
    // Lives in the snapshot because it is part of what the signature meant at
    // the time, exactly like the text that was signed.
    ...(phoneVerification ? { phoneVerification } : {}),
  };

  for (const input of participants) {
    const participantType = input.type === 'adult' ? 'adult' : 'child';
    const name = clean(input.name);
    let student = null;
    // The form was told this child already exists on another family's file and
    // the person filling it confirmed they are a second parent. Re-check the
    // identity here: a client could otherwise post any student id and attach
    // itself to a stranger's child.
    const linkStudentId = clean(input.link_student_id || input.linkStudentId);
    let linkedFromOtherFamily = false;
    if (linkStudentId) {
      const candidate = (db.get('students') || []).find(
        (item) => String(item.id) === linkStudentId
      );
      const birthDate = clean(input.birthDate);
      // Whichever identifier the form actually matched on has to hold here too.
      // An ID number stands on its own; without one, name and birth date must
      // both agree, so a posted id cannot attach anyone to a stranger's child.
      const claimedId = normalizedIdNumber(input.idNumber || input.climberIdNum);
      const idHolds = !!claimedId
        && normalizedIdNumber(candidate?.idNumber) === claimedId;
      const nameAndBirthHold = !!birthDate
        && normalizedName(candidate?.name) === normalizedName(name)
        && String(candidate?.birthDate || '').trim() === birthDate;
      const identityHolds = !!candidate && (idHolds || nameAndBirthHold);
      if (!identityHolds) {
        throw Object.assign(
          new Error(`הפרטים של ${name} לא תואמים את הילד שנבחר במערכת`),
          { status: 400 }
        );
      }
      student = candidate;
      linkedFromOtherFamily = String(candidate.parentId || '') !== String(parent.id);
    }
    if (!student && input.id) {
      const candidate = (db.get('students') || []).find((item) => String(item.id) === String(input.id));
      const parentMember = (db.get('household_members') || []).find((row) => String(row.parent_id || '') === String(parent.id));
      const studentMember = (db.get('household_members') || []).find((row) => String(row.student_id || '') === String(candidate?.id || ''));
      const sameExplicitHousehold = !!parentMember && !!studentMember
        && parentMember.household_id === studentMember.household_id;
      const guardianIds = candidate ? guardianParentIds(db, candidate) : [];
      const graphParentIds = expandHousehold(db, parent.id)?.parentIds || [parent.id];
      if (candidate && (
        String(candidate.parentId || '') === String(parent.id)
        || guardianIds.includes(parent.id)
        || graphParentIds.includes(candidate.parentId)
        || sameExplicitHousehold
      )) {
        student = candidate;
      } else if (candidate) {
        throw Object.assign(new Error('אפשר לרשום רק משתתפים מתיק המשפחה'), { status: 403 });
      }
    }
    if (!student) {
      student = (db.get('students') || []).find((item) => {
        if (item.parentId !== parent.id) return false;
        if (normalizedName(item.name) !== normalizedName(name)) return false;
        if (participantType === 'adult') return item.isAdult === true;
        if (item.isAdult === true) return false;
        return !input.birthDate || !item.birthDate || item.birthDate === input.birthDate;
      });
    }
    if (!student) {
      student = sameHouseholdParticipantCandidate(db, parent.id, input, participantType);
    }
    // Two rows in one family form can resolve to the same canonical trainee
    // (for example, one with and one without the family-name suffix). Save and
    // sign that person once, not twice.
    if (student?.id && savedParticipants.some((saved) => String(saved.student?.id) === String(student.id))) {
      continue;
    }
    const adultCreatesDocument = participantType === 'adult'
      && !skipDocuments
      && (!wantsHealthReuse(input) || (!healthOnly && !wantsWaiverReuse(input)));
    if (adultCreatesDocument) {
      const canonicalBirthDate = clean(input.birthDate) || clean(student?.birthDate);
      const birth = /^\d{4}-\d{2}-\d{2}$/.test(canonicalBirthDate)
        ? new Date(`${canonicalBirthDate}T00:00:00Z`)
        : null;
      const today = new Date();
      let age = birth && !Number.isNaN(birth.getTime())
        ? today.getUTCFullYear() - birth.getUTCFullYear()
        : null;
      if (age != null && (
        today.getUTCMonth() < birth.getUTCMonth()
        || (today.getUTCMonth() === birth.getUTCMonth() && today.getUTCDate() < birth.getUTCDate())
      )) age -= 1;
      if (!canonicalBirthDate || age == null || age < 18) {
        throw Object.assign(new Error('קטין אינו רשאי לחתום עבור עצמו — נדרשת חתימת הורה או אפוטרופוס'), { status: 403 });
      }
      const adultId = normalizedIdNumber(input.idNumber || input.climberIdNum || student?.idNumber);
      const parentIdentity = normalizedIdNumber(parentInput?.idNumber || parentInput?.parentIdNum || parent.idNumber);
      const sameIdentity = (adultId && parentIdentity && adultId === parentIdentity)
        || normalizedName(name) === normalizedName(parentName);
      const signsForOwnCard = (!student || String(student.parentId || '') === String(parent.id))
        && sameIdentity;
      if (!signsForOwnCard) {
        throw Object.assign(new Error('מבוגר רשאי לחתום רק עבור עצמו'), { status: 403 });
      }
    }
    const previousStatus = student?.status;
    // Read before the patch below stamps "signed now" on the record: a reuse
    // claim may only lean on a signature that already existed when the form was
    // opened, otherwise anyone could skip the declaration by typing a new name
    // and asking to reuse it.
    const priorHealthSignedAt = student?.healthSignedAt || null;
    const childPhone = clean(input.childPhone || input.phone);
    const patch = {
      name,
      // שם המשפחה בשדה משלו, כמו על תיק ההורה — לא ניחוש מהמילה האחרונה.
      lastName: clean(input.lastName || input.last_name) || student?.lastName || '',
      // A second parent joins the child's file; they do not take it over.
      parentId: linkedFromOtherFamily ? student.parentId : parent.id,
      isAdult: participantType === 'adult',
      birthDate: clean(input.birthDate) || student?.birthDate || '',
      gender: clean(input.gender) || student?.gender || '',
      idNumber: clean(input.idNumber || input.climberIdNum) || student?.idNumber || '',
      notes: clean(input.notes || input.registrationNotes) || student?.notes || '',
      // Kept on the card too: this is what an instructor needs at the wall.
      healthNotes: clean(input.healthNotes) || student?.healthNotes || '',
      phone: childPhone || student?.phone || '',
      status: previousStatus === 'registered' ? 'registered' : (student?.status || 'lead_new'),
      healthSignedAt: student?.healthSignedAt || null,
      waiverSignedAt: student?.waiverSignedAt || null,
    };
    if (!skipDocuments && !wantsHealthReuse(input)) {
      patch.healthSignedAt = signedAt;
      patch.status = statusAfterHealthSignature(previousStatus);
    }
    if (!skipDocuments && !healthOnly && !wantsWaiverReuse(input)) {
      patch.waiverSignedAt = signedAt;
    }
    let createdNow = false;
    if (student) {
      student = db.update('students', student.id, patch) || { ...student, ...patch };
      if (previousStatus !== student.status) {
        onStudentStatusChanged?.(student);
      }
    } else {
      student = db.insert('students', {
        ...patch,
        groupId: null,
        source,
        created: signedDate,
      });
      createdNow = true;
      onStudentCreated?.(student, parent);
    }
    await requireDurable(persist, 'students', student);

    if (linkedFromOtherFamily) {
      const link = linkGuardian(db, { studentId: student.id, parentId: parent.id, source });
      if (link) await requireDurable(persist, 'student_guardians', link);
    }

    // A child signed up by one parent after the two cards were already merged
    // belongs to both of them — only a brand new record, so a family somebody
    // deliberately split does not glue itself back together on the next form.
    if (createdNow && participantType !== 'adult') {
      for (const link of linkHouseholdGuardians(db, { studentId: student.id, source })) {
        await requireDurable(persist, 'student_guardians', link);
      }
    }

    if (skipDocuments) {
      savedParticipants.push({
        input,
        type: participantType,
        name,
        student,
        declaration: null,
        healthDeclaration: null,
        waiver: null,
      });
      continue;
    }

    const scope = normalizeParticipationScope(participationScope || template.slug);
    let declaration = null;
    let healthCreated = false;
    if (wantsHealthReuse(input)) {
      const health = healthDocumentState(db, student.id);
      if (health.state === 'valid') declaration = health.record;
      // Compatibility for a wall record that predates durable declarations.
      if (!declaration && scope === 'wall' && priorHealthSignedAt && isHealthDeclarationValid(priorHealthSignedAt)) {
        declaration = {
          id: null,
          reused_from_student: true,
          studentId: student.id,
          parentId: parent.id,
          signedDate: String(priorHealthSignedAt).slice(0, 10),
        };
      }
      if (!declaration) {
        throw Object.assign(new Error(
          health.state === 'blocked'
            ? `הצהרת הבריאות של ${name} חסומה עד להשלמת הצהרה חדשה`
            : `אין הצהרת בריאות בתוקף עבור ${name} — יש למלא הצהרה מחדש`
        ), { status: 400 });
      }
    } else {
      const participantSnapshot = {
        studentId: student.id,
        name,
        idNumber: clean(input.idNumber || input.climberIdNum || student.idNumber),
        birthDate: clean(input.birthDate || student.birthDate),
        gender: clean(input.gender || student.gender),
      };
      const signerSnapshot = {
        parentId: parent.id,
        name: parentName,
        idNumber: parent.idNumber || '',
        phone,
      };
      const healthAnswers = Object.fromEntries(
        medicalQuestions.map((question) => [question.id, input.answers?.[question.id]])
      );
      const healthId = `hd_${crypto.randomUUID()}`;
      const healthContentSnapshot = {
        ...healthSnapshot,
        answers: healthAnswers,
        healthNotes: clean(input.healthNotes),
        signer: signerSnapshot,
        participant: participantSnapshot,
        signedAt,
      };
      const healthEvidence = evidenceContext ? createSignatureEvidenceEvent({
        documentType: 'health_declaration',
        documentId: healthId,
        signer: signerSnapshot,
        participant: participantSnapshot,
        signingCapacity: participantType === 'adult' ? 'self' : 'parent_or_guardian',
        relationship: relation,
        occurredAt: signedAt,
        contentSnapshot: healthContentSnapshot,
        signature: input.signature,
        phoneVerification,
        requestContext: evidenceContext.requestContext || null,
        clientTimeline: input.signatureEvidenceTimeline || input.signature_evidence_timeline || null,
        source,
        activityId,
        orderId,
      }) : null;
      declaration = db.insert('health_declarations', {
        id: healthId,
        date: signedDate,
        studentId: student?.id || null,
        parentId: parent.id,
        parentName,
        parentIdNum: clean(parentInput?.idNumber || parentInput?.parentIdNum),
        phone,
        climberName: name,
        climberIdNum: clean(input.idNumber || input.climberIdNum),
        birthDate: clean(input.birthDate),
        answers: healthAnswers,
        // What a "yes" on a screening question actually was. It belongs on the
        // signed declaration, not only on the card, because that is the record
        // of what was disclosed at the time.
        healthNotes: clean(input.healthNotes),
        // This row is the global medical record only. The legal acceptance is
        // stored separately in participation_waivers below.
        waiverAccepted: false,
        signature_url: input.signature,
        status: 'approved',
        notes: clean(input.notes),
        templateSlug: template.slug,
        templateId: template.id,
        formSnapshot: {
          ...healthContentSnapshot,
          ...(healthEvidence ? { evidence: evidenceReference(healthEvidence) } : {}),
        },
        medicalClearanceDocumentId: clean(
          input.medicalClearanceDocumentId || input.medical_clearance_document_id
        ) || null,
        activityId,
        orderId,
        expiresAt: healthExpiryDate(signedAt)?.toISOString() || null,
        signed: true,
        signedDate,
        signedBy: parentName,
        studentName: name,
      });
      await requireDurable(persist, 'health_declarations', declaration);
      if (healthEvidence) await appendSignatureEvidence(db, healthEvidence);
      healthCreated = true;
      // Completing the replacement is what releases an immediate health hold.
      for (const hold of (db.get('health_holds') || []).filter((row) => (
        String(row.student_id || row.studentId || '') === String(student.id)
        && !row.released_at
        && row.status !== 'released'
      ))) {
        const released = db.update('health_holds', hold.id, {
          status: 'released',
          released_at: signedAt,
          released_by_declaration_id: declaration.id,
          updated_at: signedAt,
        }) || hold;
        await requireDurable(persist, 'health_holds', released);
      }
    }

    let waiver = null;
    let waiverCreated = false;
    if (healthOnly) {
      // A renewal-only link is deliberately incapable of creating, replacing
      // or even re-validating a participation waiver. Health and legal scope
      // are independent documents; only the medical record changes here.
      waiver = null;
    } else if (wantsWaiverReuse(input)) {
      const existingWaiver = waiverDocumentState(db, student.id, scope);
      if (existingWaiver.state !== 'valid') {
        throw Object.assign(new Error(`אין אישור השתתפות בתוקף עבור ${name} — יש לחתום מחדש`), { status: 400 });
      }
      waiver = existingWaiver.record;
    } else {
      const participantSnapshot = {
        studentId: student.id,
        name,
        idNumber: clean(input.idNumber || input.climberIdNum || student.idNumber),
        birthDate: clean(input.birthDate || student.birthDate),
        gender: clean(input.gender || student.gender),
      };
      const signerSnapshot = {
        parentId: parent.id,
        name: parentName,
        idNumber: parent.idNumber || '',
        phone,
      };
      const waiverAnswers = Object.fromEntries(
        waiverQuestions.map((question) => [question.id, input.answers?.[question.id]])
      );
      const waiverId = `pw_${crypto.randomUUID()}`;
      const waiverContentSnapshot = {
        ...waiverSnapshot,
        // Resolved per participant: the same template serves an adult signing
        // for themselves and a parent signing for a child, and only one of them
        // has minors on the document.
        waiverText: waiverTextForSigner(waiverSnapshot.waiverText, participantType !== 'adult'),
        scope,
        answers: waiverAnswers,
        signer: signerSnapshot,
        participant: participantSnapshot,
        // Which outing this approval was given for. The row already carried
        // `activity_id`, but a foreign key is not a document: without the name
        // and the dates inside the snapshot, the signed copy cannot say what
        // was approved, and the id points at a row staff may later rename.
        ...(signedActivity ? { activity: signedActivity } : {}),
        signedAt,
      };
      const waiverEvidence = evidenceContext ? createSignatureEvidenceEvent({
        documentType: 'participation_waiver',
        documentId: waiverId,
        signer: signerSnapshot,
        participant: participantSnapshot,
        signingCapacity: participantType === 'adult' ? 'self' : 'parent_or_guardian',
        relationship: relation,
        occurredAt: signedAt,
        contentSnapshot: waiverContentSnapshot,
        signature: input.signature,
        phoneVerification,
        requestContext: evidenceContext.requestContext || null,
        clientTimeline: input.signatureEvidenceTimeline || input.signature_evidence_timeline || null,
        source,
        activityId,
        orderId,
      }) : null;
      waiver = db.insert('participation_waivers', {
        id: waiverId,
        student_id: student.id,
        signer_parent_id: parent.id,
        scope,
        template_id: template.id,
        signed_at: signedAt,
        expires_at: participationWaiverExpiryDate(signedAt)?.toISOString() || null,
        signature_url: input.signature,
        status: 'approved',
        form_snapshot: {
          ...waiverContentSnapshot,
          ...(waiverEvidence ? { evidence: evidenceReference(waiverEvidence) } : {}),
        },
        activity_id: activityId,
        order_id: orderId,
        created_at: signedAt,
        updated_at: signedAt,
      });
      await requireDurable(persist, 'participation_waivers', waiver);
      if (waiverEvidence) await appendSignatureEvidence(db, waiverEvidence);
      waiverCreated = true;
    }
    declarations.push(declaration);
    waivers.push(waiver);
    savedParticipants.push({
      input,
      type: participantType,
      name,
      student,
      declaration,
      healthDeclaration: declaration,
      waiver,
      healthCreated,
      waiverCreated,
    });
  }

  // "We are the same family as this card" — confirmed on the form, so both
  // parents end up on one file with every child listed once.
  const familyParentId = clean(parentInput?.family_parent_id || parentInput?.familyParentId);
  const familyLinks = familyParentId
    ? mergeFamily(db, {
        parentId: parent.id,
        familyParentId,
        extraStudentIds: savedParticipants.map((item) => item.student?.id).filter(Boolean),
      })
    : [];
  for (const link of familyLinks) {
    await requireDurable(persist, 'student_guardians', link);
  }

  // Materialise the explicit household after guardian linking/merging, so
  // future orders validate every participant against one durable household.
  const household = await ensureHouseholdForParent(db, persist, parent.id);

  // A spouse is a participant and a second adult of the same household. The
  // declarations above already treated them as a participant; this is what puts
  // them on the family file, so the next form recognises them instead of opening
  // a second one. A bad number must not undo signatures that were just filed.
  const spouseInputs = (participants || []).filter((input) => (
    String(input?.spouse_phone || input?.spousePhone || '').replace(/\D/g, '').length >= 9
  ));
  for (const input of spouseInputs) {
    try {
      await addPendingSpouse(db, persist, {
        householdId: household.id,
        name: clean(input.name),
        phone: String(input.spouse_phone || input.spousePhone || ''),
        source,
      });
    } catch (error) {
      console.warn('spouse not added to household:', error.message);
    }
  }

  return { parent, participants: savedParticipants, declarations, waivers, template, familyLinks, household };
}
