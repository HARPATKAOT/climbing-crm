/**
 * What the trainer of a group hears about their own group.
 *
 * A מדריך finds out that a child left, or that a new one is coming to an intro
 * session, when they read the list on the mat — which is to say, too late to
 * prepare and too late to ask why. These three alerts are the ones that change
 * what happens at the next session: someone joined, someone left, and someone
 * new is coming to try.
 *
 * The recipients are the group's own staff — the trainer and the assistants
 * listed on it — and never the whole team: a group alert sent to everyone is a
 * group alert nobody reads.
 */

import { db } from './db.js';
import { alertSubscribers } from './staffAlerts.js';
import { sendStaffAlert } from './staffNotify.js';
import { dateToWeekday, getGroupDays, israelDateStr, israelHour } from './attendanceUtils.js';
import { studentGroupIds } from './studentGroups.js';
import { INTRO_STATUSES } from './automations.js';

/** Trainer first, then assistants — everyone who stands in front of the group. */
export function groupStaffIds(group) {
  const ids = [group?.trainer, ...(Array.isArray(group?.assistants) ? group.assistants : [])];
  return [...new Set(ids.map((id) => String(id || '')).filter(Boolean))];
}

function groupById(store, id) {
  return (store.get('groups') || []).find((g) => String(g.id) === String(id)) || null;
}

function groupLabel(group) {
  if (!group) return 'קבוצה';
  return group.name || [group.ageCategory, group.time].filter(Boolean).join(' · ') || 'קבוצה';
}

function membershipText({ action, student, group }) {
  const name = student?.name || 'מתאמן';
  return action === 'joined'
    ? ['🧗 מתאמן חדש בקבוצה', `${name} נרשם ל${groupLabel(group)}`].join('\n')
    : ['↩️ מתאמן עזב את הקבוצה', `${name} כבר לא ב${groupLabel(group)}`].join('\n');
}

/**
 * A trainee joined or left one group.
 * @param {'joined'|'left'} action
 */
export async function notifyGroupMembershipChange({
  action,
  student,
  groupId,
  store = db,
} = {}) {
  const kind = action === 'left' ? 'group_student_left' : 'group_student_joined';
  const group = groupById(store, groupId);
  if (!group) return { sent: 0 };
  const subscribers = alertSubscribers(store, kind, { employeeIds: groupStaffIds(group) });
  if (!subscribers.length) return { sent: 0 };

  let sent = 0;
  for (const employee of subscribers) {
    const result = await sendStaffAlert({
      employee,
      kind,
      text: membershipText({ action, student, group }),
      variables: [employee.name || '', student?.name || '', groupLabel(group)],
      // No dedupe key: leaving and re-joining the same group is a real event
      // both times, and the trainer needs to hear about each.
    });
    if (result.sent) sent += 1;
  }
  return { sent };
}

/**
 * Compare the groups a trainee had with the groups they have now, and tell the
 * trainers on both sides. Called after a membership edit, with the ids captured
 * before it.
 */
export async function notifyGroupMembershipDiff({
  student,
  before = [],
  after = [],
  store = db,
} = {}) {
  const had = new Set((before || []).map((id) => String(id)));
  const has = new Set((after || []).map((id) => String(id)));
  const joined = [...has].filter((id) => !had.has(id));
  const left = [...had].filter((id) => !has.has(id));
  if (!joined.length && !left.length) return { sent: 0 };

  let sent = 0;
  for (const groupId of joined) {
    const r = await notifyGroupMembershipChange({ action: 'joined', student, groupId, store });
    sent += r.sent;
  }
  for (const groupId of left) {
    const r = await notifyGroupMembershipChange({ action: 'left', student, groupId, store });
    sent += r.sent;
  }
  return { sent, joined: joined.length, left: left.length };
}

function tomorrowIsraelDateStr(now = new Date()) {
  return israelDateStr(new Date(now.getTime() + 24 * 3600000));
}

/**
 * Trainees sitting on an intro status whose group meets on `date`.
 * One entry per (trainer, trainee, group) — the same child in two groups is two
 * different sessions, and each trainer only hears about their own.
 */
export function introHeadsUpCandidates({ date = tomorrowIsraelDateStr(), store = db } = {}) {
  const weekday = dateToWeekday(date);
  const groups = store.get('groups') || [];
  const byId = new Map(groups.map((g) => [String(g.id), g]));
  const out = [];

  for (const student of store.get('students') || []) {
    if (!INTRO_STATUSES.has(student.status)) continue;
    for (const gid of studentGroupIds(student)) {
      const group = byId.get(String(gid));
      if (!group || group.active === false) continue;
      if (!getGroupDays(group).includes(weekday)) continue;
      const subscribers = alertSubscribers(store, 'group_intro_upcoming', {
        employeeIds: groupStaffIds(group),
      });
      for (const employee of subscribers) {
        out.push({ employee, student, group, date });
      }
    }
  }
  return out;
}

function introText({ student, group, date }) {
  return [
    '👋 מגיע לאימון היכרות',
    `${student?.name || 'מתאמן'} — ${groupLabel(group)}`,
    group?.time ? `מחר בשעה ${group.time}` : 'מחר',
  ].filter(Boolean).join('\n');
}

/** Daily job: tell each trainer who is coming to try out tomorrow. */
export async function runIntroHeadsUp({ date = tomorrowIsraelDateStr(), store = db } = {}) {
  let candidates = [];
  try {
    candidates = introHeadsUpCandidates({ date, store });
  } catch (err) {
    console.error('intro heads-up scan failed:', err.message);
    return null;
  }
  if (!candidates.length) return { due: 0, sent: 0 };

  let sent = 0;
  for (const item of candidates) {
    const result = await sendStaffAlert({
      employee: item.employee,
      kind: 'group_intro_upcoming',
      text: introText(item),
      variables: [
        item.employee.name || '',
        item.student?.name || '',
        groupLabel(item.group),
        item.group?.time || '',
      ],
      sendId: `sa-intro-heads-up-${item.date}-${item.group.id}-${item.student.id}-${item.employee.id}`,
      date: item.date,
    });
    if (result.sent) sent += 1;
  }
  if (sent) console.log(`👋 היכרות מחר — הודעות למדריכים: ${sent}/${candidates.length}`);
  return { due: candidates.length, sent };
}

/** Once per Israel calendar day, in the evening — see the scheduler in index.js. */
let lastIntroHeadsUpDate = null;
export async function runIntroHeadsUpIfDue(hour = 17) {
  const today = israelDateStr();
  if (lastIntroHeadsUpDate === today) return null;
  if (israelHour() < hour) return null;
  lastIntroHeadsUpDate = today;
  const result = await runIntroHeadsUp();
  if (!result) lastIntroHeadsUpDate = null;
  return result;
}
