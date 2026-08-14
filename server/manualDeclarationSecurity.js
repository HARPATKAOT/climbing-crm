function clean(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Only the fields shown by the staff form may enter a manual declaration. */
export function normalizeManualDeclaration(body = {}, { actor = '', today = '' } = {}) {
  const studentName = clean(body.studentName, 160);
  const signedBy = clean(body.signedBy || body.parentName, 160);
  if (!studentName) throw badRequest('שם המתאמן חובה');
  if (!signedBy) throw badRequest('שם החותם חובה');

  const answers = {};
  if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    for (const [rawKey, value] of Object.entries(body.answers).slice(0, 100)) {
      const key = clean(rawKey, 100);
      if (key) answers[key] = value === true;
    }
  }

  const signedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(today || ''))
    ? String(today)
    : new Date().toISOString().slice(0, 10);
  return {
    studentName,
    signed: true,
    signedDate,
    signedBy,
    answers,
    notes: clean(body.notes, 4000),
    emergencyPhone: clean(body.emergencyPhone, 40),
    source: 'staff_manual',
    created_by: clean(actor, 200),
    created_at: new Date().toISOString(),
  };
}
