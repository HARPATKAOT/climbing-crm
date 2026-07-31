/**
 * סוכן שיחה — הצוות שואל בשפה חופשית, המודל קורא נתונים מה-CRM דרך כלים
 * ומחזיר תשובה בעברית.
 *
 * ההפרדה בין שאלה למשימה נאכפת בקוד, לא בפרומפט: כלי קריאה מבוצעים מיד
 * ותוצאתם חוזרת למודל, וכלי כתיבה **לא מבוצעים בכלל** — הם נרשמים כהצעה
 * ממתינה ב-`ai_suggestions`, בדיוק כמו הצעה שנולדה מניתוח שיחה, ורק אישור
 * מהמסך מריץ אותן. כך "תשובה" ו"פעולה לאישור" יכולות לחזור מאותו תור עצמו.
 *
 * המודל לא מקבל מזהים להמצאה: הוא מחפש לקוח בשם/טלפון ומקבל parent_id
 * מהכלי, ורק מזהה שחזר מכלי קריאה מתקבל בפעולת כתיבה.
 */

import {
  INTRO_ATT_STATUSES,
  consecutiveAbsences,
  israelDateStr,
  normalizeAttStatus,
} from './attendanceUtils.js';
import { resolveJoinDate } from './equipmentService.js';
import { countEnrolled, maxSlotsOf } from './groupCapacity.js';
import { activeRegistrations, remainingCapacity } from './activityRegistration.js';
import { REGISTRATION_PAYMENT_STATUSES, listInterest } from './activityInterest.js';
import {
  SUGGESTIONS_COLLECTION,
  SUGGESTION_PENDING,
  TASK_OPEN,
  addDays,
  normalizeDueDate,
  suggestionFingerprint,
} from './aiActions.js';

/** פעולות שהסוכן רשאי להציע. כל type אחר נזרק לפני שנוגעים במסד. */
export const CHAT_ACTION_TYPES = [
  'create_task',
  'update_task',
  'add_customer_note',
  'add_activity_interest',
  'register_to_activity',
];

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_STEPS = 6;
const MAX_ACTIONS_PER_TURN = 5;
const MAX_TITLE_CHARS = 120;
const MAX_NAME_CHARS = 60;
const MAX_NOTE_CHARS = 600;
const MAX_REASON_CHARS = 300;
const SEARCH_LIMIT = 15;
const CONVERSATION_MESSAGES = 12;

function clean(value) {
  return String(value ?? '').trim();
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** מפתח השוואת טלפונים — תשע ספרות אחרונות, כמו בשאר ה-CRM. */
function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length > 9 ? digits.slice(-9) : digits;
}

function includesLoose(haystack, needle) {
  return String(haystack || '').toLocaleLowerCase('he').includes(needle);
}

function rows(db, table) {
  return db.get(table) || [];
}

function findParent(db, parentId) {
  return rows(db, 'parents').find((row) => String(row.id) === String(parentId)) || null;
}

function groupName(db, groupId) {
  if (!groupId) return '';
  return rows(db, 'groups').find((row) => String(row.id) === String(groupId))?.name || '';
}

// ─── כלי קריאה ───────────────────────────────────────────────────────────────
// כל כלי מחזיר אובייקט קטן ושטוח. הפורמט הוא מה שהמודל רואה, ולכן הוא נשאר
// קריא לבן אדם: מה שמבלבל אותנו בדיבאג יבלבל גם את המודל.

function toolSearchCustomers(db, { query = '' } = {}) {
  const needle = clean(query).toLocaleLowerCase('he');
  if (!needle) return { error: 'query חובה' };
  const digits = phoneKey(needle);

  const students = rows(db, 'students');
  const matches = rows(db, 'parents').filter((parent) => {
    if (includesLoose(parent.name, needle) || includesLoose(parent.lastName, needle)) return true;
    if (includesLoose(parent.email, needle)) return true;
    if (digits.length >= 6 && phoneKey(parent.phone) === digits) return true;
    return students.some(
      (student) => String(student.parentId) === String(parent.id) && includesLoose(student.name, needle)
    );
  });

  return {
    total: matches.length,
    customers: matches.slice(0, SEARCH_LIMIT).map((parent) => ({
      parent_id: parent.id,
      name: parent.name || '',
      phone: parent.phone || '',
      status: parent.status || '',
      students: students
        .filter((student) => String(student.parentId) === String(parent.id))
        .map((student) => student.name)
        .filter(Boolean),
    })),
    truncated: matches.length > SEARCH_LIMIT,
  };
}

/**
 * מתי מתאמן התחיל להתאמן, וכמה נוכחות יש לו מאז.
 *
 * „התחיל” הוא האימון הראשון שאינו אימון היכרות — אותה הגדרה שקיזוז דמי
 * הנעליים נשען עליה, ולכן נגזרת מ-`resolveJoinDate` ולא מחושבת כאן מחדש.
 */
