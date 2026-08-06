/**
 * איך קוראים לטופס בתיק הלקוח ובמסכי הצוות.
 * מקביל ל־server/participationForm.js — השם הקצר לתיקייה הוא ברבים,
 * כי בתיק יכולים לשבת כמה טפסים (קיר, טיול, פעילות).
 */

/** כותרת התיקייה בתיק הלקוח. */
export const FORM_FOLDER = 'טפסי השתתפות';

/** שורת מסמך חתום ברשימה. */
export const FORM_SIGNED_ROW = 'טופס השתתפות חתום';

/** שם קצר לכפתורים ולהודעות צוות. */
export const FORM_SHORT = 'טופס השתתפות';

/** Normalize CRM / legacy gender values to what the public form buttons use. */
export function participationGenderValue(value) {
  const gender = String(value || '').trim().toLowerCase();
  if (['male', 'm', 'בן', 'זכר', 'גבר', 'boy'].includes(gender)) return 'male';
  if (['female', 'f', 'בת', 'נקבה', 'אישה', 'girl'].includes(gender)) return 'female';
  return '';
}

/**
 * Build the participant details used when a parent fills the form for
 * themselves. Birth date and gender belong to the adult's student card, while
 * the legal name / ID may be more complete on the parent card.
 */
export function adultParticipantFromContext(selfStudent, { fullName = '', idNumber = '', gender = '', birthDate = '' } = {}) {
  const student = selfStudent || {};
  return {
    ...student,
    name: String(fullName || student.name || '').trim(),
    idNumber: String(idNumber || student.idNumber || student.id_number || '').trim(),
    birthDate: birthDate || student.birthDate || student.birth_date || '',
    // Carried from the details step rather than asked twice: the signer just
    // answered this about themselves one screen ago.
    gender: participationGenderValue(gender || student.gender),
    type: 'adult',
  };
}
