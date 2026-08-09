/**
 * One public-form submission can save several existing and new trainees. The
 * confirmation belongs to the submission, not to whichever child happened to
 * create a new CRM row and fire the old `new_lead` automation.
 */

function cleanName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export function participantNamesForConfirmation(students = []) {
  const names = [...new Set((students || []).map((student) => cleanName(student?.name)).filter(Boolean))];
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} ו${names[1]}`;
  return `${names.slice(0, -1).join(', ')} ו${names.at(-1)}`;
}

export function formConfirmationPayload({ parent, students = [], phone = '' } = {}) {
  const names = participantNamesForConfirmation(students);
  if (!parent || !names) return null;
  return {
    // Keep a real participant id for automation journals, while the customer-
    // facing variable deliberately contains every participant in this form.
    ...(students[0] || {}),
    name: names,
    phone: parent.phone || phone,
    parentId: parent.id || null,
    parentName: parent.name || '',
  };
}