function toolGetStudentAttendance(db, { student_id: studentId } = {}) {
  const student = rows(db, 'students').find((row) => String(row.id) === String(studentId));
  if (!student) return { error: 'לא נמצא מתאמן עם המזהה הזה' };

  const attendance = rows(db, 'attendance')
    .filter((row) => String(row.student_id) === String(student.id))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  if (!attendance.length) {
    return {
      student_id: student.id,
      name: student.name || '',
      status: student.status || '',
      group: groupName(db, student.groupId),
      started_on: null,
      note: 'אין שורות נוכחות למתאמן הזה',
    };
  }

  const intro = attendance.filter((row) => INTRO_ATT_STATUSES.has(normalizeAttStatus(row.status)));
  const regular = attendance.filter((row) => !INTRO_ATT_STATUSES.has(normalizeAttStatus(row.status)));
  const arrived = regular.filter((row) => ['attended', 'makeup', 'saturday_makeup'].includes(normalizeAttStatus(row.status)));

  return {
    student_id: student.id,
    name: student.name || '',
    status: student.status || '',
    group: groupName(db, student.groupId),
    // תאריך תחילת האימונים בפועל, אחרי אימון ההיכרות
    started_on: resolveJoinDate(attendance),
    intro_dates: intro.map((row) => row.date),
    first_regular_training: regular[0]?.date || null,
    last_training: arrived[arrived.length - 1]?.date || null,
    attended_count: arrived.length,
    absent_count: regular.filter((row) => normalizeAttStatus(row.status) === 'absent').length,
    consecutive_absences: consecutiveAbsences(attendance),
    recent: attendance.slice(-10).map((row) => ({
      date: row.date,
      status: normalizeAttStatus(row.status),
      group: groupName(db, row.group_id),
    })),
  };
}

