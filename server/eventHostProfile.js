function text(value) {
  return String(value || '').trim();
}

function normalizedPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('9720')) digits = `972${digits.slice(4)}`;
  if (digits.startsWith('0') && digits.length >= 9) digits = `972${digits.slice(1)}`;
  return digits;
}

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

/** Normalize the same parent identity fields collected by the full onboarding form. */
export function normalizeEventHostProfile(input = {}, lockedPhone = '') {
  const firstName = text(input.firstName || input.name);
  const lastName = text(input.lastName);
  const idNumber = text(input.idNumber).replace(/\s/g, '');
  const phone = normalizedPhone(lockedPhone || input.phone);
  const email = text(input.email).toLowerCase();
  const city = text(input.city);
  const gender = text(input.gender).toLowerCase();
  const birthDate = text(input.birthDate);

  if (!firstName || !lastName) fail('יש למלא שם פרטי ושם משפחה');
  if (idNumber.replace(/\D/g, '').length < 5) fail('יש למלא מספר תעודת זהות תקין');
  if (phone.length < 11) fail('מספר הטלפון בקישור אינו תקין');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fail('יש למלא כתובת אימייל תקינה');
  if (!city) fail('יש למלא מקום מגורים');
  if (!['male', 'female'].includes(gender)) fail('יש לבחור מין');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) fail('יש למלא תאריך לידה');
  const born = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(born.getTime()) || born > new Date()) fail('תאריך הלידה אינו תקין');

  return {
    firstName,
    lastName,
    name: `${firstName} ${lastName}`.trim(),
    idNumber,
    phone,
    email,
    city,
    gender,
    birthDate,
    relation: gender === 'female' ? 'mother' : 'father',
  };
}

export function matchEventHostParent(parents = [], profile) {
  const idKey = text(profile?.idNumber).replace(/\D/g, '');
  const phoneKey = normalizedPhone(profile?.phone);
  const byId = idKey
    ? parents.find((parent) => text(parent.idNumber).replace(/\D/g, '') === idKey) || null
    : null;
  const byPhone = phoneKey
    ? parents.find((parent) => normalizedPhone(parent.phone) === phoneKey) || null
    : null;
  if (byId && byPhone && String(byId.id) !== String(byPhone.id)) {
    fail('תעודת הזהות והטלפון משויכים לשני כרטיסי לקוח שונים. יש לפנות לצוות.', 409);
  }
  return byId || byPhone || null;
}

/**
 * Pick the WhatsApp destination for an event host link.
 * A deliberately entered one-off number must not silently fall back to the
 * customer previously linked to the activity.
 */
export function resolveEventHostRecipient({
  parents = [],
  activity = {},
  requestedParentId = null,
  requestedPhone = '',
  manualRecipient = false,
} = {}) {
  const parentId = manualRecipient
    ? null
    : (requestedParentId || activity.host_parent_id || null);
  const parent = parentId
    ? parents.find((row) => String(row.id) === String(parentId)) || null
    : null;
  const phone = text(
    manualRecipient
      ? requestedPhone
      : (parent?.phone || requestedPhone || activity.host_phone || activity.contact_phone)
  );
  return { parentId, parent, phone };
}
