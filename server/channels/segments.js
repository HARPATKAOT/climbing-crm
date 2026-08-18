import { db } from '../db.js';
import { getGroupDays } from '../attendanceUtils.js';
import { ageFromBirthDate } from './conversations.js';
import { canSendFreeform } from './sessionWindow.js';
import { studentGroupIds, studentInGroup } from '../studentGroups.js';
import { normalizeWaPhone } from '../whatsappConnect.js';
import { CHANNEL_PLACEHOLDER_NAMES } from '../db.js';

const REGISTERED_STATUSES = new Set([
  'registered', 'active', 'health_signed', 'details_completed',
  'awaiting_parent_confirmation', 'awaiting_centre_confirmation', 'intro_scheduled',
]);

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
/**
 * A recipient is a phone number, not a child and not a customer card.
 *
 * The same parent appears once per child in `students`, and sometimes twice in
 * `parents` (050… vs 972… duplicates). Counting by card meant a parent with two
 * matching children was two "recipients" — and paid-for twice. Matching still
 * happens per child (the filters describe children); the result is then folded
 * by normalized phone, so each number appears once, carrying every matched
 * child behind it.
 */
function scoreParentCard(parent) {
  let score = 0;
  const name = String(parent?.name || '').trim();
  if (name && !CHANNEL_PLACEHOLDER_NAMES.includes(name)) score += 4;
  if (parent?.email) score += 2;
  if (String(parent?.phone || '').startsWith('972')) score += 1;
  if (parent?.marketing_opt_in !== false) score += 1;
  return score;
}