function toolGetCustomer(db, { parent_id: parentId } = {}) {
  const parent = findParent(db, parentId);
  if (!parent) return { error: 'לא נמצא לקוח עם המזהה הזה' };

  const students = rows(db, 'students').filter((row) => String(row.parentId) === String(parent.id));
  const studentIds = new Set(students.map((row) => String(row.id)));
  const enrollments = rows(db, 'enrollments').filter((row) => studentIds.has(String(row.student_id)));

  const messages = rows(db, 'messages')
    .filter((row) => String(row.parent_id) === String(parent.id))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
    .slice(-CONVERSATION_MESSAGES)
    .map((row) => ({
      at: String(row.created_at || '').slice(0, 16).replace('T', ' '),
      from: row.direction === 'inbound' ? 'לקוח' : 'צוות',
      text: clean(row.message).slice(0, 300),
    }));

  return {
    parent_id: parent.id,
    name: parent.name || '',
    phone: parent.phone || '',
    email: parent.email || '',
    status: parent.status || '',
    source: parent.source || '',
    notes: clean(parent.notes).slice(0, 800),
    students: students.map((student) => ({
      student_id: student.id,
      name: student.name || '',
      status: student.status || '',
      birth_date: student.birthDate || '',
      level: student.levelGrade || '',
      group: groupName(db, student.groupId),
      health_signed_at: student.healthSignedAt || null,
    })),
    enrollments: enrollments.map((row) => ({
      student: students.find((s) => String(s.id) === String(row.student_id))?.name || '',
      group: groupName(db, row.group_id),
      status: row.status || '',
      price: row.price ?? null,
      start_date: row.start_date || '',
      end_date: row.end_date || '',
    })),
    payments: rows(db, 'payments')
      .filter((row) => String(row.parent_id) === String(parent.id))
      .map((row) => ({
        amount: row.amount ?? null,
        status: row.status || '',
        paid_at: row.paid_at || null,
        description: clean(row.description).slice(0, 120),
      })),
    open_tasks: rows(db, 'crm_tasks')
      .filter((row) => String(row.parent_id) === String(parent.id)
        && String(row.status || TASK_OPEN) === TASK_OPEN)
      .map((row) => ({ task_id: row.id, title: row.title, due_date: row.due_date || null })),
    recent_messages: messages,
  };
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** מה שהמאשר קורא על הכרטיס. סטטוס תשלום חייב להיות מפורש שם. */
const PAYMENT_LABELS = {
  paid: 'שולם',
  pending: 'טרם שולם',
  not_required: 'ללא תשלום',
};

function toolListGroups(db, { day = null } = {}) {
  const students = rows(db, 'students');
  const wanted = day === null || day === undefined || day === '' ? null : Number(day);

  const list = rows(db, 'groups')
    .filter((group) => (wanted === null ? true : Number(group.day) === wanted))
    .map((group) => {
      const enrolled = countEnrolled(group.id, students);
      const max = maxSlotsOf(group);
      return {
        group_id: group.id,
        name: group.name || '',
        day: DAY_NAMES[Number(group.day)] || '',
        time: group.time || '',
        age_category: group.ageCategory || '',
        trainer: group.trainer || '',
        enrolled,
        max_slots: max,
        spots_left: Math.max(0, max - enrolled),
        price_week: group.priceWeek ?? null,
        price_twice: group.priceTwice ?? null,
      };
    });

  return { total: list.length, groups: list };
}

function toolListActivities(db, { from = '', to = '', status = '' } = {}) {
  const registrations = rows(db, 'activity_registrations');
  const fromDate = clean(from);
  const toDate = clean(to);
  const wantedStatus = clean(status);

  const list = rows(db, 'activities')
    .filter((activity) => {
      const date = String(activity.date || '');
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      if (wantedStatus && String(activity.status || '') !== wantedStatus) return false;
      return true;
    })
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .map((activity) => {
      const signed = registrations.filter(
        (row) => String(row.activity_id) === String(activity.id) && row.status !== 'cancelled'
      );
      return {
        activity_id: activity.id,
        name: activity.name || '',
        type: activity.type || '',
        status: activity.status || '',
        date: activity.date || '',
        start_time: activity.start_time || '',
        location: activity.location || '',
        price: activity.price ?? null,
        max_participants: activity.max_participants ?? null,
        registered: signed.length,
        paid: signed.filter((row) => row.payment_status === 'paid').length,
      };
    });

  return { total: list.length, activities: list };
}

/** אירוע אחד לעומק — מי כבר רשום, מי ברשימת המתעניינים וכמה מקום נשאר. */
function toolGetActivity(db, { activity_id: activityId } = {}) {
  const activity = rows(db, 'activities').find((row) => String(row.id) === String(activityId));
  if (!activity) return { error: 'לא נמצא אירוע עם המזהה הזה' };

  const registrations = activeRegistrations(db, activity.id);
  const parents = rows(db, 'parents');
  const nameOf = (parentId) => parents.find((p) => String(p.id) === String(parentId))?.name || '';

  return {
    activity_id: activity.id,
    name: activity.name || '',
    type: activity.type || '',
    status: activity.status || '',
    date: activity.date || '',
    start_time: activity.start_time || '',
    end_time: activity.end_time || '',
    location: activity.location || '',
    price: activity.price ?? null,
    max_participants: activity.max_participants ?? null,
    // null = בלי תקרה מוגדרת. חשוב שהמודל יראה את ההבדל מול 0 מקומות.
    spots_left: remainingCapacity(activity, registrations),
    registered: registrations.map((row) => ({
      registration_id: row.id,
      name: row.participant_name || '',
      customer: nameOf(row.parent_id),
      payment_status: row.payment_status || '',
    })),
    interested: listInterest(db, activity.id).map((row) => ({
      interest_id: row.id,
      name: row.name || '',
      customer: nameOf(row.parent_id),
      phone: row.phone || '',
    })),
  };
}

function toolListTasks(db, { status = TASK_OPEN, overdue_only: overdueOnly = false, today = israelDateStr() } = {}) {
  const wanted = clean(status) || TASK_OPEN;
  const parents = rows(db, 'parents');

  const list = rows(db, 'crm_tasks')
    .filter((row) => (wanted === 'all' ? true : String(row.status || TASK_OPEN) === wanted))
    .filter((row) => (overdueOnly ? !!row.due_date && row.due_date < today : true))
    .sort((a, b) => String(a.due_date || '9999-12-31').localeCompare(String(b.due_date || '9999-12-31')))
    .map((row) => ({
      task_id: row.id,
      title: row.title || '',
      status: row.status || TASK_OPEN,
      priority: row.priority || 'normal',
      due_date: row.due_date || null,
      overdue: !!row.due_date && row.due_date < today && String(row.status || TASK_OPEN) === TASK_OPEN,
      customer: parents.find((p) => String(p.id) === String(row.parent_id))?.name || '',
      notes: clean(row.notes).slice(0, 200),
    }));

  return { total: list.length, tasks: list };
}

function toolListPayments(db, { from = '', to = '', status = '' } = {}) {
  const fromDate = clean(from);
  const toDate = clean(to);
  const wantedStatus = clean(status);
  const parents = rows(db, 'parents');

  const list = rows(db, 'payments').filter((row) => {
    const date = String(row.paid_at || row.created_at || '').slice(0, 10);
    if (fromDate && date < fromDate) return false;
    if (toDate && date > toDate) return false;
    if (wantedStatus && String(row.status || '') !== wantedStatus) return false;
    return true;
  });

  const total = list.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const paid = list.filter((row) => String(row.status || '') === 'paid');

  return {
    count: list.length,
    total_amount: Math.round(total * 100) / 100,
    paid_count: paid.length,
    paid_amount: Math.round(paid.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100) / 100,
    payments: list.slice(0, 60).map((row) => ({
      amount: row.amount ?? null,
      status: row.status || '',
      paid_at: row.paid_at || null,
      customer: parents.find((p) => String(p.id) === String(row.parent_id))?.name || '',
      description: clean(row.description).slice(0, 120),
    })),
    truncated: list.length > 60,
  };
}

function toolBusinessSnapshot(db, { today = israelDateStr() } = {}) {
  const students = rows(db, 'students');
  const byStatus = {};
  for (const student of students) {
    const key = student.status || 'unknown';
    byStatus[key] = (byStatus[key] || 0) + 1;
  }

  const monthStart = `${today.slice(0, 7)}-01`;
  const monthPayments = rows(db, 'payments').filter(
    (row) => String(row.paid_at || '').slice(0, 10) >= monthStart && String(row.status || '') === 'paid'
  );

  const groups = rows(db, 'groups');
  const capacity = groups.reduce((sum, group) => sum + maxSlotsOf(group), 0);
  const enrolled = groups.reduce((sum, group) => sum + countEnrolled(group.id, students), 0);

  const tasks = rows(db, 'crm_tasks').filter((row) => String(row.status || TASK_OPEN) === TASK_OPEN);

  return {
    today,
    parents: rows(db, 'parents').length,
    students: students.length,
    students_by_status: byStatus,
    groups: groups.length,
    capacity,
    enrolled,
    spots_left: Math.max(0, capacity - enrolled),
    open_tasks: tasks.length,
    overdue_tasks: tasks.filter((row) => row.due_date && row.due_date < today).length,
    pending_suggestions: rows(db, SUGGESTIONS_COLLECTION)
      .filter((row) => String(row.status || SUGGESTION_PENDING) === SUGGESTION_PENDING).length,
    paid_this_month: Math.round(
      monthPayments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0) * 100
    ) / 100,
  };
}

