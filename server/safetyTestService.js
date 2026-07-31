/**
 * תוקף מבחן אבטחה.
 *
 * מבחן תקף חצי שנה, אבל התוקף של כולם מתאפס ב-31 באוגוסט — פתיחת שנת
 * חוגים חדשה. כלומר התפוגה היא המוקדם מבין השניים, ומ-31 באוגוסט כל
 * המועדון צריך מבחן חדש בלי קשר למתי נבחן.
 */

export const SAFETY_TEST_TYPE = 'security';
export const SAFETY_VALID_MONTHS = 6;
/** יום-חודש שבו התוקף מתאפס לכולם. */
export const SAFETY_RESET_MONTH_DAY = '08-31';

const DAY_MS = 86400000;

function utcDay(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

export function parseDay(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return utcDay(Number(match[1]), Number(match[2]), Number(match[3]));
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return utcDay(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function isoDay(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** אותו יום בחודש, כמה חודשים קדימה. 31.8 + 6 חודשים → 28/29.2. */
function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return utcDay(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(day, lastDay));
}

/**
 * ה-31 באוגוסט הבא *אחרי* התאריך הנתון. מבחן שנערך ביום האיפוס עצמו
 * הוא מבחן טרי — האיפוס מפקיע את הישנים, לא את מי שנבחן באותו יום.
 */
export function nextSafetyReset(fromDate) {
  const date = parseDay(fromDate) || parseDay(new Date());
  const [month, day] = SAFETY_RESET_MONTH_DAY.split('-').map(Number);
  const thisYear = utcDay(date.getUTCFullYear(), month, day);
  return date.getTime() < thisYear.getTime()
    ? thisYear
    : utcDay(date.getUTCFullYear() + 1, month, day);
}

/** תאריך התפוגה של מבחן שנערך בתאריך הנתון. */
export function safetyTestExpiry(testDate) {
  const taken = parseDay(testDate);
  if (!taken) return null;
  const halfYear = addMonths(taken, SAFETY_VALID_MONTHS);
  const reset = nextSafetyReset(taken);
  return halfYear.getTime() < reset.getTime() ? halfYear : reset;
}

function isSafetyTest(test) {
  return (test?.test_type || test?.testType) === SAFETY_TEST_TYPE;
}

function testDateOf(test) {
  return test?.test_date || test?.testDate || test?.date || test?.created_at || null;
}

function testPassed(test) {
  if (test?.passed === false) return false;
  if (test?.status && test.status !== 'passed' && test.status !== 'עבר') return false;
  return true;
}

/**
 * מצב מבחן האבטחה של מתאמן.
 * @returns {{state:'valid'|'expired'|'missing', expires_at:string|null,
 *   test_date:string|null, days_left:number|null, examiner:string|null}}
 */
export function safetyTestStatus(tests = [], refDate = new Date()) {
  const ref = parseDay(refDate) || parseDay(new Date());
  const passed = (Array.isArray(tests) ? tests : [])
    .filter((test) => isSafetyTest(test) && testPassed(test) && testDateOf(test))
    .sort((a, b) => String(testDateOf(b)).localeCompare(String(testDateOf(a))));

  const latest = passed[0];
  if (!latest) {
    return { state: 'missing', expires_at: null, test_date: null, days_left: null, examiner: null };
  }

  const testDate = isoDay(parseDay(testDateOf(latest)));
  const expiry = safetyTestExpiry(testDateOf(latest));
  const daysLeft = Math.floor((expiry.getTime() - ref.getTime()) / DAY_MS);
  return {
    state: daysLeft > 0 ? 'valid' : 'expired',
    expires_at: isoDay(expiry),
    test_date: testDate,
    days_left: daysLeft,
    examiner: latest.examiner || null,
  };
}
