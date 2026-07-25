/** Current weekday (0=Sunday) and HH:mm in Asia/Jerusalem. */
export function israelClockParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[parts.find((p) => p.type === 'weekday')?.value] ?? date.getDay();
  let hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // en-US hour12:false can still yield "24" for midnight in some engines
  if (hour === '24') hour = '00';
  return { weekday, time: `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` };
}

function parseHm(value, fallback) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Master switch — when off, no automated WhatsApp/Instagram replies are sent. */
export function isBotEnabled(settings = {}) {
  const value = settings.aiResponderEnabled;
  if (value === true || value === false) return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return false;
}

/** Whether the AI bot should auto-reply right now (Israel time). */
export function shouldAiAutoReply(settings = {}, { ignoreSchedule = false } = {}) {
  if (!isBotEnabled(settings)) return false;
  if (ignoreSchedule || !settings.aiActiveHoursEnabled) return true;

  const { weekday, time } = israelClockParts();
  const days = Array.isArray(settings.aiActiveDays) && settings.aiActiveDays.length
    ? settings.aiActiveDays.map(Number)
    : [0, 1, 2, 3, 4, 5, 6];
  if (!days.includes(weekday)) return false;

  const start = parseHm(settings.aiActiveHoursStart, '09:00');
  const end = parseHm(settings.aiActiveHoursEnd, '21:00');
  if (start <= end) return time >= start && time < end;
  // Overnight window, e.g. 22:00–06:00
  return time >= start || time < end;
}