/** רק כלים כאן מבוצעים מיד. מה שלא ברשימה — לא רץ. */
export const READ_TOOLS = {
  search_customers: toolSearchCustomers,
  get_customer: toolGetCustomer,
  get_student_attendance: toolGetStudentAttendance,
  list_groups: toolListGroups,
  list_activities: toolListActivities,
  get_activity: toolGetActivity,
  list_tasks: toolListTasks,
  list_payments: toolListPayments,
  business_snapshot: toolBusinessSnapshot,
};

// ─── הצהרות הכלים למודל ──────────────────────────────────────────────────────

export function toolDeclarations() {
  return [
    {
      name: 'search_customers',
      description: 'חיפוש לקוח לפי שם הורה, שם ילד, טלפון או אימייל. מחזיר parent_id לשימוש בכלים אחרים.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'שם, טלפון או אימייל' } },
        required: ['query'],
      },
    },
    {
      name: 'get_customer',
      description: 'כרטיס לקוח מלא: פרטים, ילדים, רישומים לחוגים, תשלומים, משימות פתוחות והודעות אחרונות.',
      parameters: {
        type: 'object',
        properties: { parent_id: { type: 'string', description: 'מזהה שחזר מ-search_customers' } },
        required: ['parent_id'],
      },
    },
    {
      name: 'get_student_attendance',
      description:
        'נוכחות של מתאמן: מתי התחיל להתאמן בפועל (האימון הראשון שאינו אימון היכרות), '
        + 'תאריכי ההיכרות, אימון אחרון, כמה הגיע, כמה החסיר וכמה החסיר ברצף.',
      parameters: {
        type: 'object',
        properties: { student_id: { type: 'string', description: 'מזהה מתאמן מ-get_customer' } },
        required: ['student_id'],
      },
    },
    {
      name: 'list_groups',
      description: 'רשימת החוגים עם תפוסה בפועל, מקומות פנויים ומחירים.',
      parameters: {
        type: 'object',
        properties: { day: { type: 'integer', description: 'יום בשבוע 0=ראשון עד 6=שבת. השמט לכל הימים.' } },
      },
    },
    {
      name: 'list_activities',
      description: 'אירועים ופעילויות בטווח תאריכים, כולל כמה נרשמו וכמה שילמו.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          status: { type: 'string' },
        },
      },
    },
    {
      name: 'get_activity',
      description: 'אירוע אחד לעומק: מי רשום, מי ברשימת המתעניינים וכמה מקומות נשארו. הרץ אותו לפני שיבוץ לאירוע.',
      parameters: {
        type: 'object',
        properties: { activity_id: { type: 'string', description: 'מזהה שחזר מ-list_activities' } },
        required: ['activity_id'],
      },
    },
    {
      name: 'list_tasks',
      description: 'משימות ה-CRM. ברירת מחדל: משימות פתוחות.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'done', 'cancelled', 'all'] },
          overdue_only: { type: 'boolean', description: 'רק משימות שעבר תאריך היעד שלהן' },
        },
      },
    },
    {
      name: 'list_payments',
      description: 'תשלומים בטווח תאריכים עם סכום מצטבר.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
          status: { type: 'string', description: 'למשל paid או pending' },
        },
      },
    },
    {
      name: 'business_snapshot',
      description: 'תמונת מצב כללית: כמות לקוחות ומתאמנים לפי סטטוס, תפוסת חוגים, משימות פתוחות והכנסות החודש.',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'create_task',
      description: 'הצעת משימת מעקב חדשה לצוות. המשימה לא נוצרת מיד — היא ממתינה לאישור המשתמש.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'מה בדיוק לעשות. עברית, לשון ציווי, עד 12 מילים.' },
          reason: { type: 'string', description: 'משפט קצר: למה הצעת את זה' },
          parent_id: { type: 'string', description: 'מזהה לקוח מכלי קריאה. השמט אם המשימה לא קשורה ללקוח.' },
          student_name: { type: 'string', description: 'שם מתאמן מכרטיס הלקוח בלבד' },
          due_date: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'string', enum: ['normal', 'high'] },
        },
        required: ['title'],
      },
    },
    {
      name: 'update_task',
      description: 'הצעת עדכון למשימה קיימת (סגירה, שינוי תאריך או דחיפות). ממתינה לאישור המשתמש.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'מזהה שחזר מ-list_tasks' },
          status: { type: 'string', enum: ['open', 'done', 'cancelled'] },
          due_date: { type: 'string', description: 'YYYY-MM-DD' },
          priority: { type: 'string', enum: ['normal', 'high'] },
          reason: { type: 'string' },
        },
        required: ['task_id'],
      },
    },
    {
      name: 'add_customer_note',
      description: 'הצעת הוספת הערה לכרטיס לקוח. ממתינה לאישור המשתמש.',
      parameters: {
        type: 'object',
        properties: {
          parent_id: { type: 'string', description: 'מזהה שחזר מכלי קריאה' },
          note: { type: 'string', description: 'תוכן ההערה' },
          reason: { type: 'string' },
        },
        required: ['parent_id', 'note'],
      },
    },
    {
      name: 'add_activity_interest',
      description: 'שיבוץ אדם כ*מתעניין* באירוע — לא תופס מקום ולא גובה תשלום. '
        + 'זו ברירת המחדל כשמבקשים "לשבץ" מישהו לאירוע. ממתין לאישור המשתמש.',
      parameters: {
        type: 'object',
        properties: {
          activity_id: { type: 'string', description: 'מזהה שחזר מ-list_activities' },
          parent_id: { type: 'string', description: 'מזהה הלקוח מכלי קריאה' },
          student_name: { type: 'string', description: 'שם מתאמן מכרטיס הלקוח' },
          participant_name: { type: 'string', description: 'שם המשתתף, אם אינו מתאמן רשום' },
          notes: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['activity_id'],
      },
    },
    {
      name: 'register_to_activity',
      description: 'רישום מלא של משתתף לאירוע — תופס מקום ויוצר חיוב לפי מחיר האירוע. '
        + 'השתמש רק כשנאמר במפורש "לרשום"; ל"לשבץ" השתמש ב-add_activity_interest. ממתין לאישור המשתמש.',
      parameters: {
        type: 'object',
        properties: {
          activity_id: { type: 'string', description: 'מזהה שחזר מ-list_activities' },
          parent_id: { type: 'string', description: 'מזהה הלקוח מכלי קריאה. חובה.' },
          student_name: { type: 'string', description: 'שם מתאמן מכרטיס הלקוח' },
          participant_name: { type: 'string', description: 'שם המשתתף, אם אינו מתאמן רשום' },
          payment_status: {
            type: 'string',
            enum: ['pending', 'paid', 'not_required'],
            description: 'pending = טרם שולם, paid = שולם, not_required = ללא תשלום. '
              + 'אל תנחש: כשלא נאמר, השמט והמערכת תקבע לפי הגדרת האירוע.',
          },
          reason: { type: 'string' },
        },
        required: ['activity_id', 'parent_id'],
      },
    },
  ];
}

