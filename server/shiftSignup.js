/**
 * "מי יכול לפתוח את הקיר ביום שלישי?" — the WhatsApp poll, as a form.
 *
 * A signup window is one question put to the staff: a set of concrete shifts
 * (date + hours + how many people are needed), open to whoever holds a given
 * role. Employees tick what suits them through a public link, and the answers
 * land next to the roster instead of in a chat thread that has to be copied by
 * hand.
 *
 * Two deliberate limits keep this honest:
 *
 * - A tick is availability, never a placement. The shift is only staffed once
 *   the manager turns a tick into a `work_assignments` row, which is what the
 *   calendar, the reminders and the payroll all read. Nothing here writes pay.
 * - Whether a shift is already staffed is derived from those rows rather than
 *   stored again, so a placement removed from the roster shows up as open here
 *   without a second bookkeeping step.
 */

import {
  activityDateRange,
  getGroupDays,
  israelDateStr,
  isTrainingVacationDate,
} from './attendanceUtils.js';

export const SIGNUP_TABLE = 'shift_signup_windows';
export const RESPONSE_TABLE = 'shift_signup_responses';

export const WINDOW_STATUSES = ['open', 'closed'];

/** Same set the roster uses — a window produces rows of exactly these types. */
export const SIGNUP_WORK_TYPES = ['counter_shift', 'class_shift', 'private_shift', 'route_building_shift'];

/**
 * Which kind of roster row a calendar entry becomes. Anything not listed is a
 * counter shift — the same fallback the calendar screen already uses when it
 * places staff on an entry.
 */
