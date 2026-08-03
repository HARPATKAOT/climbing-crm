/**
 * Shared helpers for class-group capacity and waitlist.
 * Waitlisted students may keep a groupId for association but do not take a seat.
 * Membership can be multi-group via groupIds / enrollments.
 */

import { studentInGroup } from './studentGroups.js';

// 'pending_signup' is a soft hold while the customer completes registration at
// the מתנ"ס: the group association is kept, but the seat stays open for others.
export const CAPACITY_EXCLUDED_STATUSES = new Set(['archived', 'waitlist', 'pending_signup']);

export function countsTowardCapacity(student, groupId) {
  if (!student || !groupId) return false;
  if (!studentInGroup(student, groupId)) return false;
  return !CAPACITY_EXCLUDED_STATUSES.has(String(student.status || ''));
}

export function countEnrolled(groupId, students = []) {
  return (students || []).filter((s) => countsTowardCapacity(s, groupId)).length;
}

/**
 * The group's capacity, or `null` when nobody has set one.
 *
 * This used to answer 12 for an unset capacity, and that invented number was
 * published as fact — "8 מקומות פנויים" on the public site and in WhatsApp,
 * for a class whose real size nobody had recorded. A gym can recover from
 * "we'll check how many places are left"; it cannot un-enrol a child it
 * accepted into a class that was already full.
 */
export function maxSlotsOf(group) {
  const n = Number(group?.maxSlots);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Free places, or `null` when the capacity is unknown. */
export function spotsLeft(group, students = []) {
  if (!group?.id) return 0;
  const max = maxSlotsOf(group);
  if (max === null) return null;
  return Math.max(0, max - countEnrolled(group.id, students));
}

/** Unknown capacity is never "full" — we have no grounds to turn anyone away. */
export function isGroupFull(group, students = []) {
  const free = spotsLeft(group, students);
  return free !== null && free <= 0;
}

export function enrichGroupsWithCapacity(groups = [], students = []) {
  return (groups || []).map((g) => {
    const enrolled = countEnrolled(g.id, students);
    const maxSlots = maxSlotsOf(g);
    const free = maxSlots === null ? null : Math.max(0, maxSlots - enrolled);
    return {
      ...g,
      enrolled,
      maxSlots,
      freeSlots: free,
      isFull: free !== null && free <= 0,
      capacityKnown: maxSlots !== null,
    };
  });
}

export function waitlistForGroup(groupId, students = []) {
  return (students || []).filter(
    (s) => studentInGroup(s, groupId) && String(s.status || '') === 'waitlist'
  );
}

const DAY_LETTER_TO_INDEX = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5 };

export function extractPreferredDayIndex(text) {
  const raw = String(text || '');
  const m = raw.match(/יום\s*([א-ו])['׳']?/i) || raw.match(/\b([א-ו])['׳']\b/);
  if (!m) return null;
  const idx = DAY_LETTER_TO_INDEX[m[1]];
  return Number.isInteger(idx) ? idx : null;
}

export function extractTimeHint(text) {
  const m = String(text || '').match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

export function wantsWaitlist(text) {
  const t = String(text || '');
  return /רשימת\s*המתנה|להמתנה|שיבוץ\s*להמתנה|תכניסו.*המתנה|שימו\s*אותי.*המתנה|רשמו\s*אותי\s*להמתנה|הכניסו\s*להמתנה|מקום\s*ברשימת/.test(t);
}

/** Pick best matching group among candidates (prefer day/time hints; prefer full when waitlisting). */
export function pickGroupForWaitlist(groups, students, { dayIndex = null, timeHint = '', preferFull = true } = {}) {
  let list = enrichGroupsWithCapacity(groups || [], students);
  if (!list.length) return null;

  if (dayIndex != null) {
    const byDay = list.filter((g) => Number(g.day) === Number(dayIndex));
    if (byDay.length) list = byDay;
  }
  if (timeHint) {
    const byTime = list.filter((g) => String(g.time || '').startsWith(timeHint.slice(0, 5)));
    if (byTime.length) list = byTime;
  }

  const ranked = [...list].sort((a, b) => {
    if (preferFull && a.isFull !== b.isFull) return a.isFull ? -1 : 1;
    if (!preferFull && a.isFull !== b.isFull) return a.isFull ? 1 : -1;
    return Number(a.day) - Number(b.day) || String(a.time || '').localeCompare(String(b.time || ''));
  });
  return ranked[0] || null;
}