export function buildSystemPrompt({ today = israelDateStr(), brandName = '', actor = '', page = '' } = {}) {
  return [
    `אתה הסוכן של צוות ה-CRM בחדר טיפוס${brandName ? ` "${brandName}"` : ''}.`,
    'אתה מדבר עם איש צוות, לא עם לקוח. ענה בעברית, קצר וענייני.',
    '',
    `התאריך היום: ${today}`,
    actor ? `המשתמש שמדבר איתך: ${actor}` : '',
    page ? `הוא נמצא כרגע במסך: ${page}` : '',
    '',
    '## שאלה מול משימה',
    'שאלה — ענה עליה. השתמש בכלי הקריאה כדי להביא נתונים אמיתיים, ואל תקרא לכלי כתיבה.',
    'בקשה לעשות משהו ("תפתח משימה", "תסגור את זה", "תרשום לי") — קרא לכלי הכתיבה המתאים.',
    'אפשר גם וגם: לענות על שאלה ולהציע פעולה שנובעת ממנה — רק אם המשתמש ביקש פעולה,',
    'או אם התשובה חושפת קצה פתוח שברור שצריך לטפל בו. אל תציע פעולות סתם.',
    '',
    '## כללי עבודה',
    '- אל תמציא נתונים. אם כלי לא החזיר את המידע — אמור שאין לך אותו.',
    '- אל תמציא מזהים. parent_id / task_id מגיעים אך ורק מכלי קריאה שהרצת בשיחה הזו.',
    '- שם לקוח או ילד שאתה מזכיר חייב להופיע בתוצאות הכלים.',
    '- כשהשאלה על לקוח מסוים — תמיד search_customers ואז get_customer לפני שאתה עונה.',
    `- לכל היותר ${MAX_ACTIONS_PER_TURN} פעולות כתיבה בתור אחד.`,
    '- אל תסכם את מה שעשית בפירוט טכני. תן את התשובה עצמה.',
    '',
    '## מה קורה לפעולות שלך',
    'כלי כתיבה לא משנה שום דבר במערכת. הוא רושם הצעה שמופיעה למשתמש עם כפתורי',
    'אישור ודחייה. לכן נסח כותרות כאילו הן ייקראו על ידי בן אדם, ואל תבטיח',
    'שהפעולה בוצעה — אמור שהיא ממתינה לאישור.',
  ].filter(Boolean).join('\n');
}

