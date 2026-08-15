/**
 * שעות שקטות לדיוור — לילה, שבת וחגים, לפי שעון ישראל.
 *
 * A broadcast that lands at 02:00 or on Yom Kippur costs more than the message:
 * it is the kind of send that gets a number reported and its quality rating
 * dropped. The send path refuses to fire inside these windows and offers the
 * next allowed time instead.
 *
 * Holidays are the Torah-mandated rest days observed in Israel (one-day chag).
 * They are found with the built-in Hebrew calendar (Intl), by month *name* —
 * month numbers shift in leap years, names do not.
 */

const JERUSALEM = 'Asia/Jerusalem';

export const DEFAULT_QUIET_CONFIG = {
  nightStart: '21:00',
  nightEnd: '08:00',
  eveStart: '16:00', // ערב שבת/חג — מהשעה הזו נחשב שקט
  exitTime: '20:30', // צאת שבת/חג (קירוב קבוע)
  blockShabbat: true,
  blockHolidays: true,
};

/** Local Jerusalem wall-clock parts for an instant. */
export function jerusalemParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: JERUSALEM,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour.padStart(2, '0')}:${get('minute').padStart(2, '0')}`,
  };
}

/** Hebrew-calendar day+month (English month name, stable across leap years). */
function hebrewParts(date) {
  const parts = new Intl.DateTimeFormat('en-u-ca-hebrew', {
    timeZone: JERUSALEM,
    day: 'numeric',
    month: 'long',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  return { day: Number(get('day')), month: get('month') };
}

// יום חג מלא (שבתון) בישראל. שם החודש כפי ש-Intl מחזיר באנגלית.
const HOLIDAYS = [
  { month: 'Tishri', day: 1, name: 'ראש השנה' },
  { month: 'Tishri', day: 2, name: 'ראש השנה' },
  { month: 'Tishri', day: 10, name: 'יום כיפור' },
  { month: 'Tishri', day: 15, name: 'סוכות' },
  { month: 'Tishri', day: 22, name: 'שמחת תורה' },
  { month: 'Nisan', day: 15, name: 'פסח' },
  { month: 'Nisan', day: 21, name: 'שביעי של פסח' },
  { month: 'Sivan', day: 6, name: 'שבועות' },
];

export function holidayNameOn(date) {
  const { day, month } = hebrewParts(date);
  const hit = HOLIDAYS.find((h) => h.day === day && h.month === month);
  return hit ? hit.name : '';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why is this instant quiet (or '' when sending is allowed)?
 * Checked in precedence order: chag, shabbat, night.
 */
export function quietReasonAt(date = new Date(), config = {}) {
  const cfg = { ...DEFAULT_QUIET_CONFIG, ...config };
  const { weekday, time } = jerusalemParts(date);

  if (cfg.blockHolidays) {
    const today = holidayNameOn(date);
    // ביום החג עצמו: שקט עד צאת החג.
    if (today && time < cfg.exitTime) return `חג (${today})`;
    // ערב חג: מהשעה שנקבעה.
    const tomorrow = holidayNameOn(new Date(date.getTime() + DAY_MS));
    if (tomorrow && time >= cfg.eveStart) return `ערב חג (${tomorrow})`;
  }

  if (cfg.blockShabbat) {
    if (weekday === 5 && time >= cfg.eveStart) return 'ערב שבת';
    if (weekday === 6 && time < cfg.exitTime) return 'שבת';
  }

  // Night window may wrap midnight (21:00–08:00).
  const start = cfg.nightStart;
  const end = cfg.nightEnd;
  const inNight = start <= end ? (time >= start && time < end) : (time >= start || time < end);
  if (inNight) return 'שעות לילה';

  return '';
}

export function isQuietAt(date = new Date(), config = {}) {
  return !!quietReasonAt(date, config);
}

/**
 * The first allowed instant at or after `from`, scanning in 10-minute steps
 * (rounded up to a whole 10 minutes so the offer reads as a clock time).
 */
export function nextAllowedTime(from = new Date(), config = {}) {
  const step = 10 * 60 * 1000;
  let t = Math.ceil(from.getTime() / step) * step;
  // Two weeks bounds any chag+shabbat streak many times over.
  const limit = from.getTime() + 14 * DAY_MS;
  while (t < limit) {
    const candidate = new Date(t);
    if (!quietReasonAt(candidate, config)) return candidate;
    t += step;
  }
  return new Date(limit);
}

/** One call for the send path: {quiet, reason, nextAllowed}. */
export function quietStatus(date = new Date(), config = {}) {
  const reason = quietReasonAt(date, config);
  if (!reason) return { quiet: false, reason: '', nextAllowed: null };
  return {
    quiet: true,
    reason,
    nextAllowed: nextAllowedTime(date, config).toISOString(),
  };
}
