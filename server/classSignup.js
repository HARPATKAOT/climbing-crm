/**
 * שיבוץ לחוגים — טופס בלי תאריכים.
 *
 * חוג אינו משמרת ביום מסוים. מי שמדריך את „ילדים ג׳-ד׳ ביום ג׳” מדריך אותו כל
 * השנה, ולכן השאלה לעובד אינה „מתי אתה פנוי” אלא „באילו חוגים אתה רוצה להיות”.
 * מכאן שני הבדלים מהותיים מהטופס של היומן:
 *
 * - למושב אין תאריך. הוא נגזר מהחוג עצמו, כך שעריכת הטופס — הוספת חוג או הסרתו
 *   — משאירה כל סימון קיים על מקומו.
 * - האישור אינו כותב שורות ליומן העבודה אלא את השיבוץ הקבוע על החוג
 *   (`trainer` / `assistants`), בדיוק כמו מדריך שמשובץ ידנית בלוח החוגים. משם
 *   הנוכחות והשכר מתגלגלים כמו תמיד, ואין שני מקומות שאומרים מי מדריך את החוג.
 *
 * המודול מקביל ל-`shiftSignup.js` ואינו משנה אותו: שם כל משמרת נושאת תאריך,
 * וההנחה הזאת מזינה בסוף שורת שכר. עדיף מודול שני על ריכוך של אותה הנחה.
 */

import {
  canFillRole,
  cleanText,
  normalizeNeeds,
  newSignupToken,
  responsesForWindow,
} from './shiftSignup.js';

export const CLASS_WINDOW_KIND = 'class_board';
export const CLASS_SEAT_PREFIX = 'class#';

/** מזהה המושב נגזר מהחוג בלבד — אין תאריך, ואין מה שיזוז בעריכה. */
export function classSeatId(groupId) {
  return `${CLASS_SEAT_PREFIX}${groupId}`;
}

export function normalizeClassSeat(raw = {}, { classRoles = [] } = {}) {
  const groupId = cleanText(raw.group_id, 60);
  if (!groupId) return { error: 'לכל מושב צריך חוג' };
  const day = Number(raw.day);
  const needs = normalizeNeeds(raw.needs, 0);
  return {
    seat: {
      id: classSeatId(groupId),
      group_id: groupId,
      label: cleanText(raw.label, 60),
      // היום והשעה נשמרים כדי שהטופס יוכל לצייר את הלוח בלי לשאול את השרת מה
      // מצב החוגים עכשיו — וכדי שטופס שנשלח יישאר עדות למה שנשאל.
      day: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0,
      time: cleanText(raw.time, 5),
      duration: Math.max(15, Math.min(300, Math.round(Number(raw.duration) || 50))),
      ageCategory: cleanText(raw.ageCategory, 40),
      needs: needs[0]?.role
        ? needs
        : (classRoles.length ? [{ role: cleanText(classRoles[0], 60), count: 1 }] : [{ role: '', count: 1 }]),
    },
  };
}

export function normalizeClassWindow(body = {}, { existing = null, classRoles = [] } = {}) {
  const title = cleanText(body.title ?? existing?.title, 80);
  if (!title) return { error: 'צריך שם לטופס' };

  const rawSeats = Array.isArray(body.seats) ? body.seats : (existing?.seats || []);
  const seats = [];
  const seen = new Set();
  for (const raw of rawSeats) {
    const { seat, error } = normalizeClassSeat(raw, { classRoles });
    if (error) return { error };
    if (seen.has(seat.id)) continue;
    seen.add(seat.id);
    seats.push(seat);
  }
  if (!seats.length) return { error: 'צריך לבחור לפחות חוג אחד' };
  seats.sort((a, b) => (a.day === b.day ? String(a.time).localeCompare(String(b.time)) : a.day - b.day));

  const recipients = Array.isArray(body.recipients)
    ? [...new Set(body.recipients.map((id) => cleanText(id, 60)).filter(Boolean))]
    : (existing?.recipients || []);

  const status = ['open', 'closed'].includes(body.status) ? body.status : (existing?.status || 'open');
  const deadlineRaw = body.deadline !== undefined ? body.deadline : existing?.deadline;
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(deadlineRaw || '')) ? String(deadlineRaw) : null;

  return {
    window: {
      kind: CLASS_WINDOW_KIND,
      title,
      recipients,
      status,
      deadline,
      note: cleanText(body.note !== undefined ? body.note : existing?.note, 400),
      seats,
      token: existing?.token || newSignupToken(),
    },
  };
}

/**
 * טופס חוגים נסגר על הסטטוס ועל התאריך האחרון לענות בלבד. אין לו „המשמרת
 * האחרונה עברה” — השיבוץ הוא לשנה, ואין תאריך שאחריו השאלה מתיישנת מעצמה.
 */