// ─── אימות פעולות כתיבה ──────────────────────────────────────────────────────

/**
 * הופך קריאת כלי כתיבה להצעה חוקית, או זורק. כל שדה שהמודל לא רשאי לקבוע
 * (student_id, כותרת המשימה הקיימת) נשלף מה-CRM ולא ממנו.
 */
export function normalizeChatAction(db, name, args = {}, { today = israelDateStr() } = {}) {
  if (!CHAT_ACTION_TYPES.includes(name)) throw badRequest(`סוג פעולה לא נתמך: ${name}`);

  if (name === 'create_task') {
    const title = clean(args.title).replace(/\s+/g, ' ').slice(0, MAX_TITLE_CHARS);
    if (title.length < 3) throw badRequest('כותרת המשימה חסרה');

    const parent = args.parent_id ? findParent(db, args.parent_id) : null;
    if (args.parent_id && !parent) throw badRequest('parent_id לא קיים');

    const student = parent && clean(args.student_name)
      ? rows(db, 'students').find(
        (row) => String(row.parentId) === String(parent.id)
            && clean(row.name).toLocaleLowerCase('he') === clean(args.student_name).toLocaleLowerCase('he')
      )
      : null;

    return {
      type: 'create_task',
      reason: clean(args.reason).slice(0, MAX_REASON_CHARS),
      label: `משימה חדשה: ${title}`,
      args: {
        title,
        due_date: normalizeDueDate(args.due_date, { today }) || null,
        priority: args.priority === 'high' ? 'high' : 'normal',
        parent_id: parent?.id ? String(parent.id) : null,
        student_id: student?.id ? String(student.id) : null,
        student_name: student?.name || '',
      },
    };
  }

  if (name === 'update_task') {
    const task = rows(db, 'crm_tasks').find((row) => String(row.id) === String(args.task_id));
    if (!task) throw badRequest('task_id לא קיים');

    const patch = {};
    if (args.status !== undefined && clean(args.status)) {
      const status = clean(args.status);
      if (!['open', 'done', 'cancelled'].includes(status)) throw badRequest('סטטוס משימה לא חוקי');
      patch.status = status;
    }
    if (args.due_date !== undefined && clean(args.due_date)) {
      patch.due_date = normalizeDueDate(args.due_date, { today });
      if (!patch.due_date) throw badRequest('תאריך יעד לא חוקי');
    }
    if (args.priority !== undefined && clean(args.priority)) {
      patch.priority = args.priority === 'high' ? 'high' : 'normal';
    }
    if (!Object.keys(patch).length) throw badRequest('אין מה לעדכן במשימה');

    const STATUS_WORDS = { open: 'פתוחה', done: 'בוצעה', cancelled: 'בוטלה' };
    const parts = [
      patch.status ? `סטטוס → ${STATUS_WORDS[patch.status]}` : '',
      patch.due_date ? `יעד → ${patch.due_date}` : '',
      patch.priority ? `דחיפות → ${patch.priority === 'high' ? 'גבוהה' : 'רגילה'}` : '',
    ].filter(Boolean);

    return {
      type: 'update_task',
      reason: clean(args.reason).slice(0, MAX_REASON_CHARS),
      label: `עדכון משימה "${task.title}": ${parts.join(', ')}`,
      args: {
        task_id: String(task.id),
        task_title: task.title || '',
        parent_id: task.parent_id ? String(task.parent_id) : null,
        patch,
      },
    };
  }

  if (name === 'add_customer_note') {
    const parent = findParent(db, args.parent_id);
    if (!parent) throw badRequest('parent_id לא קיים');
    const note = clean(args.note).replace(/\s+/g, ' ').slice(0, MAX_NOTE_CHARS);
    if (note.length < 2) throw badRequest('תוכן ההערה חסר');

    return {
      type: 'add_customer_note',
      reason: clean(args.reason).slice(0, MAX_REASON_CHARS),
      label: `הערה לכרטיס ${parent.name || parent.id}: ${note}`,
      args: { parent_id: String(parent.id), note },
    };
  }

  // ── שיבוץ לאירוע ──
  const activity = rows(db, 'activities').find((row) => String(row.id) === String(args.activity_id));
  if (!activity) throw badRequest('activity_id לא קיים');

  const parent = args.parent_id ? findParent(db, args.parent_id) : null;
  if (args.parent_id && !parent) throw badRequest('parent_id לא קיים');

  // שם המשתתף נלקח מהמתאמן שבכרטיס אם הוא נמצא שם, ורק אחרת מהמודל.
  const student = parent && clean(args.student_name)
    ? rows(db, 'students').find(
      (row) => String(row.parentId) === String(parent.id)
          && clean(row.name).toLocaleLowerCase('he') === clean(args.student_name).toLocaleLowerCase('he')
    )
    : null;
  if (clean(args.student_name) && !student) {
    throw badRequest(`"${clean(args.student_name)}" אינו מתאמן בכרטיס של הלקוח הזה`);
  }

  const participantName = clean(student?.name || args.participant_name || parent?.name)
    .replace(/\s+/g, ' ')
    .slice(0, MAX_NAME_CHARS);
  if (participantName.length < 2) throw badRequest('שם המשתתף חסר');

  const base = {
    activity_id: String(activity.id),
    activity_name: activity.name || '',
    activity_date: activity.date || '',
    parent_id: parent?.id ? String(parent.id) : null,
    student_id: student?.id ? String(student.id) : null,
    participant_name: participantName,
    participant_type: student?.isAdult ? 'adult' : 'child',
  };
  const where = `${activity.name || activity.id}${activity.date ? ` (${activity.date})` : ''}`;

  if (name === 'add_activity_interest') {
    return {
      type: 'add_activity_interest',
      reason: clean(args.reason).slice(0, MAX_REASON_CHARS),
      label: `שיבוץ ${participantName} כמתעניין ב-${where}`,
      args: { ...base, notes: clean(args.notes).slice(0, MAX_NOTE_CHARS) },
    };
  }

  // רישום מלא תופס מקום, ולכן חייב לקוח — אין למי לשייך את החיוב בלעדיו.
  if (!parent) throw badRequest('רישום לאירוע מחייב parent_id');

  // בדיקה מקדימה בלבד. הבדיקה הקובעת רצה שוב באישור, כי בינתיים
  // מקומות יכולים להיתפס בדף ההרשמה הציבורי.
  const left = remainingCapacity(activity, activeRegistrations(db, activity.id));
  if (left !== null && left < 1) throw badRequest(`אין מקומות פנויים ב-${where}`);

  // ערך שאינו באוצר המילים של ההרשמות נופל לברירת המחדל של האירוע — ובאירוע
  // בתשלום ברירת המחדל היא "שולם". לכן ערך לא מוכר נדחה כאן ולא מועבר הלאה:
  // סימון שגוי של "שולם" הוא בדיוק הטעות שלא מתגלה עד שמישהו מחפש את הכסף.
  const requested = clean(args.payment_status);
  if (requested && !REGISTRATION_PAYMENT_STATUSES.has(requested)) {
    throw badRequest(`סטטוס תשלום לא חוקי: ${requested}`);
  }

  return {
    type: 'register_to_activity',
    reason: clean(args.reason).slice(0, MAX_REASON_CHARS),
    label: `רישום ${participantName} ל-${where}`
      + (requested ? ` · ${PAYMENT_LABELS[requested]}` : '')
      + (left === null ? '' : ` · ${left} מקומות פנויים כרגע`),
    args: { ...base, payment_status: requested || null },
  };
}

