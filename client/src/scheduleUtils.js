// Shared schedule / attendance helpers (RTL Hebrew gym calendar)

// Hebrew day-letter → weekday index (0=ראשון … 5=שישי)
export const HEB_DAY_IDX = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };

export const HEB_WEEKDAY_LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

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

// Canonical attendance statuses — aligned with Notion «נוכחות» select.
// Auto-created rows start as "pending" (ממתין למילוי); trainer marks the rest.
export const ATT_STATUS = [
  {
    key: 'pending',
    label: 'ממתין למילוי',
    shortLabel: 'ממתין',
    color: '#EAB308',
    bg: 'rgba(234, 179, 8, 0.12)',
    border: 'rgba(234, 179, 8, 0.35)',
    icon: 'hourglass',
  },
  {
    key: 'attended',
    label: 'הגיע',
    shortLabel: 'הגיע',
    color: '#34D399',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(52, 211, 153, 0.4)',
    icon: 'check',
  },
  {
    key: 'absent',
    label: 'לא הגיע',
    shortLabel: 'לא הגיע',
    color: '#F87171',
    bg: 'rgba(239, 68, 68, 0.14)',
    border: 'rgba(248, 113, 113, 0.4)',
    icon: 'x',
  },
  {
    key: 'makeup',
    label: 'השלים באימון חליפי',
    shortLabel: 'חליפי',
    color: '#38BDF8',
    bg: 'rgba(14, 165, 233, 0.14)',
    border: 'rgba(56, 189, 248, 0.4)',
    icon: 'refresh',
  },
  {
    key: 'holiday',
    label: 'יום חג',
    shortLabel: 'יום חג',
    color: '#C084FC',
    bg: 'rgba(168, 85, 247, 0.14)',
    border: 'rgba(192, 132, 252, 0.4)',
    icon: 'party',
  },
  {
    key: 'cancelled',
    label: 'אימון בוטל',
    shortLabel: 'בוטל',
    color: '#FB923C',
    bg: 'rgba(249, 115, 22, 0.12)',
    border: 'rgba(251, 146, 60, 0.35)',
    icon: 'ban',
  },
  {
    key: 'saturday_makeup',
    label: 'השלים בשבת',
    shortLabel: 'שבת',
    color: '#A8A29E',
    bg: 'rgba(168, 162, 158, 0.12)',
    border: 'rgba(168, 162, 158, 0.35)',
    icon: 'candle',
  },
  {
    key: 'intro_attended',
    label: 'הכירות ✓',
    shortLabel: 'הכירות ✓',
    color: '#818CF8',
    bg: 'rgba(99, 102, 241, 0.14)',
    border: 'rgba(129, 140, 248, 0.4)',
    icon: 'check',
  },
  {
    key: 'intro_absent',
    label: 'הכירות ✗',
    shortLabel: 'הכירות ✗',
    color: '#A78BFA',
    bg: 'rgba(167, 139, 250, 0.14)',
    border: 'rgba(167, 139, 250, 0.4)',
    icon: 'x',
  },
];

export const ATT_FUTURE = {
  key: 'future',
  label: 'עתיד',
  shortLabel: 'עתיד',
  color: 'rgba(148, 163, 184, 0.55)',
  bg: 'rgba(100, 116, 139, 0.12)',
  border: 'rgba(100, 116, 139, 0.25)',
  icon: 'lock',
};

/** Statuses trainers can mark on a regular (non-intro) kid. */
export const ATT_MARK_KEYS = ['attended', 'absent', 'makeup', 'holiday'];

export const ATT_PRESENT_KEYS = new Set([
  'attended',
  'present',
  'intro_attended',
  'late',
  'makeup',
  'saturday_makeup',
]);

export const ATT_ABSENT_KEYS = new Set(['absent', 'intro_absent']);

export function normalizeAttStatus(status) {
  if (status === 'present' || status === 'late') return 'attended';
  // Legacy / Notion-ish aliases
  if (status === 'alternate' || status === 'makeup_attended' || status === 'arrived_makeup') return 'makeup';
  if (status === 'חג' || status === 'holiday_day') return 'holiday';
  if (ATT_STATUS.some((s) => s.key === status)) return status;
  return 'pending';
}

export function isAttPresent(status) {
  return ATT_PRESENT_KEYS.has(normalizeAttStatus(status)) || ATT_PRESENT_KEYS.has(status);
}

export function isAttAbsent(status) {
  return ATT_ABSENT_KEYS.has(normalizeAttStatus(status)) || ATT_ABSENT_KEYS.has(status);
}

export function isAttPending(status) {
  return normalizeAttStatus(status) === 'pending';
}

export function attStatusMeta(status) {
  const key = normalizeAttStatus(status);
  return ATT_STATUS.find((s) => s.key === key) || ATT_STATUS[0];
}
