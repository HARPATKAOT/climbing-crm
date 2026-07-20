import { db } from '../db.js';
import { ageFromBirthDate } from './conversations.js';
import { canSendFreeform } from './sessionWindow.js';

const REGISTERED_STATUSES = new Set(['registered', 'active', 'health_signed', 'intro_scheduled']);

/**
 * filters shape:
 * {
 *   ageMin, ageMax,
 *   cities: [],
 *   statuses: [],
 *   registered: 'yes'|'no'|'any',
 *   groupIds: [],
 *   groupDays: [],  // 0-6
 *   genders: [],
 *   interests: [],
 *   listKey: string|null,
 *   marketingOptIn: boolean|null,
 *   onlyOpenWindow: boolean
 * }
 */
export function previewAudience(filters = {}, { parents, students, groups } = {}) {
  const allParents = parents || db.get('parents') || [];
  const allStudents = students || db.get('students') || [];
  const allGroups = groups || db.get('groups') || [];
  const groupById = new Map(allGroups.map((g) => [g.id, g]));

  const listKey = filters.listKey || null;
  let listSubs = null;
  if (listKey) {
    const records = db.get('broadcast_lists') || [];
    listSubs = new Map(
      records.filter((r) => r.listName === listKey).map((r) => [r.parentId, r.subscribed !== false])
    );
  }

  const matchedParents = [];
  const seen = new Set();

  for (const student of allStudents) {
    if (!matchStudent(student, filters, groupById)) continue;
    const parent = allParents.find((p) => p.id === student.parentId);
    if (!parent || seen.has(parent.id)) continue;
    if (!matchParent(parent, filters, listSubs)) continue;
    seen.add(parent.id);
    matchedParents.push({
      id: parent.id,
      name: parent.name,
      phone: parent.phone,
      city: parent.city || '',
      windowOpen: canSendFreeform(parent, 'whatsapp'),
      studentName: student.name,
      studentStatus: student.status,
      age: ageFromBirthDate(student.birthDate),
    });
  }

  // Parents with no students still included if only parent filters apply and registered=any/no
  if (filters.includeParentsWithoutStudents) {
    for (const parent of allParents) {
      if (seen.has(parent.id)) continue;
      if (!matchParent(parent, filters, listSubs)) continue;
      const kids = allStudents.filter((s) => s.parentId === parent.id);
      if (kids.length) continue;
      matchedParents.push({
        id: parent.id,
        name: parent.name,
        phone: parent.phone,
        city: parent.city || '',
        windowOpen: canSendFreeform(parent, 'whatsapp'),
        studentName: '',
        studentStatus: '',
        age: null,
      });
    }
  }

  return {
    count: matchedParents.length,
    recipients: matchedParents,
  };
}

function matchStudent(student, filters, groupById) {
  const age = ageFromBirthDate(student.birthDate);
  if (filters.ageMin != null && filters.ageMin !== '' && (age == null || age < Number(filters.ageMin))) {
    return false;
  }
  if (filters.ageMax != null && filters.ageMax !== '' && (age == null || age > Number(filters.ageMax))) {
    return false;
  }

  if (Array.isArray(filters.statuses) && filters.statuses.length) {
    if (!filters.statuses.includes(student.status)) return false;
  }

  const registered = filters.registered || 'any';
  const isRegistered = !!(student.groupId && REGISTERED_STATUSES.has(student.status));
  if (registered === 'yes' && !isRegistered) return false;
  if (registered === 'no' && isRegistered) return false;

  if (Array.isArray(filters.groupIds) && filters.groupIds.length) {
    if (!filters.groupIds.includes(student.groupId)) return false;
  }

  if (Array.isArray(filters.groupDays) && filters.groupDays.length) {
    const group = groupById.get(student.groupId);
    if (!group || !filters.groupDays.map(Number).includes(Number(group.day))) return false;
  }

  if (Array.isArray(filters.genders) && filters.genders.length) {
    if (!filters.genders.includes(student.gender)) return false;
  }

  if (Array.isArray(filters.interests) && filters.interests.length) {
    const interests = Array.isArray(student.interests) ? student.interests : [];
    if (!filters.interests.some((i) => interests.includes(i))) return false;
  }

  return true;
}

function matchParent(parent, filters, listSubs) {
  if (!parent?.phone) return false;

  if (Array.isArray(filters.cities) && filters.cities.length) {
    if (!filters.cities.includes(parent.city)) return false;
  }

  if (filters.marketingOptIn === true && parent.marketing_opt_in === false) return false;
  if (filters.marketingOptIn === false && parent.marketing_opt_in !== false) return false;

  if (listSubs) {
    const subscribed = listSubs.has(parent.id) ? listSubs.get(parent.id) : true;
    if (!subscribed) return false;
  }

  if (filters.onlyOpenWindow && !canSendFreeform(parent, 'whatsapp')) return false;

  return true;
}

export function listSavedSegments() {
  return [...(db.get('saved_segments') || [])].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'he')
  );
}

export function saveSegment(name, filters) {
  return db.insert('saved_segments', {
    id: `seg_${Date.now()}`,
    name: String(name || '').trim() || 'קהל שמור',
    filters: filters || {},
  });
}

export function deleteSegment(id) {
  db.delete('saved_segments', id);
  return { success: true };
}

export const INTEREST_OPTIONS = [
  'חוגי ילדים / נוער',
  'חוג בוגרים',
  'קייטנה',
  'אימון הכירות',
  'יום הולדת',
  'ימי שטח',
  'אימון אישי',
  'קורס הובלה',
  'טיפוס בשעות הפתיחה',
];