/**
 * שומר הצעה ממתינה. אותו אוסף ואותו סטטוס כמו הצעה מניתוח שיחה, כך שמסלול
 * האישור/דחייה הקיים עובד עליה בלי שינוי.
 */
export async function stageChatAction({ db, persist, action, actor = '', question = '' } = {}) {
  const record = db.insert(SUGGESTIONS_COLLECTION, {
    type: action.type,
    scenario_id: null,
    scenario_name: 'בקשה מהסוכן',
    status: SUGGESTION_PENDING,
    confidence: 1,
    reason: action.reason || '',
    label: action.label || '',
    args: action.args,
    fingerprint: suggestionFingerprint({
      type: action.type,
      parentId: action.args.parent_id,
      title: action.label,
    }),
    source: { kind: 'chat', actor, question: clean(question).slice(0, MAX_REASON_CHARS) },
    created_by: actor || 'crm',
  });
  if (typeof persist === 'function') {
    const result = await persist(SUGGESTIONS_COLLECTION, record);
    if (result && result.ok === false) {
      db.delete(SUGGESTIONS_COLLECTION, record.id);
      throw new Error(`שמירת ההצעה נכשלה: ${result.error || 'unknown'}`);
    }
  }
  return record;
}

// ─── קריאה למודל ─────────────────────────────────────────────────────────────

