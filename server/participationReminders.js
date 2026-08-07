import crypto from 'crypto';

const TIME_ZONE = 'Asia/Jerusalem';

function dateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value);
}

function calendarDayNumber(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

export function daysUntilActivity(activity, now = new Date()) {
  const activityKey = String(activity?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityKey)) return null;
  return calendarDayNumber(activityKey) - calendarDayNumber(dateKey(now));
}

export function scheduledReminderKind(activity, now = new Date()) {
  const days = daysUntilActivity(activity, now);
  if (days === 3) return 'three_days_before';
  if (days === 1) return 'one_day_before';
  return null;
}

/**
 * A health declaration expires on 31 August, so the month's notice is a window
 * and not a date: any run from 1 August finds the same families. One row per
 * student per season keeps a restart, or a second run the same day, from
 * sending twice.
 */
export function healthExpiryReminderKind(expiresAt, now = new Date()) {
  const expiryKey = String(expiresAt || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryKey)) return null;
  const days = calendarDayNumber(expiryKey) - calendarDayNumber(dateKey(now));
  if (days < 0 || days > 30) return null;
  return `health_expiry_${expiryKey}`;
}

/**
 * Tells families whose declaration is about to lapse, while it is still valid.
 *
 * Deliberately not a warning about documents that already expired — those are
 * caught at registration and at check-in. This pass exists so a family renews
 * before a class is refused, not after.
 */
export async function runHealthExpiryReminders({
  db, persist, send, healthState, now = new Date(),
} = {}) {
  const students = db.get('students') || [];
  const sentRows = db.get('participation_reminders') || [];
  const summary = { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  for (const student of students) {
    if (student?.status && ['inactive', 'archived', 'left'].includes(String(student.status))) continue;
    const state = healthState(student);
    if (!state?.valid || !state.expiresAt) continue;
    const kind = healthExpiryReminderKind(state.expiresAt, now);
    if (!kind) continue;
    summary.candidates += 1;
    const duplicate = sentRows.find((row) => (
      String(row.student_id) === String(student.id) && row.kind === kind && row.status === 'sent'
    ));
    if (duplicate) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await send({ student, expiresAt: state.expiresAt, kind });
      if (!result?.sent) {
        summary.failed += 1;
        continue;
      }
      const row = db.insert('participation_reminders', {
        id: `pr_${crypto.randomUUID()}`,
        registration_id: null,
        activity_id: null,
        student_id: student.id,
        kind,
        status: 'sent',
        sent_via: result.via || null,
        sent_at: new Date().toISOString(),
      });
      if (persist) await persist('participation_reminders', row);
      summary.sent += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export async function runParticipationDocumentReminders({ db, persist, send, now = new Date() } = {}) {
  const registrations = db.get('activity_registrations') || [];
  const activities = db.get('activities') || [];
  const sentRows = db.get('participation_reminders') || [];
  const summary = { candidates: 0, sent: 0, skipped: 0, failed: 0 };

  for (const registration of registrations) {
    if (!['pending_profile', 'awaiting_documents', 'blocked_health'].includes(registration.document_status)) continue;
    if (['cancelled', 'refunded', 'completed'].includes(registration.status)) continue;
    const activity = activities.find((row) => String(row.id) === String(registration.activity_id));
    const kind = scheduledReminderKind(activity, now);
    if (!kind) continue;
    summary.candidates += 1;
    const duplicate = sentRows.find((row) => (
      String(row.registration_id) === String(registration.id) && row.kind === kind && row.status === 'sent'
    ));
    if (duplicate) {
      summary.skipped += 1;
      continue;
    }
    try {
      const result = await send({ registration, activity, kind });
      if (!result?.sent) {
        summary.failed += 1;
        continue;
      }
      const row = db.insert('participation_reminders', {
        id: `pr_${crypto.randomUUID()}`,
        registration_id: registration.id,
        activity_id: activity.id,
        student_id: registration.student_id || null,
        kind,
        status: 'sent',
        sent_via: result.via || null,
        sent_at: new Date().toISOString(),
      });
      if (persist) await persist('participation_reminders', row);
      summary.sent += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
