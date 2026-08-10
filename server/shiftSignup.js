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

export function normalizeSlot(raw = {}) {
  const date = cleanDate(raw.date);
  const start = cleanTime(raw.start_time);
  const end = cleanTime(raw.end_time);
  if (!date) return { error: 'לכל משמרת צריך תאריך תקין' };
  if (!start || !end) return { error: `למשמרת של ${date} צריך שעת התחלה וסיום` };
  if (end <= start) return { error: `במשמרת של ${date} שעת הסיום מוקדמת מההתחלה` };
  const capacity = Math.max(1, Math.min(20, Math.round(Number(raw.capacity) || 1)));
  const activityId = cleanText(raw.activity_id, 60) || null;
  const groupId = cleanText(raw.group_id, 60) || null;
  return {
    slot: {
      id: slotId(date, start, activityId || groupId || ''),
      date,
      start_time: start,
      end_time: end,
      capacity,
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
      const { slot } = normalizeSlot({ date: day, start_time: start, end_time: end, capacity, label });
      if (slot) slots.push(slot);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  if (!slots.length) return { error: 'אין אף תאריך בטווח שמתאים לימים שנבחרו' };
  return { slots };
}

/** A calendar entry that was called off is not a shift anyone can be offered. */
function isCancelledActivity(activity) {
  if (!activity) return true;
  if (activity.cancelled) return true;
  const status = String(activity.status || '').toLowerCase();
  return status === 'cancelled' || status === 'canceled';
}

/**
 * Roles a calendar type accepts. An empty (or missing) list means the type was
 * never restricted, so it stays open to everyone rather than silently offering
 * nothing.
 */
function typeAcceptsRole(rolesByType, type, role) {
  const allowed = rolesByType?.[type];
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  return allowed.includes(role);
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
 * Anything already fully staffed for this role is still returned, marked with
 * how many it has, so "why is Tuesday missing from the list?" never has to be
 * asked.
 */
export function calendarSlotCandidates({
  activities = [],
  groups = [],
  assignments = [],
  rolesByType = {},
  classRoles = [],
  role = '',
  from,
  to,
  capacity = 1,
} = {}) {
  const first = cleanDate(from);
  const last = cleanDate(to);
  if (!first || !last) return { error: 'צריך טווח תאריכים תקין' };
  if (last < first) return { error: 'תאריך הסיום מוקדם מתאריך ההתחלה' };

  const wantedRole = cleanText(role, 60);
  const defaultCapacity = Math.max(1, Math.min(20, Math.round(Number(capacity) || 1)));
  const candidates = [];
  // Entries the manager can see in the calendar but cannot offer, because a
  // shift without hours has nothing to sign up for. Reported rather than hidden.
  let withoutHours = 0;

  for (const activity of activities) {
    const type = String(activity?.type || '').toLowerCase();
    if (type === 'training_vacation') continue;
    if (isCancelledActivity(activity)) continue;
    if (!typeAcceptsRole(rolesByType, type, wantedRole)) continue;

    const days = activityDateRange(activity).filter((day) => day >= first && day <= last);
    if (!days.length) continue;

    const start = cleanTime(activity.start_time);
    const end = cleanTime(activity.end_time);
    if (!start || !end || end <= start) {
      withoutHours += 1;
      continue;
    }

    for (const date of days) {
      candidates.push({
        // The same id the slot will carry once the window is created, so a tick
        // in the picker and a tick in the form are talking about one shift.
        id: slotId(date, start, activity.id || ''),
        date,
        start_time: start,
        end_time: end,
        capacity: defaultCapacity,
        label: cleanText(activity.name, 60),
        activity_id: activity.id || null,
        group_id: null,
        work_type: WORK_TYPE_BY_ACTIVITY_TYPE[type] || 'counter_shift',
        source: 'activity',
        source_type: type,
        staffed: staffedCount(assignments, {
          date, startTime: start, activityId: activity.id, role: wantedRole,
        }),
      });
    }
  }

  const classesAllowed = classRoles.length === 0 || classRoles.includes(wantedRole);
  if (classesAllowed) {
    for (const group of groups) {
      const weekdays = getGroupDays(group);
      const start = cleanTime(group?.time);
      if (!weekdays.length) continue;
      if (!start) {
        withoutHours += 1;
        continue;
      }
      const minutes = Math.max(15, Math.round(Number(group.duration) || 50));
      const [h, m] = start.split(':').map(Number);
      const endMinutes = h * 60 + m + minutes;
      // A class that would run past midnight is a data error, not a night shift.
      if (endMinutes >= 24 * 60) {
        withoutHours += 1;
        continue;
      }
      const end = `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

      for (let date = first; date <= last; date = addOneDay(date)) {
        const weekday = weekdayOf(date);
        if (!weekdays.includes(weekday)) continue;
        // A training vacation cancels the class, so there is no shift to offer.
        if (isTrainingVacationDate(activities, date)) continue;
        candidates.push({
          id: slotId(date, start, group.id || ''),
          date,
          start_time: start,
          end_time: end,
          capacity: defaultCapacity,
          label: cleanText(group.name, 60),
          activity_id: null,
          group_id: group.id || null,
          work_type: 'class_shift',
          source: 'group',
          source_type: 'class',
          staffed: staffedCount(assignments, {
            date, startTime: start, groupId: group.id, role: wantedRole,
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
  return { candidates, withoutHours };
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

export function normalizeWindow(body = {}, { existing = null } = {}) {
  const title = cleanText(body.title ?? existing?.title, 80);
  if (!title) return { error: 'צריך שם לטופס (למשל „משמרות פתיחה — שבוע הבא”)' };

  const role = cleanText(body.role !== undefined ? body.role : existing?.role, 60);
  if (!role) return { error: 'צריך לבחור לאיזה תפקיד הטופס פונה' };

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
      role,
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

/** slotId → how many employees ticked it. */
export function slotTickCounts(windowRow, responses = []) {
  const counts = new Map();
  for (const slot of windowRow?.slots || []) counts.set(slot.id, 0);
  for (const response of responses) {
    for (const id of response.slot_ids || []) {
      if (counts.has(id)) counts.set(id, counts.get(id) + 1);
    }
  }
  return counts;
}

/**
 * What the public form shows. Capacity is displayed but never enforced on the
 * employee: telling someone "the shift is full, don't offer" throws away the
 * reserve the manager wants when a first choice falls through.
 */
export function publicWindowView(windowRow, responses = [], today = israelDateStr()) {
  const counts = slotTickCounts(windowRow, responses);
  return {
    title: windowRow.title,
    role: windowRow.role,
    note: windowRow.note || '',
    deadline: windowRow.deadline || null,
    open: isWindowOpen(windowRow, today),
    slots: (windowRow.slots || [])
      .filter((slot) => slot.date >= today)
      .map((slot) => ({ ...slot, taken: counts.get(slot.id) || 0 })),
  };
}

/**
 * A submission replaces whatever that employee said before, rather than adding
 * a second answer. Re-opening the link is how someone changes their mind, and
 * two rows for one person would read as two people on the board.
 */
export function applyResponse(windowRow, responses = [], payload = {}, { today = israelDateStr() } = {}) {
  if (!windowRow) return { error: 'הטופס לא נמצא' };
  if (!isWindowOpen(windowRow, today)) return { error: 'ההרשמה לטופס הזה נסגרה' };

  const employeeId = cleanText(payload.employee_id, 60);
  if (!employeeId) return { error: 'צריך לבחור מי ממלא את הטופס' };

  const valid = new Set((windowRow.slots || []).filter((s) => s.date >= today).map((s) => s.id));
  const picked = [...new Set((Array.isArray(payload.slot_ids) ? payload.slot_ids : []).map((id) => cleanText(id, 40)))]
    .filter((id) => valid.has(id));

  const existing = responses.find(
    (r) => r.window_id === windowRow.id && r.employee_id === employeeId
  ) || null;

  return {
    record: {
      ...(existing || {}),
      window_id: windowRow.id,
      employee_id: employeeId,
      employee_name: cleanText(payload.employee_name, 80) || existing?.employee_name || '',
      slot_ids: picked,
      note: cleanText(payload.note, 300),
      submitted_at: new Date().toISOString(),
    },
    existing,
    // Zero picks is a real answer ("none of these suit me") and is stored as
    // such — it is the difference between a "no" and someone who never replied.
    cleared: picked.length === 0,
  };
}

/**
 * Who the window is addressed to. The role lives on the employee's
 * `certifications` list — the same marks the roster already filters by — so a
 * window for "עוזר מדריך" reaches exactly the people the schedule screen would
 * have offered for that slot, and nobody has to keep a second list in step.
 */
export function eligibleEmployees(employees = [], role) {
  const wanted = cleanText(role, 60);
  return (employees || [])
    .filter((employee) => employee?.is_active !== false && employee?.active !== false)
    .filter((employee) => !wanted || (Array.isArray(employee.certifications) ? employee.certifications : [])
      .map((r) => cleanText(r, 60))
      .includes(wanted))
    .map((employee) => ({ id: employee.id, name: employee.name || 'עובד/ת' }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
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
 * The manager's view: one row per shift, with who offered and who is already
 * placed. `eligible` is the staff the window was addressed to, so a name that
 * lost the role since answering still shows up rather than silently vanishing.
 */
export function signupBoard(windowRow, responses = [], employees = [], assignments = []) {
  const rows = responsesForWindow(responses, windowRow.id);
  const nameOf = (employeeId) => {
    const employee = (employees || []).find((e) => e.id === employeeId);
    return employee?.name || rows.find((r) => r.employee_id === employeeId)?.employee_name || 'עובד/ת';
  };
  return (windowRow.slots || []).map((slot) => {
    const signed = rows
      .filter((r) => (r.slot_ids || []).includes(slot.id))
      .map((r) => {
        const assignment = findSlotAssignment(assignments, r.employee_id, slot);
        return {
          employee_id: r.employee_id,
          name: nameOf(r.employee_id),
          note: r.note || '',
          submitted_at: r.submitted_at || null,
          assigned: Boolean(assignment),
          // Carried so the board can undo a placement it just made, without a
          // second round trip to find the row again.
          assignment_id: assignment?.id || null,
        };
      })
      .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
    return {
      ...slot,
      signed,
      assigned_count: signed.filter((s) => s.assigned).length,
      missing: Math.max(0, slot.capacity - signed.filter((s) => s.assigned).length),
    };
  });
}

/** Everyone who answered, with what they are still waiting to hear about. */
export function respondentSummary(windowRow, responses = [], employees = [], assignments = []) {
  const slotsById = new Map((windowRow.slots || []).map((s) => [s.id, s]));
  return responsesForWindow(responses, windowRow.id).map((response) => {
    const picked = (response.slot_ids || []).map((id) => slotsById.get(id)).filter(Boolean);
    const employee = (employees || []).find((e) => e.id === response.employee_id);
    return {
      employee_id: response.employee_id,
      name: employee?.name || response.employee_name || 'עובד/ת',
      note: response.note || '',
      submitted_at: response.submitted_at || null,
      picked: picked.length,
      assigned: picked.filter((slot) => isSlotAssigned(assignments, response.employee_id, slot)).length,
    };
  });
}
