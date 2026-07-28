/**
 * Shared helpers for class-group capacity and waitlist.
 * Waitlisted students may keep a groupId for association but do not take a seat.
 * Membership can be multi-group via groupIds / enrollments.
 */

import { studentInGroup } from './studentGroups.js';

export const CAPACITY_EXCLUDED_STATUSES = new Set(['archived', 'waitlist']);

export function countsTowardCapacity(student, groupId) {
  if (!student || !groupId) return false;
  if (!studentInGroup(student, groupId)) return false;
  return !CAPACITY_EXCLUDED_STATUSES.has(String(student.status || ''));
}

export function countEnrolled(groupId, students = []) {
  return (students || []).filter((s) => countsTowardCapacity(s, groupId)).length;
}

export function maxSlotsOf(group) {
  const n = Number(group?.maxSlots);
  return Number.isFinite(n) && n > 0 ? n : 12;
}

export function spotsLeft(group, students = []) {
  if (!group?.id) return 0;
  return Math.max(0, maxSlotsOf(group) - countEnrolled(group.id, students));
}

export function isGroupFull(group, students = []) {
  return spotsLeft(group, students) <= 0;
}

export function enrichGroupsWithCapacity(groups = [], students = []) {
  return (groups || []).map((g) => {
    const enrolled = countEnrolled(g.id, students);
    const maxSlots = maxSlotsOf(g);
    const free = Math.max(0, maxSlots - enrolled);
    return {
      ...g,
      enrolled,
      maxSlots,
      freeSlots: free,
      isFull: free <= 0,
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