export function previewAudience(filters = {}, { parents, students, groups } = {}) {
  const allParents = parents || db.get('parents') || [];
  const allStudents = students || db.get('students') || [];
  const allGroups = groups || db.get('groups') || [];
  const groupById = new Map(allGroups.map((g) => [g.id, g]));
  const parentById = new Map(allParents.map((p) => [p.id, p]));

  const listKey = filters.listKey || null;
  // כשמסננים לפי קבוצה ספציפית — הרישום לחוג מספיק,
  // ולא מסננים החוצה מי שלא מנוי לרשימת התפוצה (למשל «חוגים»).
  const hasGroupFilter = Array.isArray(filters.groupIds) && filters.groupIds.length > 0;
  let listSubs = null;
  if (listKey && !hasGroupFilter) {
    const records = db.get('broadcast_lists') || [];
    listSubs = new Map(
      records.filter((r) => r.listName === listKey).map((r) => [r.parentId, r.subscribed !== false])
    );
  }
  const isListSubscribed = (parent) =>
    !listSubs || (listSubs.has(parent.id) ? listSubs.get(parent.id) : true);

  // phone key -> { cards: Map<parentId, parent>, students: Map<studentId, …> }
  const byPhone = new Map();
  // Removed people are collected, not dropped: the suppression panel shows
  // them with their reason. A filter nobody can see is a filter nobody trusts.
  const unsubscribedPhones = new Set();
  const phoneKeyOf = (parent) =>
    normalizeWaPhone(parent.phone) || `invalid:${parent.id}`;

  // Opt-out and the 24h window belong to the phone, so duplicate cards that the
  // filters skipped still count: the number is silenced (or open) whichever
  // card recorded it.
  const siblingsByPhone = new Map();
  for (const parent of allParents) {
    if (!parent?.phone) continue;
    const key = normalizeWaPhone(parent.phone);
    if (!key) continue;
    if (!siblingsByPhone.has(key)) siblingsByPhone.set(key, []);
    siblingsByPhone.get(key).push(parent);
  }

  // מספר שרשום גם על רשומת מתאמן שייך למתאמן עצמו — לא להורה. מתאמן צעיר
  // שכתב פעם לעסק קיבל כרטיס לקוח משלו, ובלי הזיהוי הזה הוא נכנס לקהל דיוור
  // שמיועד להורים (זה בדיוק מה שקרה עם ליד של נער, 2026-08-16).
  const traineePhoneAges = new Map();
  for (const student of allStudents) {
    const key = normalizeWaPhone(student?.phone);
    if (!key) continue;
    const age = ageFromBirthDate(student.birthDate);
    const existing = traineePhoneAges.get(key);
    if (existing === undefined || (age != null && (existing == null || age > existing))) {
      traineePhoneAges.set(key, age);
    }
  }
  // 'parents' | 'parents_adults' (ברירת המחדל) | 'all'
  const audienceType = filters.audienceType || 'parents_adults';

  const addCard = (parent) => {
    const key = phoneKeyOf(parent);
    let entry = byPhone.get(key);
    if (!entry) {
      entry = { key, cards: new Map(), students: new Map() };
      byPhone.set(key, entry);
    }
    entry.cards.set(parent.id, parent);
    return entry;
  };

  for (const student of allStudents) {
    if (!matchStudent(student, filters, groupById)) continue;
    const parent = parentById.get(student.parentId);
    if (!parent) continue;
    if (!matchParent(parent, filters)) continue;
    if (!isListSubscribed(parent)) unsubscribedPhones.add(phoneKeyOf(parent));
    const entry = addCard(parent);
    if (!entry.students.has(student.id)) {
      entry.students.set(student.id, {
        id: student.id,
        name: student.name || '',
        status: student.status || '',
        age: ageFromBirthDate(student.birthDate),
        parentId: parent.id,
      });
    }
  }

  // Parents with no students still included if only parent filters apply and registered=any/no
  if (filters.includeParentsWithoutStudents) {
    for (const parent of allParents) {
      if (!matchParent(parent, filters)) continue;
      const kids = allStudents.filter((s) => s.parentId === parent.id);
      if (kids.length) continue;
      if (!isListSubscribed(parent)) unsubscribedPhones.add(phoneKeyOf(parent));
      addCard(parent);
    }
  }

  /** מי שכבר בפנים: הרשמה חיה, לא ליד ולא מי שהיה רשום בעבר. */
const REGISTERED_STATUSES = new Set([
  'registered', 'active', 'awaiting_centre_confirmation', 'awaiting_parent_confirmation',
]);

const recipients = [];
  const removed = [];
  let childCount = 0;
  for (const entry of byPhone.values()) {
    const cards = [...entry.cards.values()];
    const primary = cards.reduce((best, card) =>
      (scoreParentCard(card) > scoreParentCard(best) ? card : best), cards[0]);
    const kids = [...entry.students.values()];
    const siblings = siblingsByPhone.get(entry.key) || cards;
    const optedOut = siblings.some((card) => card.marketing_opt_in === false);
    const listUnsubscribed = unsubscribedPhones.has(entry.key);
    // סוג הנמען: המספר של מתאמן עצמו — בוגר (18+) או צעיר — לעומת הורה.
    const traineeAge = traineePhoneAges.has(entry.key) ? traineePhoneAges.get(entry.key) : undefined;
    const recipientKind = traineeAge === undefined
      ? 'parent'
      : (traineeAge != null && traineeAge >= 18 ? 'adult_trainee' : 'trainee_phone');
    const excludedByAudienceType = (audienceType === 'parents' && recipientKind !== 'parent')
      || (audienceType === 'parents_adults' && recipientKind === 'trainee_phone');
    const recipient = {
      id: entry.key,
      phone: entry.key.startsWith('invalid:') ? String(primary.phone || '') : entry.key,
      invalidPhone: entry.key.startsWith('invalid:'),
      name: primary.name || '',
      parentId: primary.id,
      parentIds: cards.map((card) => card.id),
      city: primary.city || cards.find((card) => card.city)?.city || '',
      marketingOptOut: optedOut,
      listUnsubscribed,
      recipientKind,
      excludedByAudienceType,
      windowOpen: siblings.some((card) => canSendFreeform(card, 'whatsapp')),
      // „ההרשמה נפתחה! מהרו לשריין מקום” הגיעה למשפחות שכבר רשומות, וארבע מהן
      // ענו בבלבול — „אבל כבר נרשמתי לא?”. מי שיש לו ילד משובץ ורשום כבר
      // עשה את מה שההודעה מבקשת ממנו.
      hasActiveRegistration: kids.some((kid) => REGISTERED_STATUSES.has(String(kid.status || ''))),
      students: kids,
      // Legacy fields for existing consumers (recipients viewer, old jobs).
      studentName: kids.map((k) => k.name).filter(Boolean).join(' · '),
      studentStatus: kids[0]?.status || '',
      age: kids[0]?.age ?? null,
    };
    // The people the filters would once drop silently — the list unsubscribers,
    // the opted-out (under the default opt-in filter) and trainee-owned phones
    // — go to `removed`, where the suppression panel can show them by name.
    if (listUnsubscribed || excludedByAudienceType || (optedOut && filters.marketingOptIn === true)) {
      removed.push(recipient);
      continue;
    }
    childCount += kids.length;
    recipients.push(recipient);
  }

  recipients.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'he'));

  return {
    count: recipients.length,
    childCount,
    cardCount: recipients.reduce((sum, r) => sum + r.parentIds.length, 0),
    recipients,
    removed,
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
  const groupIds = studentGroupIds(student);
  const isRegistered = !!(groupIds.length && REGISTERED_STATUSES.has(student.status));
  if (registered === 'yes' && !isRegistered) return false;
  if (registered === 'no' && isRegistered) return false;

  if (Array.isArray(filters.groupIds) && filters.groupIds.length) {
    if (!filters.groupIds.some((gid) => studentInGroup(student, gid))) return false;
  }

  if (Array.isArray(filters.groupDays) && filters.groupDays.length) {
    const days = [];
    for (const gid of groupIds) {
      const group = groupById.get(gid);
      if (group) days.push(...getGroupDays(group).map(Number));
    }
    const wanted = filters.groupDays.map(Number);
    if (!days.some((d) => wanted.includes(d))) return false;
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

function matchParent(parent, filters) {
  if (!parent?.phone) return false;

  if (Array.isArray(filters.cities) && filters.cities.length) {
    if (!filters.cities.includes(parent.city)) return false;
  }

  // marketingOptIn===true (ברירת המחדל) לא מסונן כאן: הנמען נאסף, מסומן
  // marketingOptOut, ומוסר בסוף אל תוך `removed` — כדי שפאנל החסימות יראה אותו.
  if (filters.marketingOptIn === false && parent.marketing_opt_in !== false) return false;

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