export function isClassWindowOpen(windowRow, today) {
  if (!windowRow) return false;
  if (windowRow.status !== 'open') return false;
  return !(windowRow.deadline && today > windowRow.deadline);
}

/** כמה סימנו כל מושב, לפי תפקיד. */
export function classSeatTicks(windowRow, responses = []) {
  const counts = new Map();
  for (const response of responsesForWindow(responses, windowRow.id)) {
    for (const pick of response.picks || []) {
      const key = `${pick.slot_id}|${pick.role || ''}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/** מה שהעובד רואה: הלוח, מה כל חוג צריך, וכמה כבר סימנו. */
export function publicClassBoardView(windowRow, responses = [], today) {
  const ticks = classSeatTicks(windowRow, responses);
  return {
    kind: CLASS_WINDOW_KIND,
    title: windowRow.title,
    note: windowRow.note || '',
    deadline: windowRow.deadline || null,
    open: isClassWindowOpen(windowRow, today),
    seats: (windowRow.seats || []).map((seat) => ({
      ...seat,
      needs: (seat.needs || []).map((need) => ({
        ...need,
        taken: ticks.get(`${seat.id}|${need.role || ''}`) || 0,
      })),
    })),
  };
}

/**
 * תשובה של עובד. אותה צורה בדיוק כמו בטופס היומן — `picks[].slot_id` מחזיק את
 * מזהה המושב — כך שהתשובות של שני סוגי הטפסים חיות באותה טבלה ובאותו מבנה.
 */
export function applyClassResponse(windowRow, responses = [], payload = {}, {
  today,
  employee = null,
} = {}) {
  if (!windowRow) return { error: 'הטופס לא נמצא' };
  if (!isClassWindowOpen(windowRow, today)) return { error: 'ההרשמה לטופס הזה נסגרה' };

  const employeeId = cleanText(payload.employee_id, 60);
  if (!employeeId) return { error: 'צריך לבחור מי ממלא את הטופס' };

  const seatsById = new Map((windowRow.seats || []).map((s) => [s.id, s]));
  const picks = [];
  const seen = new Set();
  for (const raw of Array.isArray(payload.picks) ? payload.picks : []) {
    const seat = seatsById.get(cleanText(raw?.slot_id, 60));
    if (!seat) continue;
    // חוג אחד ותפקיד אחד: אי אפשר להיות גם המדריך וגם העוזר של אותה קבוצה.
    if (seen.has(seat.id)) continue;
    const role = cleanText(raw?.role, 60);
    if (!(seat.needs || []).some((need) => (need.role || '') === role)) continue;
    // אותה בדיקה כפולה שבטופס היומן: התפקיד חייב להיות מבוקש וגם כזה שהעובד
    // מוסמך אליו. הסתרה במסך לבדה אינה הגנה — הקישור עובר הלאה.
    if (employee && !canFillRole(employee, role)) continue;
    seen.add(seat.id);
    picks.push({ slot_id: seat.id, role });
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
      wanted_count: 0,
      note: cleanText(payload.note, 300),
      submitted_at: new Date().toISOString(),
    },
    existing,
    cleared: picks.length === 0,
  };
}

/** מי כבר משובץ בחוג הזה בתפקיד הזה, לפי לוח החוגים. */
function standingHolders(group, role, classRoles) {
  if (!group) return [];
  const [trainerRole] = classRoles;
  if (role && trainerRole && role === trainerRole) return group.trainer ? [String(group.trainer)] : [];
  return (Array.isArray(group.assistants) ? group.assistants : []).map(String);
}

/** לוח האישור: מושב לכל תפקיד בכל חוג, עם מי שביקש ומי כבר משובץ. */
export function classSignupBoard(windowRow, responses = [], employees = [], groups = [], classRoles = []) {
  const rows = responsesForWindow(responses, windowRow.id);
  const byId = new Map((employees || []).map((e) => [String(e.id), e]));
  const groupById = new Map((groups || []).map((g) => [String(g.id), g]));
  const nameOf = (employeeId) => byId.get(String(employeeId))?.name
    || rows.find((r) => r.employee_id === employeeId)?.employee_name
    || 'עובד/ת';

  return (windowRow.seats || []).map((seat) => {
    const group = groupById.get(String(seat.group_id));
    const seats = (seat.needs || []).map((need) => {
      const role = need.role || '';
      const held = standingHolders(group, role, classRoles);
      const claimed = rows.filter((r) => (r.picks || [])
        .some((p) => p.slot_id === seat.id && (p.role || '') === role));

      const claimants = claimed.map((answer) => ({
        employee_id: answer.employee_id,
        name: nameOf(answer.employee_id),
        note: answer.note || '',
        submitted_at: answer.submitted_at || null,
        picked_count: (answer.picks || []).length,
        assigned: held.includes(String(answer.employee_id)),
        answered: true,
      }));
      // מי שכבר משובץ בלוח ולא ענה — עובדה קיימת ולא מועמד, ובלעדיו אפשר לשלוח
      // שניים למקום של אחד.
      for (const employeeId of held) {
        if (claimants.some((c) => String(c.employee_id) === employeeId)) continue;
        claimants.push({
          employee_id: employeeId,
          name: nameOf(employeeId),
          note: '',
          submitted_at: null,
          picked_count: 0,
          assigned: true,
          answered: false,
        });
      }
      claimants.sort((a, b) => {
        if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
        return String(a.submitted_at).localeCompare(String(b.submitted_at));
      });

      return { role, needed: need.count, assigned: held.length, claimants,
        missing: Math.max(0, need.count - held.length) };
    });

    return {
      ...seat,
      trainer_name: group?.trainer ? nameOf(group.trainer) : '',
      seats,
      missing: seats.reduce((sum, s) => sum + s.missing, 0),
    };
  });
}

/**
 * מה האישור עומד לכתוב על לוח החוגים.
 *
 * כיסא המדריך תפוס הוא דילוג ולא דריסה: `group.trainer` הוא שדה יחיד, ואישור
 * שני היה מדיח את הראשון בשקט. המנהל מקבל את הדילוג בחזרה ויכול להחליט.
 */
export function planClassStaffing(windowRow, picks = [], { groups = [], employees = [], classRoles = [], replace = [] } = {}) {
  const groupById = new Map((groups || []).map((g) => [String(g.id), g]));
  const seatById = new Map((windowRow.seats || []).map((s) => [s.id, s]));
  const employeeById = new Map((employees || []).map((e) => [String(e.id), e]));
  const [trainerRole] = classRoles;
  const replaceSet = new Set((replace || []).map(String));

  const byGroup = new Map();
  const skipped = [];

  for (const pick of picks) {
    const seat = seatById.get(cleanText(pick?.slot_id, 60));
    const employeeId = cleanText(pick?.employee_id, 60);
    const role = cleanText(pick?.role, 60);
    const employee = employeeById.get(String(employeeId));
    if (!seat || !employee) continue;

    const group = groupById.get(String(seat.group_id));
    if (!group) { skipped.push({ employee_id: employeeId, group_id: seat.group_id, reason: 'group_missing' }); continue; }
    if (!(seat.needs || []).some((need) => (need.role || '') === role)) {
      skipped.push({ employee_id: employeeId, group_id: group.id, reason: 'role_not_needed' }); continue;
    }
    if (!canFillRole(employee, role)) {
      skipped.push({ employee_id: employeeId, group_id: group.id, reason: 'not_certified' }); continue;
    }

    const current = byGroup.get(String(group.id)) || {
      group_id: String(group.id),
      group_name: group.name || '',
      trainer: group.trainer ? String(group.trainer) : null,
      assistants: (Array.isArray(group.assistants) ? group.assistants : []).map(String),
      placed: [],
    };

    if (trainerRole && role === trainerRole) {
      if (current.trainer && current.trainer !== String(employeeId) && !replaceSet.has(String(group.id))) {
        skipped.push({ employee_id: employeeId, group_id: group.id, reason: 'trainer_taken' });
        byGroup.set(String(group.id), current);
        continue;
      }
      current.trainer = String(employeeId);
      // מדריך אינו גם העוזר של עצמו — אותו כלל שבטופס החוג.
      current.assistants = current.assistants.filter((id) => id !== String(employeeId));
    } else {
      if (current.trainer === String(employeeId)) {
        skipped.push({ employee_id: employeeId, group_id: group.id, reason: 'already_trainer' });
        byGroup.set(String(group.id), current);
        continue;
      }
      if (current.assistants.includes(String(employeeId))) {
        skipped.push({ employee_id: employeeId, group_id: group.id, reason: 'already' });
        byGroup.set(String(group.id), current);
        continue;
      }
      current.assistants = [...current.assistants, String(employeeId)];
    }
    current.placed.push({ employee_id: String(employeeId), role, seat_id: seat.id, label: seat.label });
    byGroup.set(String(group.id), current);
  }

  return { groups: [...byGroup.values()].filter((g) => g.placed.length), skipped };
}

/** ההודעה שמקבל מי ששובץ לחוגים — בלי תאריכים, כי השיבוץ הוא לשנה. */
export function classAssignmentMessageText(windowRow, placed = []) {
  const lines = placed.map((item) => `• ${item.label}${item.role ? ` · ${item.role}` : ''}`);
  return [
    '📋 השיבוץ שלך לחוגים',
    windowRow?.title ? `(${windowRow.title})` : '',
    '',
    ...lines,
    '',
    'השיבוץ קבוע — נתראה בקיר 🧗',
  ].filter((line) => line !== null).join('\n');
}