const WORK_TYPE_BY_ACTIVITY_TYPE = {
  route_building: 'route_building_shift',
  personal_training: 'private_shift',
};

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanText(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function cleanTime(value) {
  const text = cleanText(value, 5);
  if (!HM.test(text)) return null;
  const [h, m] = text.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${m}`;
}

function cleanDate(value) {
  const text = String(value ?? '').slice(0, 10);
  return DATE.test(text) ? text : null;
}

/**
 * כמה מהמשמרות שסומנו העובד באמת רוצה.
 *
 * סימון הוא אופציה, ורוב האנשים מסמנים בנדיבות — כל מה שהם *יכולים*. בלי המספר
 * הזה „סימן שבע” נקרא כמו בקשה לשבע משמרות, והמנהל מגלה רק בדיעבד שהכוונה
 * הייתה לשתיים. אפס פירושו „לא אמר”, ואז מספר הסימונים הוא כל מה שיש.
 */
function cleanWantedCount(value, pickedCount = 0) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return 0;
  // בקשה ליותר משמרות ממה שסומן היא סתירה: אי אפשר לקבל משמרת שלא סומנה.
  return Math.min(n, pickedCount || n);
}

/** 0 = Sunday … 6 = Saturday, from a civil date (noon UTC is safe in Israel). */
export function weekdayOf(dateStr) {
  const day = cleanDate(dateStr);
  if (!day) return null;
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

/**
 * A slot's id is its own date and start time. Editing a window then keeps the
 * ticks that already point at a shift, and only genuinely new shifts get new
 * ids — an incrementing index would have re-pointed every tick one shift over
 * as soon as a day was removed from the middle.
 *
 * A slot taken from the calendar also carries what it staffs, because two
 * classes can start at 16:00 on the same afternoon and they are not one shift.
 */
export function slotId(date, startTime, ownerId = '') {
  return ownerId ? `${date}@${startTime}#${ownerId}` : `${date}@${startTime}`;
}

/**
 * מה משמרת צריכה: „מפעיל קיר אחד ושני עוזרי מדריך”.
 *
 * זה מה שהחליף את `capacity` — מספר יחיד שאמר כמה אנשים צריך בלי לומר לְמה.
 * משמרת פתיחה צריכה מפעיל קיר *וגם* עוזר מדריך, ושני עוזרי מדריך אינם תחליף
 * למפעיל הקיר החסר. בלי הפירוט הזה „שובצו 2 מתוך 2” היה יכול להיות שני אנשים
 * באותו תפקיד ומשמרת שאי אפשר לפתוח איתה את הקיר.
 *
 * התפקיד נשמר כתווית ולא כמפתח, כי זה מה שכל שאר המערכת שומרת: ההסמכות של
 * העובד, שורת העבודה, ושורת התעריף בהסכם השכר. שינוי שם תפקיד מטופל במקום
 * אחד — `propagateRoleRename` — ולא בהמרה בכל קריאה.
 */
export function normalizeNeeds(raw, fallbackCount = 1) {
  const list = Array.isArray(raw) ? raw : [];
  const byRole = new Map();
  for (const entry of list) {
    const role = cleanText(entry?.role, 60);
    if (!role) continue;
    const count = Math.max(1, Math.min(20, Math.round(Number(entry?.count) || 1)));
    // אותו תפקיד פעמיים הוא ספירה אחת, לא שתי שורות: „עוזר מדריך 1” ועוד
    // „עוזר מדריך 2” הם שלושה עוזרים.
    byRole.set(role, (byRole.get(role) || 0) + count);
  }
  const needs = [...byRole].map(([role, count]) => ({ role, count: Math.min(20, count) }));
  if (needs.length) return needs;
  // משמרת בלי פירוט תפקידים עדיין צריכה אנשים. תפקיד ריק פירושו „מי שמתאים”,
  // וזו גם הצורה שאליה נופלת משמרת שנוצרה לפני שהתפקידים נכנסו.
  return [{ role: '', count: Math.max(1, Math.min(20, Math.round(Number(fallbackCount) || 1))) }];
}

/** כמה אנשים המשמרת צריכה בסך הכול — סכום כל התפקידים. */
export function slotCapacity(slot) {
  return (slot?.needs || []).reduce((sum, need) => sum + (Number(need.count) || 0), 0)
    || Number(slot?.capacity) || 1;
}

export function normalizeSlot(raw = {}) {
  const date = cleanDate(raw.date);
  const start = cleanTime(raw.start_time);
  const end = cleanTime(raw.end_time);
  if (!date) return { error: 'לכל משמרת צריך תאריך תקין' };
  if (!start || !end) return { error: `למשמרת של ${date} צריך שעת התחלה וסיום` };
  if (end <= start) return { error: `במשמרת של ${date} שעת הסיום מוקדמת מההתחלה` };
  const needs = normalizeNeeds(raw.needs, raw.capacity);
  const activityId = cleanText(raw.activity_id, 60) || null;
  const groupId = cleanText(raw.group_id, 60) || null;
  return {
    slot: {
      id: slotId(date, start, activityId || groupId || ''),
      date,
      start_time: start,
      end_time: end,
      needs,
      label: cleanText(raw.label, 60),
      // מה שהמשמרת הזאת מאיישת ביומן, כשהיא נבחרה משם. השיבוץ שייווצר ממנה
      // ייקשר לאותה שורה — וזה מה שמחבר אותו לנוכחות ולתמחור, במקום להישאר
      // משמרת מרחפת שבמקרה יש לה אותו תאריך.
      activity_id: activityId,
      group_id: groupId,
      // חוג ובניית מסלולים אינם אותו סוג שורה ביומן העבודה. כשהמשמרת נבחרה
      // מהיומן היא יודעת מה היא, וזה גובר על ברירת המחדל של הטופס.
      work_type: SIGNUP_WORK_TYPES.includes(raw.work_type) ? raw.work_type : null,
    },
  };
}

/**
 * Turn "every Sunday and Tuesday, 15:30–18:00, from here to there" into the
 * concrete shifts the form shows. The manager thinks in a weekly pattern; the
 * employee has to answer about a specific date.
 */
export function expandWeeklySlots({
  from,
  to,
  weekdays = [],
  start_time: startTime,
  end_time: endTime,
  needs = null,
  capacity = 1,
  label = '',
} = {}) {
  const first = cleanDate(from);
  const last = cleanDate(to);
  const start = cleanTime(startTime);
  const end = cleanTime(endTime);
  const days = [...new Set((Array.isArray(weekdays) ? weekdays : [])
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
  if (!first || !last) return { error: 'צריך טווח תאריכים תקין' };
  if (last < first) return { error: 'תאריך הסיום מוקדם מתאריך ההתחלה' };
  if (!days.length) return { error: 'צריך לבחור לפחות יום אחד בשבוע' };
  if (!start || !end) return { error: 'צריך שעת התחלה ושעת סיום' };
  if (end <= start) return { error: 'שעת הסיום מוקדמת מההתחלה' };

  const slots = [];
  // 92 days is a quarter — a signup window longer than that is a mistake, and
  // the guard also stops a malformed range from looping forever.
  for (let cursor = new Date(`${first}T12:00:00Z`), guard = 0; guard < 92; guard += 1) {
    const day = cursor.toISOString().slice(0, 10);
    if (day > last) break;
    if (days.includes(cursor.getUTCDay())) {
      const { slot } = normalizeSlot({
        date: day, start_time: start, end_time: end, needs, capacity, label,
      });
      if (slot) slots.push(slot);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  if (!slots.length) return { error: 'אין אף תאריך בטווח שמתאים לימים שנבחרו' };
  return { slots };
}

/**
 * A calendar entry that was called off — or filed away — is not a shift anyone
 * can be offered. `archived` belongs here for the same reason `cancelled` does:
 * an entry the office has finished with should not turn up in a form asking the
 * team who is free for it. Without this an archived five-day camp went on
 * producing five candidates a fortnight after it ended.
 */
function isCancelledActivity(activity) {
  if (!activity) return true;
  if (activity.cancelled || activity.archived) return true;
  const status = String(activity.status || '').toLowerCase();
  return status === 'cancelled' || status === 'canceled' || status === 'archived';
}

/** The synthetic type id every weekly class carries in the candidate list. */
export const CLASS_SOURCE_TYPE = 'class';

/**
 * מה משמרת ביומן צריכה, לפי סדר יורד של מי יודע טוב יותר.
 *
 * הרשומה עצמה קודמת: מנהל שכתב על אירוע „מפעיל קיר אחד ושני עוזרים” אמר בדיוק
 * מה הוא צריך. אחריה סוג הפעילות — „שעות פתיחה מאוישות בהפעלת קיר” — שהוא ניחוש
 * סביר בהיעדר מידע. ובסוף תפקיד ריק, שפירושו „מי שמתאים”: עדיף להציע משמרת בלי
 * לדעת מה היא צריכה מאשר לא להציע אותה בכלל.
 */
export function needsForActivity(activity, rolesByType, type) {
  const explicit = normalizeNeeds(activity?.staff_needs, 0);
  if (explicit[0]?.role) return explicit;
  if (activity?.staff_role) return [{ role: cleanText(activity.staff_role, 60), count: 1 }];
  const byType = rolesByType?.[type];
  if (Array.isArray(byType) && byType.length) {
    return byType.map((role) => ({ role: cleanText(role, 60), count: 1 })).filter((n) => n.role);
  }
  return [{ role: '', count: 1 }];
}

/**
 * מה כבר מאויש בכל תפקיד בנפרד.
 *
 * „כבר 1” על משמרת שצריכה מפעיל קיר ושני עוזרים לא אומר דבר — לא ברור מי מהם
 * כבר יש. הפירוט לכל תפקיד הוא מה שהמנהל שוקל כשהוא מחליט אם בכלל להציע את
 * המשמרת, ולכן הוא נשלח לצדו של מה שהיא צריכה.
 */
function staffingOf(needs, assignments, where) {
  return needs.map((need) => ({
    role: need.role,
    count: need.count,
    staffed: Math.min(
      need.count,
      staffedCount(assignments, { ...where, role: need.role || null })
    ),
  }));
}

/** How many people already hold this exact calendar slot in the given role. */
function staffedCount(assignments, { date, startTime, activityId, groupId, role }) {
  return (assignments || []).filter((row) => {
    if (String(row.date || '').slice(0, 10) !== date) return false;
    if (role && row.role && row.role !== role) return false;
    if (activityId && row.activity_id === activityId) return true;
    if (groupId && row.group_id === groupId) return true;
    // A row typed in by hand carries neither id — the hours are what identify it.
    if (row.activity_id || row.group_id) return false;
    return String(row.start_time || '').slice(0, 5) === startTime;
  }).length;
}

function addOneDay(dateStr) {
  const next = new Date(`${dateStr}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The shifts already sitting in the calendar, offered as signup candidates.
 *
 * Two sources, because the gym schedules in two ways: one-off entries in the
 * calendar (events, trips, opening hours, route building) and the weekly class
 * grid. Both already carry their date and hours, so the manager picks rather
 * than retypes — and the resulting placement points back at the entry it
 * staffs, which is what ties it to attendance and to the right rate.
 *
 * Anything already fully staffed is still returned, marked with how many it has,
 * so "why is Tuesday missing from the list?" never has to be asked.
 *
 * ## Why nothing is filtered by role any more
 *
 * A window used to be addressed to one role, and the candidate list was filtered
 * to what that role staffs. It read as a broken screen: the owner asked for
 * "עוזר מדריך", every opening-hours shift vanished — they are staffed by
 * "הפעלת קיר" — and the list came back empty over a calendar that was full.
 *
 * A shift now carries the roles *it* needs, and the form goes to the whole team.
 * Nothing is removed on the way in, so an empty list here means an empty range,
 * which is the only thing an empty list should ever mean. The per-type counts
 * stay, because "40 of these are classes" is still worth knowing before asking.
 *
 * @param {string[]|null} types `source_type` ids to offer (`class` for the weekly
 *   grid). Null or empty means every type — the behaviour before the picker.
 */
export function calendarSlotCandidates({
  activities = [],
  groups = [],
  assignments = [],
  rolesByType = {},
  classRoles = [],
  from,
  to,
  types = null,
} = {}) {
  const first = cleanDate(from);
  const last = cleanDate(to);
  if (!first || !last) return { error: 'צריך טווח תאריכים תקין' };
  if (last < first) return { error: 'תאריך הסיום מוקדם מתאריך ההתחלה' };

  const wanted = Array.isArray(types) && types.length
    ? new Set(types.map((t) => cleanText(t, 60)).filter(Boolean))
    : null;
  const candidates = [];
  // Entries the manager can see in the calendar but cannot offer, because a
  // shift without hours has nothing to sign up for. Reported rather than hidden.
  let withoutHours = 0;

  const stats = new Map();
  const count = (type, key, by = 1) => {
    if (!stats.has(type)) {
      stats.set(type, { id: type, total: 0, without_hours: 0 });
    }
    stats.get(type)[key] += by;
  };

  for (const activity of activities) {
    const type = String(activity?.type || '').toLowerCase();
    if (type === 'training_vacation') continue;
    if (isCancelledActivity(activity)) continue;

    const days = activityDateRange(activity).filter((day) => day >= first && day <= last);
    if (!days.length) continue;

    // Counted before the type filter runs: this is what the range actually
    // holds, and it is the number the picker shows next to the type.
    count(type, 'total', days.length);

    const start = cleanTime(activity.start_time);
    const end = cleanTime(activity.end_time);
    // A type the manager turned off is still counted — the picker shows how much
    // each type holds, so turning one on is an informed choice rather than a
    // guess — but it must not inflate the "entries without hours" line the
    // screen prints, which is about what was offered.
    const offered = !wanted || wanted.has(type);
    if (!start || !end || end <= start) {
      count(type, 'without_hours', days.length);
      if (offered) withoutHours += 1;
      continue;
    }
    if (!offered) continue;

    const needs = needsForActivity(activity, rolesByType, type);
    for (const date of days) {
      candidates.push({
        // The same id the slot will carry once the window is created, so a tick
        // in the picker and a tick in the form are talking about one shift.
        id: slotId(date, start, activity.id || ''),
        date,
        start_time: start,
        end_time: end,
        needs,
        staffing: staffingOf(needs, assignments, { date, startTime: start, activityId: activity.id }),
        label: cleanText(activity.name, 60),
        activity_id: activity.id || null,
        group_id: null,
        work_type: WORK_TYPE_BY_ACTIVITY_TYPE[type] || 'counter_shift',
        source: 'activity',
        source_type: type,
        staffed: staffedCount(assignments, {
          date, startTime: start, activityId: activity.id,
        }),
      });
    }
  }

  // The weekly class grid is not part of the calendar screen at all — it lives
  // on its own screen — so it is one more entry in the type picker rather than
  // something mixed in by default. Seventeen classes over a fortnight are forty
  // shifts, and they buried the five the manager had actually come for.
  {
    for (const group of groups) {
      const weekdays = getGroupDays(group);
      const start = cleanTime(group?.time);
      if (!weekdays.length) continue;

      const dates = [];
      for (let date = first; date <= last; date = addOneDay(date)) {
        if (!weekdays.includes(weekdayOf(date))) continue;
        // A training vacation cancels the class, so there is no shift to offer.
        if (isTrainingVacationDate(activities, date)) continue;
        dates.push(date);
      }
      if (!dates.length) continue;
      count(CLASS_SOURCE_TYPE, 'total', dates.length);

      const offeredClass = !wanted || wanted.has(CLASS_SOURCE_TYPE);
      if (!start) {
        count(CLASS_SOURCE_TYPE, 'without_hours', dates.length);
        if (offeredClass) withoutHours += 1;
        continue;
      }
      const minutes = Math.max(15, Math.round(Number(group.duration) || 50));
      const [h, m] = start.split(':').map(Number);
      const endMinutes = h * 60 + m + minutes;
      // A class that would run past midnight is a data error, not a night shift.
      if (endMinutes >= 24 * 60) {
        count(CLASS_SOURCE_TYPE, 'without_hours', dates.length);
        if (offeredClass) withoutHours += 1;
        continue;
      }
      const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

      if (!offeredClass) continue;

      // חוג צריך מי שמדריך אותו. `classRoles` הם התפקידים שיכולים לקחת חוג,
      // והראשון שבהם הוא ההדרכה עצמה — עוזר מדריך הוא תוספת, לא תחליף.
      const classNeeds = classRoles.length
        ? [{ role: cleanText(classRoles[0], 60), count: 1 }]
        : [{ role: '', count: 1 }];

      for (const date of dates) {
        candidates.push({
          id: slotId(date, start, group.id || ''),
          date,
          start_time: start,
          end_time: end,
          needs: classNeeds,
          staffing: staffingOf(classNeeds, assignments, { date, startTime: start, groupId: group.id }),
          label: cleanText(group.name, 60),
          activity_id: null,
          group_id: group.id || null,
          work_type: 'class_shift',
          source: 'group',
          source_type: CLASS_SOURCE_TYPE,
          staffed: staffedCount(assignments, {
            date, startTime: start, groupId: group.id,
          }),
        });
      }
    }
  }

  candidates.sort((a, b) => (
    a.date === b.date
      ? (a.start_time === b.start_time ? a.label.localeCompare(b.label, 'he') : a.start_time.localeCompare(b.start_time))
      : a.date.localeCompare(b.date)
  ));
  // Sorted by how much each type holds: the picker reads top-down, and the type
  // with forty shifts in it is the one worth seeing first.
  const byType = [...stats.values()].sort((a, b) => b.total - a.total);
  return { candidates, withoutHours, byType };
}

/** Short, unguessable, and readable enough to be dictated over the phone. */
export function newSignupToken() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 12; i += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return token;
}

/**
 * מי מקבל את הקישור. רשימה ריקה פירושה „כל הצוות” — הטופס מציע לכל אחד את
 * התפקידים שהוא מחזיק, ולכן אין סיבה לצמצם אותו מראש. רשימה מפורשת גוברת:
 * המנהל שבחר שלושה שמות התכוון לשלושה.
 */
function cleanRecipients(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((id) => cleanText(id, 60)).filter(Boolean))].slice(0, 200);
}

export function normalizeWindow(body = {}, { existing = null } = {}) {
  const title = cleanText(body.title ?? existing?.title, 80);
  if (!title) return { error: 'צריך שם לטופס (למשל „משמרות פתיחה — שבוע הבא”)' };

  const recipients = body.recipients !== undefined
    ? cleanRecipients(body.recipients)
    : cleanRecipients(existing?.recipients);

  const workType = SIGNUP_WORK_TYPES.includes(body.work_type)
    ? body.work_type
    : (existing?.work_type || 'counter_shift');

  const status = WINDOW_STATUSES.includes(body.status)
    ? body.status
    : (existing?.status || 'open');

  const rawSlots = Array.isArray(body.slots) ? body.slots : (existing?.slots || []);
  const slots = [];
  const seen = new Set();
  for (const raw of rawSlots) {
    const { slot, error } = normalizeSlot(raw);
    if (error) return { error };
    if (seen.has(slot.id)) continue;
    seen.add(slot.id);
    slots.push(slot);
  }
  if (!slots.length) return { error: 'צריך להוסיף לפחות משמרת אחת לטופס' };
  slots.sort((a, b) => (a.date === b.date ? a.start_time.localeCompare(b.start_time) : a.date.localeCompare(b.date)));

  const deadlineRaw = body.deadline !== undefined ? body.deadline : existing?.deadline;
  const deadline = deadlineRaw ? cleanDate(deadlineRaw) : null;

  return {
    window: {
      title,
      recipients,
      work_type: workType,
      status,
      deadline,
      note: cleanText(body.note !== undefined ? body.note : existing?.note, 400),
      slots,
      token: existing?.token || newSignupToken(),
    },
  };
}

/**
 * Closed is closed, but a window also closes itself the day after its deadline
 * — otherwise every window ever opened stays answerable forever, and a late
 * tick looks like a commitment nobody planned around.
 */
export function isWindowOpen(windowRow, today = israelDateStr()) {
  if (!windowRow) return false;
  if (windowRow.status !== 'open') return false;
  if (windowRow.deadline && today > windowRow.deadline) return false;
  // A window whose last shift is already in the past has nothing left to answer.
  const lastDate = (windowRow.slots || []).reduce((max, s) => (s.date > max ? s.date : max), '');
  return !lastDate || lastDate >= today;
}

export function responsesForWindow(responses = [], windowId) {
  return (responses || []).filter((r) => r.window_id === windowId);
}

/** התפקידים שהעובד מסומן בהם. אותה רשימה שהרוסטר מסנן לפיה. */
export function rolesOfEmployee(employee) {
  const raw = Array.isArray(employee?.certifications) ? employee.certifications : [];
  return raw.map((r) => cleanText(r, 60)).filter(Boolean);
}

/** האם העובד יכול לקחת את התפקיד הזה. תפקיד ריק פירושו „מי שמתאים”. */
export function canFillRole(employee, role) {
  if (!role) return true;
  return rolesOfEmployee(employee).includes(cleanText(role, 60));
}

/** מפתח אחיד לזוג משמרת-תפקיד, בשרת ובמסך. */
export function seatKey(slotId, role) {
  return `${slotId}|${role || ''}`;
}

/** „משמרת + תפקיד” → כמה עובדים סימנו אותו. */
export function seatTickCounts(windowRow, responses = []) {
  const counts = new Map();
  for (const response of responses) {
    for (const pick of response.picks || []) {
      const key = seatKey(pick.slot_id, pick.role);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * What the public form shows.
 *
 * Every shift lists the roles it needs, and the employee claims one of them.
 * How many have already claimed a seat is shown but never enforced: telling
 * someone "this is full, don't offer" throws away the reserve the manager wants
 * when a first choice falls through.
 */
export function publicWindowView(windowRow, responses = [], today = israelDateStr()) {
  const counts = seatTickCounts(windowRow, responses);
  return {
    title: windowRow.title,
    note: windowRow.note || '',
    deadline: windowRow.deadline || null,
    open: isWindowOpen(windowRow, today),
    slots: (windowRow.slots || [])
      .filter((slot) => slot.date >= today)
      .map((slot) => ({
        ...slot,
        needs: (slot.needs || []).map((need) => ({
          ...need,
          taken: counts.get(seatKey(slot.id, need.role)) || 0,
        })),
      })),
  };
}

/**
 * A submission replaces whatever that employee said before, rather than adding
 * a second answer. Re-opening the link is how someone changes their mind, and
 * two rows for one person would read as two people on the board.
 *
 * A pick is a shift *and a role*: someone who holds four roles — and eight of
 * the twenty-three do — cannot be placed from a tick alone. They are telling us
 * which hat they are coming in, and that is what decides the rate they are paid.
 *
 * The role is checked twice over: it must be a role the shift actually needs,
 * and one the employee is marked for. A form that let anyone claim any seat
 * would put an unqualified person on the wall.
 */
export function applyResponse(windowRow, responses = [], payload = {}, {
  today = israelDateStr(),
  employee = null,
} = {}) {
  if (!windowRow) return { error: 'הטופס לא נמצא' };
  if (!isWindowOpen(windowRow, today)) return { error: 'ההרשמה לטופס הזה נסגרה' };

  const employeeId = cleanText(payload.employee_id, 60);
  if (!employeeId) return { error: 'צריך לבחור מי ממלא את הטופס' };

  const slotsById = new Map((windowRow.slots || [])
    .filter((s) => s.date >= today)
    .map((s) => [s.id, s]));

  const picks = [];
  const seenSlots = new Set();
  for (const raw of Array.isArray(payload.picks) ? payload.picks : []) {
    const slot = slotsById.get(cleanText(raw?.slot_id, 60));
    if (!slot) continue;
    // אותה משמרת פעמיים היא עדיין משמרת אחת: אי אפשר לעבוד בשני תפקידים
    // באותה שעה, והבחירה השנייה היא תיקון של הראשונה.
    if (seenSlots.has(slot.id)) continue;
    const role = cleanText(raw?.role, 60);
    if (!(slot.needs || []).some((need) => (need.role || '') === role)) continue;
    if (employee && !canFillRole(employee, role)) continue;
    seenSlots.add(slot.id);
    picks.push({ slot_id: slot.id, role });
  }

  const existing = responses.find(
    (r) => r.window_id === windowRow.id && r.employee_id === employeeId
  ) || null;

  return {
    record: {
      ...(existing || {}),
      window_id: windowRow.id,
      employee_id: employeeId,
      employee_name: cleanText(payload.employee_name, 80) || existing?.employee_name || '',
      picks,
      wanted_count: cleanWantedCount(payload.wanted_count, picks.length),
      note: cleanText(payload.note, 300),
      submitted_at: new Date().toISOString(),
    },
    existing,
    // Zero picks is a real answer ("none of these suit me") and is stored as
    // such — it is the difference between a "no" and someone who never replied.
    cleared: picks.length === 0,
  };
}

/**
 * Who the window is addressed to.
 *
 * The whole team, unless the manager named names. It used to be "whoever holds
 * this one role", which is what made the form useless: a shift needs a wall
 * operator *and* an assistant, and eight of the twenty-three staff hold four
 * roles each — there is no single role that addresses them. Each person now
 * sees the shifts and claims a seat in a role they are marked for, so the
 * narrowing happens where the knowledge is.
 *
 * Their roles ride along, because the public form has to show each person only
 * the seats they can actually take.
 */
export function eligibleEmployees(employees = [], recipients = []) {
  const named = new Set(cleanRecipients(recipients).map(String));
  return (employees || [])
    .filter((employee) => employee?.is_active !== false && employee?.active !== false)
    .filter((employee) => !named.size || named.has(String(employee.id)))
    .map((employee) => ({
      id: employee.id,
      name: employee.name || 'עובד/ת',
      roles: rolesOfEmployee(employee),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

/**
 * מי כבר משובץ למשמרת הזאת, בכל תפקיד.
 * שורות רוסטר מזוהות לפי מה שהן מאיישות, לא לפי השעה: שני חוגים יכולים להתחיל
 * באותה שעה, ואת שעות האירוע אפשר לערוך אחרי ששיבצו אליו.
 */
function assignmentsForSlot(assignments = [], slot) {
  return (assignments || []).filter((row) => {
    if (String(row.date || '').slice(0, 10) !== slot.date) return false;
    if (slot.activity_id) return row.activity_id === slot.activity_id;
    if (slot.group_id) return row.group_id === slot.group_id;
    if (row.activity_id || row.group_id) return false;
    return String(row.start_time || '').slice(0, 5) === slot.start_time;
  });
}

/**
 * The roster row that already holds this employee for this exact shift, if any.
 * A slot that names what it staffs is matched by that, not by the clock: two
 * classes can start at the same hour, and the hours of a calendar entry can be
 * edited after someone was already placed on it.
 */
export function findSlotAssignment(assignments = [], employeeId, slot) {
  const sameDay = (assignments || []).filter(
    (row) => row.employee_id === employeeId
      && String(row.date || '').slice(0, 10) === slot.date
  );
  if (slot.activity_id) return sameDay.find((row) => row.activity_id === slot.activity_id) || null;
  if (slot.group_id) return sameDay.find((row) => row.group_id === slot.group_id) || null;
  return sameDay.find((row) => String(row.start_time || '').slice(0, 5) === slot.start_time) || null;
}

export function isSlotAssigned(assignments = [], employeeId, slot) {
  return Boolean(findSlotAssignment(assignments, employeeId, slot));
}

/**
 * מסך האישור: שורה לכל משמרת, ובתוכה שורה לכל תפקיד שהיא צריכה.
 *
 * זו הצורה שהמנהל שואל בה. „שובצו 2 מתוך 3” אינו מספיק כשהשלושה הם מפעיל קיר
 * ושני עוזרים — שני עוזרים ואף מפעיל אינם משמרת שאפשר לפתוח איתה את הקיר. לכן
 * כל מושב נספר בנפרד: כמה צריך, מי ביקש אותו, ומי כבר מחזיק בו.
 *
 * מי שכבר משובץ ברוסטר נספר גם אם לא ענה לטופס — שיבוץ ידני מהיומן הוא עדיין
 * שיבוץ, ומשמרת שנראית ריקה בגללו היא מלכודת.
 */
export function signupBoard(windowRow, responses = [], employees = [], assignments = []) {
  const rows = responsesForWindow(responses, windowRow.id);
  const byId = new Map((employees || []).map((e) => [String(e.id), e]));
  const nameOf = (employeeId) => byId.get(String(employeeId))?.name
    || rows.find((r) => r.employee_id === employeeId)?.employee_name
    || 'עובד/ת';

  return (windowRow.slots || []).map((slot) => {
    const placed = assignmentsForSlot(assignments, slot);
    const seatRoles = (slot.needs || []).map((need) => need.role || '');
    // שיבוץ שהתפקיד שלו אינו אחד ממושבי המשמרת — שורה ותיקה מהיומן, או תפקיד
    // ששמו שונה מאז. הוא נספר במושב הראשון ולא נעלם: אדם שכבר משובץ ואינו
    // מופיע כאן הוא בדיוק המקרה שגורם לשלוח שניים למקום של אחד.
    const homeFor = (row) => (seatRoles.includes(row.role || '') ? (row.role || '') : seatRoles[0] ?? '');

    const seats = (slot.needs || []).map((need, index) => {
      const role = need.role || '';
      const held = placed.filter((row) => homeFor(row) === role
        && (seatRoles.includes(row.role || '') || index === 0));
      const claimed = rows
        .filter((r) => (r.picks || []).some((p) => p.slot_id === slot.id && (p.role || '') === role));

      const entryFor = (employeeId, answer, assignment) => ({
        employee_id: employeeId,
        name: nameOf(employeeId),
        note: answer?.note || '',
        submitted_at: answer?.submitted_at || null,
        // כמה משמרות סימן בסך הכול וכמה הוא באמת רוצה — שניהם נדרשים בכל
        // שורה, כי המסך עובד משמרת-משמרת ולא עובד-עובד.
        picked_count: (answer?.picks || []).length,
        wanted_count: Number(answer?.wanted_count) || 0,
        assigned: Boolean(assignment),
        // מי שמשובץ בלי שענה — שובץ מהיומן, וזה מה שהתווית אומרת במסך.
        answered: Boolean(answer),
        // נשמר כדי שאפשר יהיה לבטל שיבוץ מיד, בלי סיבוב נוסף לשרת.
        assignment_id: assignment?.id || null,
        role: assignment?.role || role,
      });

      const seen = new Set();
      const claimants = [];
      for (const answer of claimed) {
        const assignment = held.find((row) => String(row.employee_id) === String(answer.employee_id));
        seen.add(String(answer.employee_id));
        claimants.push(entryFor(answer.employee_id, answer, assignment));
      }
      // ואז מי שמשובץ ולא ענה. אלה לא "מועמדים" אלא עובדה קיימת, ולכן הם
      // נכנסים לאותה שורה — המסך צריך להראות מי על המשמרת, לא מי מילא טופס.
      for (const row of held) {
        if (seen.has(String(row.employee_id))) continue;
        seen.add(String(row.employee_id));
        claimants.push(entryFor(row.employee_id, null, row));
      }
      claimants.sort((a, b) => {
        if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
        return String(a.submitted_at).localeCompare(String(b.submitted_at));
      });

      return {
        role,
        needed: need.count,
        assigned: held.length,
        claimants,
        missing: Math.max(0, need.count - held.length),
      };
    });
    return {
      ...slot,
      seats,
      capacity: slotCapacity(slot),
      assigned_count: seats.reduce((sum, seat) => sum + seat.assigned, 0),
      missing: seats.reduce((sum, seat) => sum + seat.missing, 0),
    };
  });
}

/** Everyone who answered, with what they are still waiting to hear about. */
export function respondentSummary(windowRow, responses = [], employees = [], assignments = []) {
  const slotsById = new Map((windowRow.slots || []).map((s) => [s.id, s]));
  return responsesForWindow(responses, windowRow.id).map((response) => {
    const picked = (response.picks || []).map((p) => slotsById.get(p.slot_id)).filter(Boolean);
    const employee = (employees || []).find((e) => e.id === response.employee_id);
    return {
      employee_id: response.employee_id,
      name: employee?.name || response.employee_name || 'עובד/ת',
      note: response.note || '',
      submitted_at: response.submitted_at || null,
      picked: picked.length,
      wanted: Number(response.wanted_count) || 0,
      // באילו תפקידים הוא ביקש לבוא — מה שהופך „סימן 3” למידע שאפשר לפעול לפיו.
      roles: [...new Set((response.picks || []).map((p) => p.role).filter(Boolean))],
      assigned: picked.filter((slot) => isSlotAssigned(assignments, response.employee_id, slot)).length,
    };
  });
}

// ─── אישור השיבוצים ─────────────────────────────────────────────────────────

/**
 * להפוך סימונים לשיבוצים — כל הטופס בפעולה אחת.
 *
 * המסך הקודם שיבץ בכל לחיצה על שם, וזה הפך כל טופס לעשרים החלטות נפרדות שאי
 * אפשר לראות יחד: מי קיבל יותר מדי, למי הבטחנו שתיים ונתנו אחת, ואיזו משמרת
 * עדיין ריקה. כאן המנהל מסמן טיוטה שלמה, רואה את החריגות, ומאשר פעם אחת —
 * ורק אז נכתבות השורות ונשלחות ההודעות.
 *
 * מה שנבנה כאן הוא בדיוק שורות `work_assignments`, כי זו הטבלה שממנה מחושבים
 * גם היומן, גם התזכורות וגם השכר. אין כאן מסלול תשלום נפרד.
 *
 * התפקיד בא מהמושב שאושר, לא מהטופס: הוא מה שקובע את התעריף בהסכם השכר, ולכן
 * אותו עובד באותו ערב שווה סכום אחר כמפעיל קיר ואחר כעוזר מדריך.
 *
 * @param {object} windowRow הטופס
 * @param {Array<{slot_id: string, employee_id: string, role: string}>} picks טיוטת השיבוץ
 * @param {object} options `assignments` — מה שכבר קיים ברוסטר, `today`
 * @returns {{ rows: Array<{assignment: object, slot: object, role: string}>, skipped: object[], error?: string }}
 *   `rows` — מה שצריך להיווצר, כל אחד עם המשמרת שממנה נגזר (ההודעה לעובד
 *   צריכה את השם והשעות, ושורת רוסטר לא נושאת אותם); `skipped` — מי שכבר
 *   משובץ לאותה משמרת או שהמשמרת שלו כבר עברה.
 */
export function planAssignments(windowRow, picks = [], { assignments = [], today = israelDateStr() } = {}) {
  if (!windowRow) return { rows: [], skipped: [], error: 'הטופס לא נמצא' };
  const slotsById = new Map((windowRow.slots || []).map((s) => [s.id, s]));
  const rows = [];
  const skipped = [];
  const seen = new Set();

  for (const pick of Array.isArray(picks) ? picks : []) {
    const slot = slotsById.get(cleanText(pick?.slot_id, 60));
    const employeeId = cleanText(pick?.employee_id, 60);
    if (!slot || !employeeId) continue;
    // אותו עובד באותה משמרת פעמיים — לחיצה כפולה, לא שתי משמרות. גם אם התפקיד
    // שונה: אי אפשר לעבוד בשני תפקידים באותה שעה.
    const key = `${slot.id}|${employeeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // משמרת שכבר עברה אינה שיבוץ אלא תיקון היסטוריה, וזה נעשה ביומן העבודה.
    if (slot.date < today) {
      skipped.push({ slot_id: slot.id, employee_id: employeeId, reason: 'past' });
      continue;
    }
    if (isSlotAssigned(assignments, employeeId, slot)) {
      skipped.push({ slot_id: slot.id, employee_id: employeeId, reason: 'already' });
      continue;
    }
    // תפקיד שהמשמרת לא צריכה אינו מושב. נופלים לתפקיד הראשון שהיא כן צריכה,
    // כדי ששיבוץ לא ייווצר בלי תעריף.
    const wanted = cleanText(pick?.role, 60);
    const role = (slot.needs || []).some((need) => (need.role || '') === wanted)
      ? wanted
      : (slot.needs || [])[0]?.role || '';
    rows.push({
      slot,
      role,
      assignment: {
        employee_id: employeeId,
        date: slot.date,
        start_time: slot.start_time,
        end_time: slot.end_time,
        activity_id: slot.activity_id || null,
        group_id: slot.group_id || null,
        work_type: slot.work_type || windowRow.work_type || 'counter_shift',
        role: role || null,
        source: 'shift_signup',
      },
    });
  }
  return { rows, skipped };
}

/**
 * חריגות שהמנהל צריך לראות *לפני* שהוא מאשר, לא אחרי.
 *
 * שתיהן חוקיות ולכן אינן שגיאה: משמרת שקיבלה יותר אנשים מהדרוש היא לפעמים
 * חפיפה מכוונת, ועובד שמקבל יותר ממה שביקש הוא לפעמים בדיוק מה שסוכם בטלפון.
 * התפקיד כאן הוא להגיד את זה בקול, לא לחסום.
 */
export function planWarnings(windowRow, picks = [], { responses = [], assignments = [], employees = [] } = {}) {
  const slotsById = new Map((windowRow?.slots || []).map((s) => [s.id, s]));
  const nameOf = (employeeId) => (employees || []).find((e) => e.id === employeeId)?.name
    || (responses || []).find((r) => r.employee_id === employeeId)?.employee_name
    || 'עובד/ת';
  const perSeat = new Map();
  const perEmployee = new Map();

  for (const pick of Array.isArray(picks) ? picks : []) {
    const slot = slotsById.get(String(pick?.slot_id || ''));
    const employeeId = String(pick?.employee_id || '');
    if (!slot || !employeeId) continue;
    const key = seatKey(slot.id, pick?.role);
    if (!perSeat.has(key)) perSeat.set(key, { slot, role: pick?.role || '', ids: new Set() });
    perSeat.get(key).ids.add(employeeId);
    perEmployee.set(employeeId, (perEmployee.get(employeeId) || 0) + 1);
  }

  const warnings = [];
  // האזהרה היא על המושב ולא על המשמרת: שלושה אנשים למשמרת שצריכה שלושה הם
  // תקינים, אבל שלושתם כעוזרי מדריך ובלי מפעיל קיר אינם משמרת שאפשר לפתוח.
  for (const { slot, role, ids } of perSeat.values()) {
    const need = (slot.needs || []).find((n) => (n.role || '') === role);
    if (!need) continue;
    // מי שכבר משובץ ברוסטר בתפקיד הזה ואינו בטיוטה נספר גם הוא — אחרת מושב
    // שכבר תפוס ייראה פנוי, ושני אנשים יגיעו למקום של אחד.
    const outside = assignmentsForSlot(assignments, slot)
      .filter((row) => !ids.has(String(row.employee_id)) && (row.role || '') === role)
      .length;
    const total = ids.size + outside;
    if (total > need.count) {
      warnings.push({
        type: 'over_capacity',
        slot_id: slot.id,
        role,
        text: `${whenText(slot)}${role ? ` · ${role}` : ''} — ${total} אנשים למקום של ${need.count}`,
      });
    }
  }
  for (const [employeeId, count] of perEmployee) {
    const wanted = Number((responses || []).find((r) => r.employee_id === employeeId)?.wanted_count) || 0;
    if (wanted && count > wanted) {
      warnings.push({
        type: 'over_wanted',
        employee_id: employeeId,
        text: `${nameOf(employeeId)} — ${count} משמרות, ביקש ${wanted}`,
      });
    }
  }
  return warnings;
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** „יום ג׳, 5.8 · 16:00–20:00” — איך משמרת נקראת בהודעה ובאזהרה. */
export function whenText(slot = {}) {
  const [y, m, d] = String(slot.date || '').split('-').map(Number);
  if (!y) return '';
  const weekday = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const hours = [slot.start_time, slot.end_time].filter(Boolean).join('–');
  return `יום ${weekday}, ${d}.${m}${hours ? ` · ${hours}` : ''}`;
}

/**
 * ההודעה שכל עובד מקבל אחרי האישור — כל המשמרות שלו בהודעה אחת.
 *
 * אחת ולא אחת-לכל-משמרת: מי שקיבל ארבע משמרות ומקבל עליהן ארבע הודעות נפרדות
 * לא יודע מה סך הכול קיבל, וזו בדיוק השאלה שהוא שואל.
 */
export function assignmentMessageText(windowRow, seats = []) {
  const lines = (seats || [])
    .slice()
    .map((entry) => (entry?.slot ? entry : { slot: entry, role: '' }))
    .sort((a, b) => (a.slot.date === b.slot.date
      ? String(a.slot.start_time).localeCompare(String(b.slot.start_time))
      : String(a.slot.date).localeCompare(String(b.slot.date))))
    // התפקיד בשורה, כי הוא מה שהעובד צריך לדעת לפני שהוא מגיע: אותה שעה
    // כמפעיל קיר וכעוזר מדריך היא לא אותה משמרת.
    .map(({ slot, role }) => `• ${whenText(slot)}${slot.label ? ` · ${slot.label}` : ''}${role ? ` · ${role}` : ''}`);
  // שורה ריקה בין החלקים היא מה שהופך את זה להודעה ולא לגוש. `filter(Boolean)`
  // על מערך שורות היה בולע אותה, ולכן החלקים מורכבים בנפרד ורק אז מחוברים.
  const head = ['📋 השיבוץ שלך', windowRow?.title].filter(Boolean).join('\n');
  return [head, lines.join('\n'), 'אם משהו לא מסתדר — תכתבו לי כאן.']
    .filter(Boolean)
    .join('\n\n');
}
