// Shared schedule / attendance helpers (RTL Hebrew gym calendar)

// Hebrew day-letter → weekday index (0=ראשון … 5=שישי)
export const HEB_DAY_IDX = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };

// A group may meet twice a week. Such groups encode both days in the name,
// e.g. "מתקדמים ה'-ו' — ב׳+ה׳ 15:30". Return every weekday the group meets.
export function getGroupDays(group) {
  const m = (group?.name || '').match(/([א-ו])['׳’]?\s*\+\s*([א-ו])['׳’]?/);
  if (m) {
    const days = [HEB_DAY_IDX[m[1]], HEB_DAY_IDX[m[2]]].filter((d) => d != null);
    if (days.length) return [...new Set([group.day, ...days])].filter((d) => d != null);
  }
  return [group?.day].filter((d) => d != null);
}

/** Local YYYY-MM-DD (Israel-safe; avoids UTC day-shift from toISOString). */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Weekday index (0=Sunday) for a YYYY-MM-DD string. */
export function dateToWeekday(dateStr) {
  if (!dateStr) return new Date().getDay();
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? new Date().getDay() : d.getDay();
}

// Canonical attendance statuses (schema + Notion מעקב נוכחות).
// Auto-created rows start as "pending" (ממתין למילוי); trainer marks attended/absent.
export const ATT_STATUS = [
  { key: 'pending', label: 'ממתין למילוי', color: '#3B82F6' },
  { key: 'attended', label: 'הגיע', color: '#10B981' },
  { key: 'absent', label: 'נעדר', color: '#EF4444' },
  { key: 'intro_attended', label: 'הכירות ✓', color: '#6366F1' },
  { key: 'intro_absent', label: 'הכירות ✗', color: '#A78BFA' },
];

export const ATT_MARK_KEYS = ['attended', 'absent'];
export const ATT_PRESENT_KEYS = new Set(['attended', 'present', 'intro_attended', 'late']);
export const ATT_ABSENT_KEYS = new Set(['absent', 'intro_absent']);

export function normalizeAttStatus(status) {
  if (status === 'present' || status === 'late') return 'attended';
  if (ATT_STATUS.some((s) => s.key === status)) return status;
  return 'pending';
}

export function isAttPresent(status) {
  return ATT_PRESENT_KEYS.has(status);
}

export function isAttPending(status) {
  return normalizeAttStatus(status) === 'pending';
}

export function attStatusMeta(status) {
  const key = normalizeAttStatus(status);
  return ATT_STATUS.find((s) => s.key === key) || ATT_STATUS[0];
}