/**
 * קריאת Gemini עם function calling. מחזיר את ה-content של המודל כמו שהוא
 * (`{ role, parts }`) כדי שהלולאה תוכל להחזיר אותו להיסטוריה — Gemini דורש
 * שה-functionResponse יבוא אחרי אותו functionCall בדיוק.
 */
export async function callGeminiChat({
  contents,
  systemInstruction,
  declarations,
  apiKey = process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
  models,
} = {}) {
  const key = clean(apiKey);
  if (!key || key === 'YOUR_GEMINI_API_KEY_HERE') return { content: null, error: 'no_api_key' };

  // כמו בשאר הקוד: כינוי מתגלגל ראשון. גרסה נעוצה מתה בשקט ב-404.
  const candidates = models || [
    process.env.GEMINI_MODEL || 'gemini-flash-latest',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
  ];

  let lastError = '';
  for (const model of candidates) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          tools: [{ functionDeclarations: declarations }],
          generationConfig: { temperature: 0.2 },
        }),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        lastError = `${model}: HTTP ${response.status} ${body.slice(0, 200)}`;
        // מכסה מוצתה היא מצב של החשבון ולא של המודל — מעבר למודל הבא רק שורף עוד בקשות.
        if (response.status === 429) return { content: null, error: 'quota' };
        continue;
      }
      const data = await response.json();
      const content = data?.candidates?.[0]?.content;
      if (content?.parts?.length) return { content, error: '' };
      lastError = `${model}: empty candidates`;
    } catch (err) {
      lastError = `${model}: ${err.message}`;
    }
  }
  if (lastError) console.error('AI chat model call failed:', lastError);
  return { content: null, error: 'model_error' };
}

function historyToContents(messages = []) {
  return messages
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: clean(message.content) }],
    }))
    .filter((entry) => entry.parts[0].text);
}

function functionCallsOf(content) {
  return (content?.parts || [])
    .map((part) => part.functionCall)
    .filter((call) => call && call.name);
}

function textOf(content) {
  return (content?.parts || [])
    .map((part) => clean(part.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

/**
 * תור שיחה אחד. מחזיר תשובה + ההצעות שנרשמו. לא זורק על כשל מודל —
 * מחזיר reason כדי שהמסך יציג הודעה מובנת במקום שגיאה גנרית.
 */
export async function runChatTurn({
  db,
  persist,
  messages = [],
  actor = '',
  page = '',
  brandName = '',
  today = israelDateStr(),
  callModel = callGeminiChat,
  apiKey,
  maxSteps = MAX_TOOL_STEPS,
} = {}) {
  const question = clean(messages[messages.length - 1]?.content);
  const contents = historyToContents(messages);
  if (!contents.length) throw badRequest('אין הודעה לשלוח');

  const systemInstruction = buildSystemPrompt({ today, brandName, actor, page });
  const declarations = toolDeclarations();

  const proposals = [];
  const toolsUsed = [];
  let modelCalls = 0;

  for (let step = 0; step < maxSteps; step += 1) {
    const { content, error } = await callModel({
      contents,
      systemInstruction,
      declarations,
      apiKey,
    });
    modelCalls += 1;
    if (!content) {
      return { reply: '', proposals, tools_used: toolsUsed, model_calls: modelCalls, reason: error || 'model_error' };
    }

    const calls = functionCallsOf(content);
    if (!calls.length) {
      return {
        reply: textOf(content),
        proposals,
        tools_used: toolsUsed,
        model_calls: modelCalls,
        reason: 'ok',
      };
    }

    contents.push(content);
    const responseParts = [];

    for (const call of calls) {
      const name = String(call.name);
      const args = call.args && typeof call.args === 'object' ? call.args : {};
      toolsUsed.push(name);

      if (READ_TOOLS[name]) {
        let result;
        try {
          result = READ_TOOLS[name](db, { ...args, today });
        } catch (err) {
          result = { error: err.message };
        }
        responseParts.push({ functionResponse: { name, response: result } });
        continue;
      }

      if (!CHAT_ACTION_TYPES.includes(name)) {
        responseParts.push({ functionResponse: { name, response: { error: 'כלי לא קיים' } } });
        continue;
      }

      if (proposals.length >= MAX_ACTIONS_PER_TURN) {
        responseParts.push({
          functionResponse: { name, response: { error: 'הגעת למכסת הפעולות בתור הזה' } },
        });
        continue;
      }

      try {
        const action = normalizeChatAction(db, name, args, { today });
        const record = await stageChatAction({ db, persist, action, actor, question });
        proposals.push(record);
        responseParts.push({
          functionResponse: {
            name,
            response: {
              status: 'ממתינה לאישור המשתמש',
              suggestion_id: record.id,
              summary: action.label,
            },
          },
        });
      } catch (err) {
        responseParts.push({ functionResponse: { name, response: { error: err.message } } });
      }
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    reply: '',
    proposals,
    tools_used: toolsUsed,
    model_calls: modelCalls,
    reason: 'max_steps',
  };
}

export { addDays };
