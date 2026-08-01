import {
  declarationSignedAt,
  isHealthDeclarationValid,
} from './healthValidity.js';
import { linkGuardian, mergeFamily, normalizedIdNumber } from './studentGuardians.js';
import { declarationGap, questionsForSigner } from './healthQuestions.js';

// The safety rules are not repeated here: they are the items ticked one by one
// on the declaration step, which is both better evidence and one list instead
// of two. Kept in step with the templates in the live database.
export const STANDARD_WAIVER_TEXT = `אני מצהיר/ה כי אני מודע/ת לסיכונים הכרוכים בפעילות המתקיימת ב"הרפתקאות (קיר בועז)", אני פוטר/ת את "הרפתקאות (קיר בועז)" ו/או מי מטעמו מכל אחריות לפגיעה אם תקרה למשתתף אותו אני רושם לפעילות וזאת אלא אם יוכח כי הינה תוצאה של רשלנות המקום.

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
  { id: 's4', requireYes: true, label: 'טיפוס על הקיר יתאפשר רק לאלו שקיבלו תדריך מסודר' },
  { id: 's5', requireYes: true, label: 'אין להשתמש במתקנים השונים ללא קבלת אישור ממדריך' },
];

function clean(value) {
  return String(value || '').trim();
}

function normalizedName(value) {
  return clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('he');
}

function wantsReuse(participant) {
  return participant?.reuse_health === true
    || participant?.reuseHealth === true
    || participant?.reuse_declaration === true;
}

/** Always the active default health template — used by public activity registration. */
export function resolveDefaultDeclarationTemplate(db) {
  return resolveDeclarationTemplate(db, {});
}

export function resolveDeclarationTemplate(db, { templateId, templateSlug } = {}) {
  const templates = db.get('form_templates') || [];
  const selected =
    (templateId && templates.find((item) => String(item.id) === String(templateId))) ||
    (templateSlug && templates.find((item) => item.slug === templateSlug && item.isActive !== false)) ||
    templates.find((item) => item.isDefault && item.isActive !== false) ||
    templates.find((item) => item.slug === 'wall' && item.isActive !== false);
  return {
    id: selected?.id || null,
    slug: selected?.slug || templateSlug || 'wall',
    title: selected?.title || 'הצהרת בריאות ובטיחות + הסרת אחריות',
    waiverText: selected?.waiverText || STANDARD_WAIVER_TEXT,
    healthQuestions:
      Array.isArray(selected?.healthQuestions) && selected.healthQuestions.length
        ? selected.healthQuestions
        : STANDARD_HEALTH_QUESTIONS,
  };
}

export function findLatestValidDeclaration(db, {
  studentId = null,
  parentId = null,
  climberName = '',
} = {}) {
  const declarations = (db.get('health_declarations') || [])
    .filter((declaration) => {
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

  for (const declaration of declarations) {
    if (isHealthDeclarationValid(declarationSignedAt(declaration))) {
      return declaration;
    }
  }
  return null;
}

export function validateParticipantDeclarations(participants, template) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw Object.assign(new Error('יש להוסיף לפחות משתתף אחד'), { status: 400 });
  }
  const questions = template.healthQuestions || [];
  for (const participant of participants) {
    const name = clean(participant.name);
    if (!name) throw Object.assign(new Error('חסר שם משתתף'), { status: 400 });
    if (participant.type !== 'adult' && !clean(participant.birthDate) && !participant.id) {
      throw Object.assign(new Error(`חסר תאריך לידה עבור ${name}`), { status: 400 });
    }
    if (wantsReuse(participant)) continue;
    if (!(participant.waiverAccepted === true || participant.waiverAccepted === 'true')) {
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
    const gap = declarationGap(
      questionsForSigner(questions, { isAdultSelf: participant.type === 'adult' }),
      participant.answers,
      name
    );
    if (gap) throw Object.assign(new Error(gap), { status: 400 });
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
  phoneVerification = null,
  source = 'form',
  onStudentCreated,
  onStudentStatusChanged,
} = {}) {
  const parentName = clean(parentInput?.name);
  const phone = clean(parentInput?.phone);
  const email = clean(parentInput?.email);
  if (!parentName || !phone) {
    throw Object.assign(new Error('נדרשים שם הורה ומספר טלפון'), { status: 400 });
  }

  const template = templateInput || resolveDeclarationTemplate(db);
  validateParticipantDeclarations(participants, template);

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
    // Reached through the ID from a number the card does not carry: record it,
    // so the next visit is recognised by phone like everyone else.
    phone: existingById ? (phone || parent.phone || '') : parent.phone,
  }) || parent;
  await requireDurable(persist, 'parents', parent);

  const signedAt = new Date().toISOString();
  const signedDate = signedAt.slice(0, 10);
  const savedParticipants = [];
  const declarations = [];
  const snapshot = {
    id: template.id,
    slug: template.slug,
    title: template.title,
    waiverText: template.waiverText,
    healthQuestions: template.healthQuestions,
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
      student = (db.get('students') || []).find(
        (item) => String(item.id) === String(input.id) && item.parentId === parent.id
      );
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
    const previousStatus = student?.status;
    // Read before the patch below stamps "signed now" on the record: a reuse
    // claim may only lean on a signature that already existed when the form was
    // opened, otherwise anyone could skip the declaration by typing a new name
    // and asking to reuse it.
    const priorHealthSignedAt = student?.healthSignedAt || null;
    const childPhone = clean(input.childPhone || input.phone);
    const patch = {
      name,
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
      status: previousStatus === 'registered' ? 'registered' : 'health_signed',
      healthSignedAt: student?.healthSignedAt || signedAt,
      waiverSignedAt: student?.waiverSignedAt || signedAt,
    };
    if (!wantsReuse(input)) {
      patch.healthSignedAt = signedAt;
      patch.waiverSignedAt = signedAt;
    }
    if (student) {
      student = db.update('students', student.id, patch) || { ...student, ...patch };
      if (previousStatus !== 'registered' && previousStatus !== 'health_signed') {
        onStudentStatusChanged?.(student);
      }
    } else {
      student = db.insert('students', {
        ...patch,
        groupId: null,
        source,
        created: signedDate,
      });
      onStudentCreated?.(student, parent);
    }
    await requireDurable(persist, 'students', student);

    if (linkedFromOtherFamily) {
      const link = linkGuardian(db, { studentId: student.id, parentId: parent.id, source });
      if (link) await requireDurable(persist, 'student_guardians', link);
    }

    let declaration = null;
    if (wantsReuse(input)) {
      declaration = findLatestValidDeclaration(db, {
        studentId: student?.id || null,
        parentId: parent.id,
        climberName: name,
      });
      if (!declaration && priorHealthSignedAt && isHealthDeclarationValid(priorHealthSignedAt)) {
        // Older records may only have the student flag — still allow register without new signature.
        declaration = {
          id: null,
          reused_from_student: true,
          studentId: student.id,
          parentId: parent.id,
          signedDate: String(priorHealthSignedAt).slice(0, 10),
        };
      }
      if (!declaration) {
        throw Object.assign(
          new Error(`אין הצהרת בריאות בתוקף עבור ${name} — יש למלא הצהרה מחדש`),
          { status: 400 }
        );
      }
    } else {
      declaration = db.insert('health_declarations', {
        date: signedDate,
        studentId: student?.id || null,
        parentId: parent.id,
        parentName,
        parentIdNum: clean(parentInput?.idNumber || parentInput?.parentIdNum),
        phone,
        climberName: name,
        climberIdNum: clean(input.idNumber || input.climberIdNum),
        birthDate: clean(input.birthDate),
        answers: input.answers || {},
        // What a "yes" on a screening question actually was. It belongs on the
        // signed declaration, not only on the card, because that is the record
        // of what was disclosed at the time.
        healthNotes: clean(input.healthNotes),
        waiverAccepted: true,
        signature_url: input.signature,
        status: 'approved',
        notes: clean(input.notes),
        templateSlug: template.slug,
        templateId: template.id,
        formSnapshot: snapshot,
        activityId,
        orderId,
        signed: true,
        signedDate,
        signedBy: parentName,
        studentName: name,
      });
      await requireDurable(persist, 'health_declarations', declaration);
    }
    declarations.push(declaration);
    savedParticipants.push({
      input,
      type: participantType,
      name,
      student,
      declaration,
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

  return { parent, participants: savedParticipants, declarations, template, familyLinks };
}
