/**
 * תוקף מבחן אבטחה. שיקוף של server/safetyTestService.js — יש לשמור על סנכרון.
 *
 * מבחן תקף חצי שנה, והתוקף של כולם מתאפס ב-31 באוגוסט (פתיחת שנת חוגים).
 * התפוגה היא המוקדם מבין השניים.
 */

export const SAFETY_TEST_TYPE = 'security';
const SAFETY_VALID_MONTHS = 6;
const SAFETY_RESET_MONTH_DAY = [8, 31];

function utcDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

function parseDay(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return utcDay(Number(match[1]), Number(match[2]), Number(match[3]));
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return utcDay(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

/** אותו יום בחודש, כמה חודשים קדימה. 31.8 + 6 חודשים → 28/29.2. */
function addMonths(date, months) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return utcDay(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(date.getUTCDate(), lastDay));
}

/** ה-31 באוגוסט הבא *אחרי* התאריך — מבחן ביום האיפוס עצמו הוא מבחן טרי. */
function nextSafetyReset(date) {
  const [month, day] = SAFETY_RESET_MONTH_DAY;
  const thisYear = utcDay(date.getUTCFullYear(), month, day);
  return date.getTime() < thisYear.getTime() ? thisYear : utcDay(date.getUTCFullYear() + 1, month, day);
}

/** תאריך התפוגה של מבחן שנערך בתאריך הנתון, או null אם אין תאריך. */
export function safetyTestExpiry(testDate) {
  const taken = parseDay(testDate);
  if (!taken) return null;
  const halfYear = addMonths(taken, SAFETY_VALID_MONTHS);
  const reset = nextSafetyReset(taken);
  return halfYear.getTime() < reset.getTime() ? halfYear : reset;
}

function isPassedSafetyTest(test) {
  if ((test?.test_type || test?.testType) !== SAFETY_TEST_TYPE) return false;
  if (test?.passed === false) return false;
  return !test?.status || test.status === 'passed' || test.status === 'עבר';
}

function testDateOf(test) {
  return test?.test_date || test?.testDate || test?.date || test?.created_at || null;
}

/**
 * מצב מבחן האבטחה לפי היסטוריית המבחנים של מתאמן.
 * @returns {{state:'valid'|'expired'|'missing', expires_at:Date|null, test_date:string|null}}
 */
export function safetyTestStatus(tests = [], now = new Date()) {
  const passed = (Array.isArray(tests) ? tests : [])
    .filter((test) => isPassedSafetyTest(test) && testDateOf(test))
    .sort((a, b) => String(testDateOf(b)).localeCompare(String(testDateOf(a))));

  const latest = passed[0];
  if (!latest) return { state: 'missing', expires_at: null, test_date: null };

  const expiry = safetyTestExpiry(testDateOf(latest));
  const ref = parseDay(now) || new Date();
  return {
    state: expiry.getTime() > ref.getTime() ? 'valid' : 'expired',
    expires_at: expiry,
    test_date: String(testDateOf(latest)).slice(0, 10),
  };
}
