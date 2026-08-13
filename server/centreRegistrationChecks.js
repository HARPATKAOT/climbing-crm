/**
 * מי באמת נרשם במתנ״ס — מעקב שבועי מול כרמית.
 *
 * הורה כותב „ההרשמה מעודכנת במתנ״ס”, והבוט אינו יכול לאמת את זה: השיבוץ נשאר
 * „ממתין להרשמה” עד שמישהו יבדוק, ובפועל אף אחד לא בדק. במקום לשאול את כרמית
 * על כל ילד בנפרד ברגע אקראי, נאספים כל הדיווחים ונשלחת אליה **שאלה אחת בכל
 * יום ראשון ב-08:00** עם כל השמות.
 *
 * מי שלא חזר בתשובה שלה נבדק שוב: קודם מול ההורה, ואז שוב מול כרמית ביום
 * שלישי. ילד שאיש לא אישר לא נשכח ולא מסומן כרשום.
 */

export const CENTRE_CHECK_COLLECTION = 'centre_registration_checks';

export const CENTRE_CHECK_REPORTED = 'reported';
export const CENTRE_CHECK_ASKED = 'asked';
export const CENTRE_CHECK_CONFIRMED = 'confirmed';
export const CENTRE_CHECK_UNCONFIRMED = 'unconfirmed';

const TIME_ZONE = 'Asia/Jerusalem';
const SUNDAY = 0;
const TUESDAY = 2;
export const DIGEST_HOUR = 8;

function israelParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdays[read('weekday')] ?? -1,
    hour: Number(read('hour')),
    dateKey: `${read('year')}-${read('month')}-${read('day')}`,
  };
}

export function rows(db) {
  const list = db.get(CENTRE_CHECK_COLLECTION);
  return Array.isArray(list) ? list : [];
}

/** One open check per trainee — a parent repeating themselves is not two. */
export function findOpenCheck(db, studentId) {
  return rows(db).find((row) => String(row.student_id || '') === String(studentId)
    && row.status !== CENTRE_CHECK_CONFIRMED) || null;
}

/** Pending trainees the follow-up may still ask about. A parent report closes the question. */
export function studentsStillAwaitingRegistration(db, students = []) {
  return (students || []).filter((student) => String(student?.status || '') === 'pending_signup'
    && !findOpenCheck(db, student.id));
}

/** The parent's report is recorded, but it is not a verified seat yet. */
async function markPlacementReported({ db, persist, student, now }) {
  if (!student?.id) return;
  const updated = db.update?.('students', student.id, {
    placement_hold_firm: false,
    placement_hold_until: null,
    placement_reported_at: new Date(now).toISOString(),
  });
  if (updated && typeof persist === 'function') await persist('students', updated);
}

export async function recordParentReport({ db, persist, student, parent, now = new Date() } = {}) {
  if (!student?.id) return { ok: false, error: 'אין מתאמן' };
  await markPlacementReported({ db, persist, student, now });
  const existing = findOpenCheck(db, student.id);
  if (existing) return { ok: true, row: existing, duplicate: true };
  const row = db.insert(CENTRE_CHECK_COLLECTION, {
    id: `crc_${student.id}_${Date.now()}`,
    student_id: student.id,
    student_name: student.name || '',
    parent_id: parent?.id || null,
    phone: parent?.phone || '',
    status: CENTRE_CHECK_REPORTED,
    reported_at: now.toISOString(),
    asked_at: null,
    rounds: 0,
    created_at: now.toISOString(),
  });
  if (persist) await persist(CENTRE_CHECK_COLLECTION, row);
  return { ok: true, row };
}

/** Sunday 08:00 — and Tuesday, for whoever came back unanswered. */
export function isDigestTime(now = new Date()) {
  const { weekday, hour } = israelParts(now);
  return hour === DIGEST_HOUR && (weekday === SUNDAY || weekday === TUESDAY);
}

/**
 * Everyone the digest should carry: fresh reports, plus the ones already asked
 * about that nobody has confirmed. Sending twice on the same day is the thing
 * the date stamp prevents — a restart must not wake Carmit again.
 */
export function dueForDigest(db, now = new Date()) {
  const today = israelParts(now).dateKey;
  return rows(db).filter((row) => {
    if (row.status === CENTRE_CHECK_CONFIRMED) return false;
    if (String(row.asked_on || '') === today) return false;
    return row.status === CENTRE_CHECK_REPORTED
      || row.status === CENTRE_CHECK_ASKED
      || row.status === CENTRE_CHECK_UNCONFIRMED;
  });
}

export function buildDigestMessage(list = []) {
  const names = list.map((row) => String(row.student_name || '').trim()).filter(Boolean);
  if (!names.length) return '';
  const lines = names.map((name) => `• ${name}`);
  return [
    'בוקר טוב כרמית 🙂',
    'ההורים של המתאמנים הבאים מסרו שהם השלימו את ההרשמה במתנ״ס:',
    '',
    ...lines,
    '',
    'אפשר לאשר מי מהם מופיע אצלכם כרשום? אפשר לענות בשם אחד בכל הודעה.',
  ].join('\n');
}

export async function markAsked({ db, persist, list = [], now = new Date() } = {}) {
  const today = israelParts(now).dateKey;
  const updated = [];
  for (const row of list) {
    const next = db.update(CENTRE_CHECK_COLLECTION, row.id, {
      status: CENTRE_CHECK_ASKED,
      asked_at: now.toISOString(),
      asked_on: today,
      rounds: Number(row.rounds || 0) + 1,
    }) || row;
    if (persist) await persist(CENTRE_CHECK_COLLECTION, next);
    updated.push(next);
  }
  return updated;
}

/** Carmit named this trainee: the loop for them is over. */
export async function markConfirmed({ db, persist, studentId, now = new Date() } = {}) {
  const row = findOpenCheck(db, studentId);
  if (!row) return null;
  const next = db.update(CENTRE_CHECK_COLLECTION, row.id, {
    status: CENTRE_CHECK_CONFIRMED,
    confirmed_at: now.toISOString(),
  }) || row;
  if (persist) await persist(CENTRE_CHECK_COLLECTION, next);
  return next;
}

/**
 * Asked at least once and still unanswered: before asking Carmit again, ask the
 * parent. They may have meant a different מתנ״ס, or not finished after all —
 * and a second identical question to Carmit answers nothing.
 */
export function dueForParentRecheck(db, now = new Date()) {
  const today = israelParts(now).dateKey;
  return rows(db).filter((row) => row.status === CENTRE_CHECK_ASKED
    && Number(row.rounds || 0) >= 1
    && String(row.parent_asked_on || '') !== today
    && String(row.asked_on || '') !== today);
}

export async function markParentAsked({ db, persist, row, now = new Date() } = {}) {
  const next = db.update(CENTRE_CHECK_COLLECTION, row.id, {
    status: CENTRE_CHECK_UNCONFIRMED,
    parent_asked_at: now.toISOString(),
    parent_asked_on: israelParts(now).dateKey,
  }) || row;
  if (persist) await persist(CENTRE_CHECK_COLLECTION, next);
  return next;
}
