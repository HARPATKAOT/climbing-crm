import crypto from 'crypto';
import { israelDateStr, getSortedGroupDays, normalizeAttStatus, isIntroAttStatus } from './attendanceUtils.js';
import { israelTimeToEpoch } from './shiftAlerts.js';
import { countsTowardCapacity, maxSlotsOf } from './groupCapacity.js';
import { enrollmentId, studentGroupIds } from './studentGroups.js';
import { supa } from './supa.js';
import { isIntroTrainingItem } from './introStatus.js';

export const HOLD_COLLECTION = 'group_placement_holds';
export const WAITLIST_COLLECTION = 'group_waitlist_entries';
export const INTRO_COLLECTION = 'intro_bookings';
export const LIFECYCLE_EVENT_COLLECTION = 'registration_lifecycle_events';

export const REGISTRATION_STATUS = Object.freeze({
  LEAD_NEW: 'lead_new',
  DETAILS_COMPLETED: 'details_completed',
  WAITLIST: 'waitlist',
  INTRO_SCHEDULED: 'intro_scheduled',
  AWAITING_PARENT: 'awaiting_parent_confirmation',
  AWAITING_CENTRE: 'awaiting_centre_confirmation',
  REGISTERED: 'registered',
});

export const HOLD_PHASE = Object.freeze({
  AWAITING_PARENT: 'awaiting_parent',
  AWAITING_CENTRE: 'awaiting_centre',
  WAITLIST_OFFER: 'waitlist_offer',
  INTRO_PAYMENT: 'intro_payment',
  INTRO_SCHEDULED: 'intro_scheduled',
  INTRO_DECISION: 'intro_decision',
});

export const HOLD_ACTIVE = 'active';
export const HOLD_RELEASED = 'released';
export const HOLD_EXPIRED = 'expired';
export const HOLD_REGISTERED = 'registered';

export const GROUP_PLACEMENT_MODE = Object.freeze({
  NONE: 'none',
  FIXED: 'fixed',
  HOLD: 'hold',
  WAITLIST: 'waitlist',
});

const ISRAEL_ZONE = 'Asia/Jerusalem';
const DAY_MS = 24 * 60 * 60 * 1000;
const localClaimLocks = new Map();

function rows(db, collection) {
  const value = db?.get?.(collection);
  return Array.isArray(value) ? value : [];
}

function nowIso(now = new Date()) {
  return new Date(now).toISOString();
}

function addIsoDays(dateStr, days) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1, day + Number(days || 0), 12, 0, 0));
  return at.toISOString().slice(0, 10);
}

function israelParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ISRAEL_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdays[get('weekday')] ?? -1,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** End of N complete Israel calendar days after the current one. */
export function fullDayDeadline(now = new Date(), fullDays = 3) {
  const date = addIsoDays(israelDateStr(new Date(now)), fullDays);
  return new Date(israelTimeToEpoch(date, '23:59') + 59_999).toISOString();
}

export function reminderAtDeadlineMorning(deadline) {
  const date = israelDateStr(new Date(deadline));
  return new Date(israelTimeToEpoch(date, '09:00')).toISOString();
}

export function endOfIsraelDay(now = new Date()) {
  const date = israelDateStr(new Date(now));
  return new Date(israelTimeToEpoch(date, '23:59') + 59_999).toISOString();
}

function sha(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 18);
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function holdId(studentId, groupIds, phase, now) {
  return `gph_${sha(`${studentId}|${uniqueStrings(groupIds).sort().join(',')}|${phase}|${nowIso(now)}`)}`;
}

function eventId(kind, entityId, occurrence = '') {
  return `rle_${sha(`${kind}|${entityId}|${occurrence}`)}`;
}

async function requirePersist(persist, collection, record) {
  if (!record || typeof persist !== 'function') return;
  const result = await persist(collection, record);
  if (result && result.ok === false) {
    throw Object.assign(new Error(result.error || `Failed to persist ${collection}`), {
      code: 'durable_write_failed',
    });
  }
}

function holdExpiresAt(phase, now = new Date()) {
  if (phase === HOLD_PHASE.AWAITING_PARENT) return fullDayDeadline(now, 3);
  if (phase === HOLD_PHASE.AWAITING_CENTRE) return fullDayDeadline(now, 10);
  if (phase === HOLD_PHASE.WAITLIST_OFFER) return new Date(new Date(now).getTime() + DAY_MS).toISOString();
  if (phase === HOLD_PHASE.INTRO_PAYMENT) return endOfIsraelDay(now);
  return null;
}

export function isActiveHold(hold, now = new Date()) {
  if (!hold || String(hold.status) !== HOLD_ACTIVE) return false;
  const expiry = String(hold.expires_at || '').trim();
  return !expiry || new Date(expiry).getTime() > new Date(now).getTime();
}

export function activeHolds(db, now = new Date()) {
  return rows(db, HOLD_COLLECTION).filter((hold) => isActiveHold(hold, now));
}

export function activeHoldForStudent(db, studentId, now = new Date()) {
  return activeHolds(db, now)
    .filter((hold) => String(hold.student_id) === String(studentId))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
}

export function activeHoldsForGroup(db, groupId, now = new Date()) {
  return activeHolds(db, now).filter((hold) => (
    Array.isArray(hold.group_ids) && hold.group_ids.map(String).includes(String(groupId))
  ));
}

/** Count unique trainees, never both their student row and their hold. */
export function occupiedSeatIds(db, groupId, now = new Date(), { excludeStudentId = null } = {}) {
  const ids = new Set();
  for (const student of db?.withStudentRelations?.(rows(db, 'students')) || rows(db, 'students')) {
    if (excludeStudentId && String(student.id) === String(excludeStudentId)) continue;
    if (countsTowardCapacity(student, groupId, { now })) ids.add(String(student.id));
  }
  for (const hold of activeHoldsForGroup(db, groupId, now)) {
    if (excludeStudentId && String(hold.student_id) === String(excludeStudentId)) continue;
    ids.add(String(hold.student_id));
  }
  return ids;
}

export function capacityForGroup(db, groupId, now = new Date(), options = {}) {
  const group = db?.getOne?.('groups', groupId);
  if (!group) return { ok: false, reason: 'group_not_found', group: null };
  const capacity = maxSlotsOf(group);
  if (capacity === null) return { ok: false, reason: 'capacity_unknown', group, capacity: null };
  const occupied = occupiedSeatIds(db, groupId, now, options).size;
  return {
    ok: occupied < capacity,
    reason: occupied < capacity ? 'available' : 'full',
    group,
    capacity,
    occupied,
    free: Math.max(0, capacity - occupied),
  };
}

function capacityCheck(db, groupIds, studentId, now) {
  const snapshots = uniqueStrings(groupIds).map((groupId) => (
    capacityForGroup(db, groupId, now, { excludeStudentId: studentId })
  ));
  const failed = snapshots.find((snapshot) => !snapshot.ok);
  return failed ? { ok: false, reason: failed.reason, group: failed.group, snapshots } : { ok: true, snapshots };
}

async function withLocalClaimLock(groupIds, operation) {
  const key = uniqueStrings(groupIds).sort().join('|');
  const previous = localClaimLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => next);
  localClaimLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (localClaimLocks.get(key) === queued) localClaimLocks.delete(key);
  }
}

function putLocalRecord(db, collection, record) {
  const existing = db?.getOne?.(collection, record.id);
  if (existing) return db.update(collection, record.id, record) || record;
  if (typeof db?.mergeLocal === 'function') {
    db.mergeLocal(collection, [record]);
    return record;
  }
  return db.insert(collection, record);
}

async function claimHoldRecord({ db, persist, record, now }) {
  if (supa.isEnabled()) {
    const claimed = await supa.claimGroupPlacementHold(record);
    if (!claimed?.ok) return claimed || { ok: false, reason: 'atomic_claim_failed' };
    const saved = claimed.record || record;
    putLocalRecord(db, HOLD_COLLECTION, saved);
    return { ok: true, record: saved, duplicate: Boolean(claimed.duplicate) };
  }

  // Local development has no database transaction. Serialising all claims is
  // intentionally conservative and also protects one trainee racing between
  // two different groups, whose group lock keys would otherwise differ.
  return withLocalClaimLock(['all-placement-holds'], async () => {
    const existing = activeHoldForStudent(db, record.student_id, now);
    if (existing && uniqueStrings(existing.group_ids).sort().join(',') === record.group_ids.sort().join(',')) {
      return { ok: true, record: existing, duplicate: true };
    }
    if (existing) {
      return { ok: false, reason: 'student_already_holding', hold: existing };
    }
    const available = capacityCheck(db, record.group_ids, record.student_id, now);
    if (!available.ok) return available;
    const saved = db.insert(HOLD_COLLECTION, record);
    try {
      await requirePersist(persist, HOLD_COLLECTION, saved);
    } catch (error) {
      // Never count a local phantom reservation after its durable write failed.
      db.delete?.(HOLD_COLLECTION, saved.id);
      throw error;
    }
    return { ok: true, record: saved, duplicate: false };
  });
}

async function persistMembership(db, persist, student, groupIds, { primaryGroupId = null } = {}) {
  const ids = uniqueStrings(groupIds);
  const related = typeof db.withStudentRelation === 'function' ? db.withStudentRelation(student) : student;
  const currentIds = studentGroupIds(related);
  const changed = currentIds.length !== ids.length || currentIds.some((id) => !ids.includes(String(id)));
  const updated = changed && typeof db.setStudentGroups === 'function'
    ? db.setStudentGroups(student.id, ids, { primaryGroupId: primaryGroupId || ids[0] || null })
    : db.update('students', student.id, { groupId: primaryGroupId || ids[0] || null, groupIds: ids });
  if (updated) await requirePersist(persist, 'students', updated);
  for (const groupId of ids) {
    const id = enrollmentId(student.id, groupId);
    const enrollment = db.getOne('enrollments', id);
    if (enrollment) await requirePersist(persist, 'enrollments', enrollment);
  }
  return updated || student;
}

async function assignHoldToStudent({ db, persist, student, hold }) {
  let updated = await persistMembership(db, persist, student, hold.group_ids, {
    primaryGroupId: hold.primary_group_id,
  });
  const status = hold.phase === HOLD_PHASE.AWAITING_CENTRE
    ? REGISTRATION_STATUS.AWAITING_CENTRE
    : (hold.phase === HOLD_PHASE.INTRO_SCHEDULED || hold.phase === HOLD_PHASE.INTRO_DECISION
      ? REGISTRATION_STATUS.INTRO_SCHEDULED
      : REGISTRATION_STATUS.AWAITING_PARENT);
  updated = db.update('students', student.id, {
    status,
    placement_hold_until: hold.expires_at || null,
    placement_hold_firm: true,
    placement_reported_at: hold.phase === HOLD_PHASE.AWAITING_CENTRE ? hold.parent_confirmed_at : null,
  }) || updated;
  await requirePersist(persist, 'students', updated);
  return updated;
}

export async function createPlacementHold({
  db,
  persist,
  student,
  parent = null,
  groups = [],
  phase = HOLD_PHASE.AWAITING_PARENT,
  source = 'crm',
  now = new Date(),
  assignStudent = true,
  expiresAt = null,
  metadata = {},
} = {}) {
  if (!student?.id) return { ok: false, reason: 'student_not_found' };
  const groupRows = (groups || []).filter(Boolean);
  const groupIds = uniqueStrings(groupRows.map((group) => group.id));
  if (!groupIds.length) return { ok: false, reason: 'group_not_found' };
  const existing = activeHoldForStudent(db, student.id, now);
  if (existing && uniqueStrings(existing.group_ids).sort().join(',') === [...groupIds].sort().join(',')) {
    if (assignStudent && [HOLD_PHASE.AWAITING_PARENT, HOLD_PHASE.AWAITING_CENTRE].includes(existing.phase)) {
      await assignHoldToStudent({ db, persist, student, hold: existing });
    }
    return { ok: true, hold: existing, duplicate: true, student: db.getOne('students', student.id) };
  }

  const createdAt = nowIso(now);
  const expiry = expiresAt || holdExpiresAt(phase, now);
  const record = {
    id: holdId(student.id, groupIds, phase, now),
    student_id: student.id,
    student_name: student.name || '',
    parent_id: parent?.id || student.parentId || null,
    primary_group_id: groupIds[0],
    group_ids: groupIds,
    phase,
    status: HOLD_ACTIVE,
    starts_at: createdAt,
    expires_at: expiry,
    reminder_at: phase === HOLD_PHASE.AWAITING_PARENT && expiry
      ? reminderAtDeadlineMorning(expiry)
      : null,
    reminder_sent_at: null,
    source,
    idempotency_key: `placement:${student.id}:${[...groupIds].sort().join(',')}:${phase}`,
    metadata,
    created_at: createdAt,
    updated_at: createdAt,
  };
  const claimed = await claimHoldRecord({ db, persist, record, now });
  if (!claimed.ok) return claimed;
  const hold = claimed.record;
  let updatedStudent = student;
  if (assignStudent && !claimed.duplicate) {
    try {
      updatedStudent = await assignHoldToStudent({ db, persist, student, hold });
    } catch (error) {
      const released = db.update(HOLD_COLLECTION, hold.id, {
        status: HOLD_RELEASED,
        release_reason: 'student_assignment_failed',
        released_at: nowIso(now),
      });
      if (released) await requirePersist(persist, HOLD_COLLECTION, released);
      throw error;
    }
  }
  return { ok: true, hold, duplicate: Boolean(claimed.duplicate), student: updatedStudent };
}

export async function updateHoldPhase({ db, persist, hold, phase, now = new Date(), expiresAt = null } = {}) {
  if (!hold?.id || !isActiveHold(hold, now)) return { ok: false, reason: 'no_active_hold' };
  const expiry = expiresAt || holdExpiresAt(phase, now);
  const patch = {
    phase,
    expires_at: expiry,
    reminder_at: phase === HOLD_PHASE.AWAITING_PARENT && expiry ? reminderAtDeadlineMorning(expiry) : null,
    reminder_sent_at: null,
    updated_at: nowIso(now),
    ...(phase === HOLD_PHASE.AWAITING_CENTRE ? { parent_confirmed_at: nowIso(now) } : {}),
  };
  const updated = db.update(HOLD_COLLECTION, hold.id, patch);
  if (!updated) return { ok: false, reason: 'hold_not_found' };
  await requirePersist(persist, HOLD_COLLECTION, updated);
  return { ok: true, hold: updated };
}

export async function confirmParentRegistration({ db, persist, student, now = new Date() } = {}) {
  const hold = activeHoldForStudent(db, student?.id, now);
  if (!hold) return { ok: false, reason: 'no_active_hold' };
  if (hold.phase === HOLD_PHASE.AWAITING_CENTRE) return { ok: true, hold, duplicate: true, student };
  if (![HOLD_PHASE.AWAITING_PARENT, HOLD_PHASE.INTRO_DECISION].includes(hold.phase)) {
    return { ok: false, reason: 'hold_not_awaiting_parent' };
  }
  const advanced = await updateHoldPhase({ db, persist, hold, phase: HOLD_PHASE.AWAITING_CENTRE, now });
  if (!advanced.ok) return advanced;
  const updatedStudent = await assignHoldToStudent({ db, persist, student, hold: advanced.hold });
  return { ok: true, hold: advanced.hold, student: updatedStudent, duplicate: false };
}

export async function markPlacementRegistered({ db, persist, student, now = new Date(), source = 'centre' } = {}) {
  if (!student?.id) return { ok: false, reason: 'student_not_found' };
  const hold = activeHoldForStudent(db, student.id, now);
  if (hold) {
    const completed = db.update(HOLD_COLLECTION, hold.id, {
      status: HOLD_REGISTERED,
      phase: 'registered',
      registered_at: nowIso(now),
      registered_source: source,
      expires_at: null,
      reminder_at: null,
      updated_at: nowIso(now),
    });
    if (completed) await requirePersist(persist, HOLD_COLLECTION, completed);
  }
  const updated = db.update('students', student.id, {
    status: REGISTRATION_STATUS.REGISTERED,
    placement_hold_until: null,
    placement_hold_firm: false,
  });
  if (updated) await requirePersist(persist, 'students', updated);

  const otherWaitlists = [];
  for (const entry of rows(db, WAITLIST_COLLECTION)) {
    if (String(entry.student_id) !== String(student.id)) continue;
    if (!['waiting', 'offered'].includes(String(entry.status))) continue;
    if (hold?.group_ids?.map(String).includes(String(entry.group_id))) continue;
    const paused = db.update(WAITLIST_COLLECTION, entry.id, {
      status: 'paused_after_acceptance',
      paused_at: nowIso(now),
      updated_at: nowIso(now),
    });
    if (paused) {
      await requirePersist(persist, WAITLIST_COLLECTION, paused);
      otherWaitlists.push(paused);
    }
  }
  return { ok: true, student: updated || student, hold, otherWaitlists };
}

/** Resolve the explicit question sent after a trainee is accepted elsewhere. */
export async function resolveOtherWaitlists({
  db,
  persist,
  student,
  keep,
  now = new Date(),
} = {}) {
  if (!student?.id) return { ok: false, reason: 'student_not_found' };
  if (typeof keep !== 'boolean') return { ok: false, reason: 'decision_required' };
  const paused = rows(db, WAITLIST_COLLECTION).filter((entry) => (
    String(entry.student_id) === String(student.id)
    && String(entry.status) === 'paused_after_acceptance'
  ));
  if (!paused.length) return { ok: false, reason: 'no_paused_waitlists' };
  const updated = [];
  for (const entry of paused) {
    const row = db.update(WAITLIST_COLLECTION, entry.id, keep
      ? {
        status: 'waiting',
        paused_at: null,
        waitlist_decision: 'keep',
        waitlist_decided_at: nowIso(now),
        updated_at: nowIso(now),
      }
      : {
        status: 'removed',
        removed_at: nowIso(now),
        removal_reason: 'accepted_other_group',
        waitlist_decision: 'leave',
        waitlist_decided_at: nowIso(now),
        updated_at: nowIso(now),
      });
    if (row) {
      await requirePersist(persist, WAITLIST_COLLECTION, row);
      updated.push(row);
    }
  }
  return { ok: true, keep, entries: updated };
}

export async function releasePlacementHold({
  db,
  persist,
  hold,
  now = new Date(),
  reason = 'expired',
  nextStudentStatus = REGISTRATION_STATUS.DETAILS_COMPLETED,
  removeMembership = true,
} = {}) {
  if (!hold?.id) return { ok: false, reason: 'hold_not_found' };
  if (String(hold.status) !== HOLD_ACTIVE) return { ok: true, hold, duplicate: true };
  const updatedHold = db.update(HOLD_COLLECTION, hold.id, {
    status: reason === 'expired' ? HOLD_EXPIRED : HOLD_RELEASED,
    release_reason: reason,
    released_at: nowIso(now),
    expires_at: hold.expires_at || nowIso(now),
    updated_at: nowIso(now),
  });
  if (updatedHold) await requirePersist(persist, HOLD_COLLECTION, updatedHold);

  const student = db.getOne('students', hold.student_id);
  let updatedStudent = student;
  if (student && String(student.status) !== REGISTRATION_STATUS.REGISTERED) {
    if (removeMembership && typeof db.setStudentGroups === 'function') {
      const current = studentGroupIds(db.withStudentRelation?.(student) || student);
      const remove = new Set(uniqueStrings(hold.group_ids));
      const remaining = current.filter((groupId) => !remove.has(String(groupId)));
      updatedStudent = await persistMembership(db, persist, student, remaining, {
        primaryGroupId: remaining[0] || null,
      });
    }
    updatedStudent = db.update('students', student.id, {
      status: nextStudentStatus,
      placement_hold_until: null,
      placement_hold_firm: false,
    }) || updatedStudent;
    await requirePersist(persist, 'students', updatedStudent);
  }
  return { ok: true, hold: updatedHold || hold, student: updatedStudent };
}

export function waitlistEntriesForGroup(db, groupId, { includeInactive = false } = {}) {
  const list = rows(db, WAITLIST_COLLECTION)
    .filter((entry) => String(entry.group_id) === String(groupId))
    .filter((entry) => includeInactive || ['waiting', 'offered', 'paused_after_acceptance'].includes(String(entry.status)))
    .sort((a, b) => String(a.queue_entered_at || a.joined_at || a.created_at || '')
      .localeCompare(String(b.queue_entered_at || b.joined_at || b.created_at || '')));
  return list.map((entry, index) => ({ ...entry, position: index + 1 }));
}

export async function joinGroupWaitlist({ db, persist, student, parent = null, group, now = new Date(), source = 'bot' } = {}) {
  if (!student?.id || !group?.id) return { ok: false, reason: 'missing_student_or_group' };
  const id = `gwl_${sha(`${group.id}|${student.id}`)}`;
  const existing = db.getOne(WAITLIST_COLLECTION, id);
  const stamp = nowIso(now);
  const record = existing
    ? db.update(WAITLIST_COLLECTION, id, {
      status: 'waiting',
      queue_entered_at: existing.queue_entered_at || existing.joined_at || stamp,
      updated_at: stamp,
    })
    : db.insert(WAITLIST_COLLECTION, {
      id,
      student_id: student.id,
      student_name: student.name || '',
      parent_id: parent?.id || student.parentId || null,
      group_id: group.id,
      group_name: group.name || '',
      status: 'waiting',
      joined_at: stamp,
      queue_entered_at: stamp,
      offers: 0,
      source,
      created_at: stamp,
      updated_at: stamp,
    });
  await requirePersist(persist, WAITLIST_COLLECTION, record);
  const active = activeHoldForStudent(db, student.id, now);
  let updatedStudent = student;
  if (!active && String(student.status) !== REGISTRATION_STATUS.REGISTERED) {
    updatedStudent = db.update('students', student.id, { status: REGISTRATION_STATUS.WAITLIST }) || student;
    await requirePersist(persist, 'students', updatedStudent);
  }
  const positioned = waitlistEntriesForGroup(db, group.id).find((entry) => entry.id === id);
  return { ok: true, entry: positioned || record, duplicate: Boolean(existing), student: updatedStudent };
}

export async function leaveGroupWaitlist({ db, persist, student, group, now = new Date(), source = 'crm' } = {}) {
  if (!student?.id || !group?.id) return { ok: false, reason: 'missing_student_or_group' };
  const entry = rows(db, WAITLIST_COLLECTION).find((row) => (
    String(row.student_id) === String(student.id)
    && String(row.group_id) === String(group.id)
    && ['waiting', 'offered', 'paused_after_acceptance'].includes(String(row.status))
  ));
  if (!entry) return { ok: true, duplicate: true, student };
  const updatedEntry = db.update(WAITLIST_COLLECTION, entry.id, {
    status: 'removed',
    removed_at: nowIso(now),
    removal_reason: `${source}_removed_waitlist`,
    updated_at: nowIso(now),
  });
  if (updatedEntry) await requirePersist(persist, WAITLIST_COLLECTION, updatedEntry);
  const stillWaiting = rows(db, WAITLIST_COLLECTION).some((row) => (
    String(row.student_id) === String(student.id)
    && ['waiting', 'offered', 'paused_after_acceptance'].includes(String(row.status))
  ));
  let updatedStudent = student;
  if (!stillWaiting && !activeHoldForStudent(db, student.id, now) && String(student.status) === REGISTRATION_STATUS.WAITLIST) {
    updatedStudent = db.update('students', student.id, { status: REGISTRATION_STATUS.DETAILS_COMPLETED }) || student;
    await requirePersist(persist, 'students', updatedStudent);
  }
  return { ok: true, entry: updatedEntry || entry, student: updatedStudent };
}

async function removeActiveWaitlistsForStudent({
  db,
  persist,
  studentId,
  groupIds = null,
  now = new Date(),
  reason = 'crm_changed_placement',
} = {}) {
  const removed = [];
  const groupFilter = Array.isArray(groupIds) ? new Set(groupIds.map(String)) : null;
  for (const entry of rows(db, WAITLIST_COLLECTION)) {
    if (String(entry.student_id) !== String(studentId)) continue;
    if (groupFilter && !groupFilter.has(String(entry.group_id))) continue;
    if (!['waiting', 'offered', 'paused_after_acceptance'].includes(String(entry.status))) continue;
    const updated = db.update(WAITLIST_COLLECTION, entry.id, {
      status: 'removed',
      removed_at: nowIso(now),
      removal_reason: reason,
      updated_at: nowIso(now),
    });
    if (updated) {
      await requirePersist(persist, WAITLIST_COLLECTION, updated);
      removed.push(updated);
    }
  }
  return removed;
}

/**
 * One CRM operation owns all three meanings of "group": a permanent seat, a
 * time-limited hard hold, or a queue position. A trainee cannot accidentally
 * remain in two of those modes after an edit.
 */
export async function setStudentGroupPlacement({
  db,
  persist,
  student,
  parent = null,
  groups = [],
  mode,
  now = new Date(),
  source = 'crm',
} = {}) {
  if (!student?.id) return { ok: false, reason: 'student_not_found' };
  if (!Object.values(GROUP_PLACEMENT_MODE).includes(mode)) {
    return { ok: false, reason: 'invalid_placement_mode' };
  }
  const selectedGroups = [...new Map((groups || []).filter(Boolean).map((group) => [String(group.id), group])).values()];
  if (mode !== GROUP_PLACEMENT_MODE.NONE && !selectedGroups.length) {
    return { ok: false, reason: 'group_required' };
  }

  const existingHold = activeHoldForStudent(db, student.id, now);
  const desiredIds = selectedGroups.map((group) => String(group.id));
  const existingHoldIds = uniqueStrings(existingHold?.group_ids).sort();
  const sameHold = mode === GROUP_PLACEMENT_MODE.HOLD
    && existingHold
    && existingHoldIds.join(',') === [...desiredIds].sort().join(',');

  if ([GROUP_PLACEMENT_MODE.FIXED, GROUP_PLACEMENT_MODE.HOLD].includes(mode)) {
    // A group the student already occupies (through a membership or an active hold)
    // does not need to pass a fresh capacity check. This keeps editing idempotent and
    // avoids blocking an existing placement when an old group has no capacity value.
    const occupiedIds = new Set([
      ...studentGroupIds(student, db),
      ...existingHoldIds,
    ].map(String));
    const groupsRequiringCapacity = selectedGroups.filter((group) => !occupiedIds.has(String(group.id)));
    if (groupsRequiringCapacity.length) {
      const available = capacityCheck(db, groupsRequiringCapacity.map((group) => group.id), student.id, now);
      if (!available.ok) return available;
    }
  }

  if (existingHold && !sameHold) {
    const released = await releasePlacementHold({
      db,
      persist,
      hold: existingHold,
      now,
      reason: 'crm_changed_placement',
      nextStudentStatus: REGISTRATION_STATUS.DETAILS_COMPLETED,
    });
    if (!released.ok) return released;
  }
  await removeActiveWaitlistsForStudent({
    db,
    persist,
    studentId: student.id,
    groupIds: [GROUP_PLACEMENT_MODE.FIXED, GROUP_PLACEMENT_MODE.HOLD].includes(mode) ? desiredIds : null,
    now,
  });

  if (mode === GROUP_PLACEMENT_MODE.HOLD) {
    if (sameHold) {
      const assigned = await assignHoldToStudent({ db, persist, student: db.getOne('students', student.id), hold: existingHold });
      return { ok: true, mode, hold: existingHold, student: assigned, duplicate: true };
    }
    const currentStudent = db.getOne('students', student.id);
    const held = await createPlacementHold({
      db,
      persist,
      student: currentStudent,
      parent,
      groups: selectedGroups,
      phase: HOLD_PHASE.AWAITING_PARENT,
      source,
      now,
    });
    return held.ok ? { ...held, mode } : held;
  }

  let updated = db.getOne('students', student.id);
  if (mode === GROUP_PLACEMENT_MODE.WAITLIST) {
    updated = await persistMembership(db, persist, updated, [], { primaryGroupId: null });
    const entries = [];
    for (const group of selectedGroups) {
      const waiting = await joinGroupWaitlist({ db, persist, student: db.getOne('students', student.id), parent, group, now, source });
      if (!waiting.ok) return waiting;
      entries.push(waiting.entry);
    }
    updated = db.getOne('students', student.id);
    return { ok: true, mode, student: updated, waitlists: entries };
  }

  if (mode === GROUP_PLACEMENT_MODE.FIXED) {
    updated = await persistMembership(db, persist, db.getOne('students', student.id), desiredIds, {
      primaryGroupId: desiredIds[0],
    });
    updated = db.update('students', student.id, {
      status: REGISTRATION_STATUS.REGISTERED,
      placement_hold_until: null,
      placement_hold_firm: false,
      placement_reported_at: null,
    }) || updated;
    await requirePersist(persist, 'students', updated);
    return { ok: true, mode, student: updated };
  }

  updated = await persistMembership(db, persist, db.getOne('students', student.id), [], { primaryGroupId: null });
  updated = db.update('students', student.id, {
    status: REGISTRATION_STATUS.DETAILS_COMPLETED,
    placement_hold_until: null,
    placement_hold_firm: false,
    placement_reported_at: null,
  }) || updated;
  await requirePersist(persist, 'students', updated);
  return { ok: true, mode: GROUP_PLACEMENT_MODE.NONE, student: updated };
}

export async function offerNextWaitlistee({ db, persist, group, now = new Date(), isEligible = () => true } = {}) {
  if (!group?.id) return { ok: false, reason: 'group_not_found' };
  const candidate = waitlistEntriesForGroup(db, group.id)
    .find((entry) => entry.status === 'waiting'
      && !activeHoldForStudent(db, entry.student_id, now)
      && isEligible(db.getOne('students', entry.student_id), group, entry));
  if (!candidate) return { ok: false, reason: 'waitlist_empty' };
  const student = db.getOne('students', candidate.student_id);
  const parent = candidate.parent_id ? db.getOne('parents', candidate.parent_id) : null;
  if (!student) return { ok: false, reason: 'student_not_found', entry: candidate };
  const claimed = await createPlacementHold({
    db,
    persist,
    student,
    parent,
    groups: [group],
    phase: HOLD_PHASE.WAITLIST_OFFER,
    source: 'waitlist_offer',
    now,
    assignStudent: false,
    metadata: { waitlist_entry_id: candidate.id },
  });
  if (!claimed.ok) return claimed;
  const offered = db.update(WAITLIST_COLLECTION, candidate.id, {
    status: 'offered',
    offered_at: nowIso(now),
    offered_until: claimed.hold.expires_at,
    offer_hold_id: claimed.hold.id,
    offers: Number(candidate.offers || 0) + 1,
    updated_at: nowIso(now),
  });
  if (offered) await requirePersist(persist, WAITLIST_COLLECTION, offered);
  return { ok: true, entry: offered || candidate, hold: claimed.hold, student, parent };
}

export async function acceptWaitlistOffer({ db, persist, student, now = new Date() } = {}) {
  const hold = activeHoldForStudent(db, student?.id, now);
  if (!hold || hold.phase !== HOLD_PHASE.WAITLIST_OFFER) return { ok: false, reason: 'no_active_offer' };
  const advanced = await updateHoldPhase({ db, persist, hold, phase: HOLD_PHASE.AWAITING_PARENT, now });
  if (!advanced.ok) return advanced;
  const updatedStudent = await assignHoldToStudent({ db, persist, student, hold: advanced.hold });
  const entryId = hold.metadata?.waitlist_entry_id;
  const entry = entryId ? db.update(WAITLIST_COLLECTION, entryId, {
    status: 'accepted',
    accepted_at: nowIso(now),
    updated_at: nowIso(now),
  }) : null;
  if (entry) await requirePersist(persist, WAITLIST_COLLECTION, entry);
  return { ok: true, hold: advanced.hold, student: updatedStudent, entry };
}

export async function requeueUndeliveredWaitlistOffer({ db, persist, hold, now = new Date() } = {}) {
  if (!hold?.id || hold.phase !== HOLD_PHASE.WAITLIST_OFFER) return { ok: false, reason: 'not_waitlist_offer' };
  const entryId = hold.metadata?.waitlist_entry_id;
  const entry = entryId ? db.getOne(WAITLIST_COLLECTION, entryId) : null;
  await releasePlacementHold({
    db,
    persist,
    hold,
    now,
    reason: 'waitlist_offer_not_delivered',
    nextStudentStatus: REGISTRATION_STATUS.WAITLIST,
    removeMembership: false,
  });
  const updated = entry ? db.update(WAITLIST_COLLECTION, entry.id, {
    status: 'waiting',
    offered_at: null,
    offered_until: null,
    offer_hold_id: null,
    updated_at: nowIso(now),
  }) : null;
  if (updated) await requirePersist(persist, WAITLIST_COLLECTION, updated);
  return { ok: true, entry: updated || entry };
}

export function activeIntroProduct(pricelist = []) {
  const matches = (pricelist || []).filter((item) => (
    item
    && item.active !== false
    && item.is_active !== false
    && item.archived !== true
    && Number(item.price) > 0
    && isIntroTrainingItem(item)
  ));
  if (matches.length !== 1) {
    return { ok: false, reason: matches.length ? 'intro_product_ambiguous' : 'intro_product_missing', matches };
  }
  return { ok: true, product: matches[0], price: Number(matches[0].price) };
}

export function nextGroupSessionDate(group, { now = new Date(), notBefore = '2026-09-01' } = {}) {
  const today = israelDateStr(new Date(now));
  const start = today > notBefore ? today : notBefore;
  const days = getSortedGroupDays(group);
  if (!days.length) return null;
  for (let offset = 0; offset < 21; offset += 1) {
    const date = addIsoDays(start, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!days.includes(weekday)) continue;
    const startsAt = israelTimeToEpoch(date, String(group.time || '00:00').slice(0, 5));
    if (startsAt > new Date(now).getTime()) return date;
  }
  return null;
}

export async function createIntroBooking({
  db,
  persist,
  student,
  parent = null,
  group,
  now = new Date(),
  createPaymentLink,
} = {}) {
  if (!student?.id || !group?.id) return { ok: false, reason: 'missing_student_or_group' };
  const productResult = activeIntroProduct(rows(db, 'pricelist'));
  if (!productResult.ok) return productResult;
  const sessionDate = nextGroupSessionDate(group, { now });
  if (!sessionDate) return { ok: false, reason: 'no_upcoming_session' };
  const existing = rows(db, INTRO_COLLECTION).find((booking) => (
    String(booking.student_id) === String(student.id)
    && String(booking.group_id) === String(group.id)
    && String(booking.session_date) === String(sessionDate)
    && ['payment_pending', 'paid', 'scheduled', 'awaiting_decision'].includes(String(booking.status))
  ));
  if (existing) return { ok: true, booking: existing, duplicate: true, paymentUrl: existing.payment_url || '' };

  const holdResult = await createPlacementHold({
    db,
    persist,
    student,
    parent,
    groups: [group],
    phase: HOLD_PHASE.INTRO_PAYMENT,
    source: 'intro_booking',
    now,
    assignStudent: false,
    metadata: { session_date: sessionDate },
  });
  if (!holdResult.ok) return holdResult;
  const stamp = nowIso(now);
  let booking = db.insert(INTRO_COLLECTION, {
    id: `ib_${sha(`${student.id}|${group.id}|${sessionDate}`)}`,
    student_id: student.id,
    student_name: student.name || '',
    parent_id: parent?.id || student.parentId || null,
    group_id: group.id,
    group_name: group.name || '',
    session_date: sessionDate,
    product_id: productResult.product.id,
    product_name: productResult.product.name || 'אימון היכרות',
    price: productResult.price,
    status: 'payment_pending',
    hold_id: holdResult.hold.id,
    payment_expires_at: holdResult.hold.expires_at,
    payment_id: null,
    payment_url: null,
    paid_at: null,
    created_at: stamp,
    updated_at: stamp,
  });
  await requirePersist(persist, INTRO_COLLECTION, booking);
  if (typeof createPaymentLink !== 'function') {
    booking = db.update(INTRO_COLLECTION, booking.id, {
      status: 'payment_failed',
      payment_error: 'payment_link_unavailable',
      updated_at: nowIso(now),
    }) || booking;
    await requirePersist(persist, INTRO_COLLECTION, booking);
    await releasePlacementHold({
      db,
      persist,
      hold: holdResult.hold,
      now,
      reason: 'intro_payment_unavailable',
      removeMembership: false,
    });
    return { ok: false, reason: 'payment_link_unavailable', booking };
  }
  try {
    const payment = await createPaymentLink({ booking, product: productResult.product, student, parent, group });
    const paymentUrl = payment?.shareUrl || payment?.paymentUrl || '';
    if (!paymentUrl) throw new Error('payment_link_missing_url');
    booking = db.update(INTRO_COLLECTION, booking.id, {
      payment_id: payment.paymentId || payment.payment?.id || null,
      pos_sale_id: payment.saleId || payment.sale?.id || null,
      payment_url: paymentUrl,
      updated_at: nowIso(now),
    }) || booking;
    await requirePersist(persist, INTRO_COLLECTION, booking);
    return { ok: true, booking, hold: holdResult.hold, paymentUrl: booking.payment_url, duplicate: false };
  } catch (error) {
    booking = db.update(INTRO_COLLECTION, booking.id, {
      status: 'payment_failed',
      payment_error: error.message,
      updated_at: nowIso(now),
    }) || booking;
    await requirePersist(persist, INTRO_COLLECTION, booking);
    await releasePlacementHold({ db, persist, hold: holdResult.hold, now, reason: 'intro_payment_failed', removeMembership: false });
    return { ok: false, reason: 'payment_link_failed', error: error.message, booking };
  }
}

export async function confirmIntroPayment({ db, persist, bookingId = null, paymentId = null, now = new Date() } = {}) {
  const booking = rows(db, INTRO_COLLECTION).find((row) => (
    (bookingId && String(row.id) === String(bookingId))
    || (paymentId && String(row.payment_id) === String(paymentId))
  ));
  if (!booking) return { ok: false, reason: 'intro_booking_not_found' };
  if (['paid', 'scheduled', 'awaiting_decision', 'continued'].includes(String(booking.status))) {
    return { ok: true, booking, duplicate: true };
  }
  const hold = db.getOne(HOLD_COLLECTION, booking.hold_id);
  if (!hold || !isActiveHold(hold, now)) return { ok: false, reason: 'intro_hold_not_active' };
  const decisionAt = new Date(israelTimeToEpoch(addIsoDays(booking.session_date, 1), '09:00'));
  const advanced = await updateHoldPhase({
    db,
    persist,
    hold,
    phase: HOLD_PHASE.INTRO_SCHEDULED,
    now,
    // Do not start the 24-hour decision clock until attendance is known and
    // the follow-up was actually sent. A missing attendance mark opens a staff
    // task and must not silently release the seat.
    expiresAt: null,
  });
  if (!advanced.ok) return advanced;
  const student = db.getOne('students', booking.student_id);
  const updatedStudent = student
    ? await assignHoldToStudent({ db, persist, student, hold: advanced.hold })
    : null;
  const updatedBooking = db.update(INTRO_COLLECTION, booking.id, {
    status: 'scheduled',
    paid_at: nowIso(now),
    decision_prompt_at: decisionAt.toISOString(),
    decision_expires_at: null,
    updated_at: nowIso(now),
  });
  if (updatedBooking) await requirePersist(persist, INTRO_COLLECTION, updatedBooking);
  return { ok: true, booking: updatedBooking || booking, hold: advanced.hold, student: updatedStudent };
}

export async function continueAfterIntro({ db, persist, student, now = new Date() } = {}) {
  const hold = activeHoldForStudent(db, student?.id, now);
  // The follow-up worker changes the phase only after attendance is known and
  // the next-day question was actually sent. A reply before the training must
  // never be able to skip that evidence.
  if (!hold || hold.phase !== HOLD_PHASE.INTRO_DECISION) {
    return { ok: false, reason: 'no_intro_decision_hold' };
  }
  const advanced = await updateHoldPhase({ db, persist, hold, phase: HOLD_PHASE.AWAITING_PARENT, now });
  if (!advanced.ok) return advanced;
  const updatedStudent = await assignHoldToStudent({ db, persist, student, hold: advanced.hold });
  const booking = rows(db, INTRO_COLLECTION).find((row) => String(row.hold_id) === String(hold.id));
  const updatedBooking = booking ? db.update(INTRO_COLLECTION, booking.id, {
    status: 'continued',
    continued_at: nowIso(now),
    updated_at: nowIso(now),
  }) : null;
  if (updatedBooking) await requirePersist(persist, INTRO_COLLECTION, updatedBooking);
  return { ok: true, hold: advanced.hold, student: updatedStudent, booking: updatedBooking || booking };
}

/** A verified no-show may buy the next session while keeping the current seat. */
export async function rescheduleIntroAfterNoShow({
  db,
  persist,
  student,
  now = new Date(),
  createPaymentLink,
} = {}) {
  if (!student?.id) return { ok: false, reason: 'student_not_found' };
  const previous = rows(db, INTRO_COLLECTION)
    .filter((booking) => String(booking.student_id) === String(student.id))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .find((booking) => booking.status === 'awaiting_decision' && booking.attendance_result === 'no_show');
  if (!previous) return { ok: false, reason: 'no_verified_no_show' };
  const hold = activeHoldForStudent(db, student.id, now);
  if (!hold || hold.phase !== HOLD_PHASE.INTRO_DECISION) return { ok: false, reason: 'no_intro_decision_hold' };
  const group = db.getOne('groups', previous.group_id);
  if (!group) return { ok: false, reason: 'group_not_found' };
  const productResult = activeIntroProduct(rows(db, 'pricelist'));
  if (!productResult.ok) return productResult;
  const sessionDate = nextGroupSessionDate(group, { now });
  if (!sessionDate) return { ok: false, reason: 'no_upcoming_session' };
  const existing = rows(db, INTRO_COLLECTION).find((booking) => (
    String(booking.student_id) === String(student.id)
    && String(booking.group_id) === String(group.id)
    && String(booking.session_date) === String(sessionDate)
    && booking.status === 'payment_pending'
  ));
  if (existing) return { ok: true, booking: existing, hold, duplicate: true, paymentUrl: existing.payment_url || '' };

  const originalDecisionExpiry = hold.expires_at;
  const advanced = await updateHoldPhase({
    db,
    persist,
    hold,
    phase: HOLD_PHASE.INTRO_PAYMENT,
    now,
    expiresAt: endOfIsraelDay(now),
  });
  if (!advanced.ok) return advanced;
  const stamp = nowIso(now);
  let booking = db.insert(INTRO_COLLECTION, {
    id: `ib_${sha(`${student.id}|${group.id}|${sessionDate}`)}`,
    student_id: student.id,
    student_name: student.name || '',
    parent_id: previous.parent_id || student.parentId || null,
    group_id: group.id,
    group_name: group.name || '',
    session_date: sessionDate,
    product_id: productResult.product.id,
    product_name: productResult.product.name || 'אימון היכרות',
    price: productResult.price,
    status: 'payment_pending',
    hold_id: hold.id,
    retry_of: previous.id,
    payment_expires_at: advanced.hold.expires_at,
    payment_id: null,
    payment_url: null,
    paid_at: null,
    created_at: stamp,
    updated_at: stamp,
  });
  await requirePersist(persist, INTRO_COLLECTION, booking);
  const restoreDecisionHold = async (reason) => {
    const failed = db.update(INTRO_COLLECTION, booking.id, {
      status: 'payment_failed',
      payment_error: reason,
      updated_at: nowIso(now),
    }) || booking;
    await requirePersist(persist, INTRO_COLLECTION, failed);
    await updateHoldPhase({
      db,
      persist,
      hold: db.getOne(HOLD_COLLECTION, hold.id) || advanced.hold,
      phase: HOLD_PHASE.INTRO_DECISION,
      now,
      expiresAt: originalDecisionExpiry,
    });
    return failed;
  };
  if (typeof createPaymentLink !== 'function') {
    const failed = await restoreDecisionHold('payment_link_unavailable');
    return { ok: false, reason: 'payment_link_unavailable', booking: failed };
  }
  try {
    const parent = booking.parent_id ? db.getOne('parents', booking.parent_id) : null;
    const payment = await createPaymentLink({ booking, product: productResult.product, student, parent, group });
    const paymentUrl = payment?.shareUrl || payment?.paymentUrl || '';
    if (!paymentUrl) throw new Error('payment_link_missing_url');
    booking = db.update(INTRO_COLLECTION, booking.id, {
      payment_id: payment.paymentId || payment.payment?.id || null,
      pos_sale_id: payment.saleId || payment.sale?.id || null,
      payment_url: paymentUrl,
      updated_at: nowIso(now),
    }) || booking;
    await requirePersist(persist, INTRO_COLLECTION, booking);
    const old = db.update(INTRO_COLLECTION, previous.id, { status: 'rescheduled', rescheduled_to: booking.id, updated_at: nowIso(now) });
    if (old) await requirePersist(persist, INTRO_COLLECTION, old);
    return { ok: true, booking, hold: advanced.hold, paymentUrl: booking.payment_url, duplicate: false };
  } catch (error) {
    const failed = await restoreDecisionHold(error.message);
    return { ok: false, reason: 'payment_link_failed', error: error.message, booking: failed || booking };
  }
}

async function claimLifecycleEvent(db, persist, kind, entityId, occurrence, now) {
  const id = eventId(kind, entityId, occurrence);
  const record = {
    id,
    kind,
    entity_id: entityId,
    occurrence,
    status: 'processing',
    created_at: nowIso(now),
    updated_at: nowIso(now),
  };
  if (supa.isEnabled()) {
    const claimed = await supa.claimRegistrationLifecycleEvent(record);
    if (claimed.record) putLocalRecord(db, LIFECYCLE_EVENT_COLLECTION, claimed.record);
    return { claimed: claimed.claimed === true, event: claimed.record || record };
  }
  const existing = db.getOne(LIFECYCLE_EVENT_COLLECTION, id);
  if (existing?.status === 'sent' || existing?.status === 'done') return { claimed: false, event: existing };
  if (existing) {
    const age = new Date(now).getTime() - new Date(existing.updated_at || existing.created_at || 0).getTime();
    if (existing.status === 'processing' && age < 5 * 60 * 1000) return { claimed: false, event: existing };
    const retry = db.update(LIFECYCLE_EVENT_COLLECTION, id, { status: 'processing', updated_at: nowIso(now) });
    await requirePersist(persist, LIFECYCLE_EVENT_COLLECTION, retry);
    return { claimed: true, event: retry };
  }
  const result = await db.appendOnly(LIFECYCLE_EVENT_COLLECTION, record);
  return { claimed: Boolean(result?.ok), event: result?.record || null };
}

async function finishLifecycleEvent(db, persist, event, status, details, now) {
  if (!event?.id) return;
  const updated = db.update(LIFECYCLE_EVENT_COLLECTION, event.id, {
    status,
    details: details || {},
    updated_at: nowIso(now),
  });
  if (updated) await requirePersist(persist, LIFECYCLE_EVENT_COLLECTION, updated);
}

async function sendOnce({ db, persist, kind, entityId, occurrence, now, send, payload }) {
  if (typeof send !== 'function') return { skipped: 'no_sender' };
  const claim = await claimLifecycleEvent(db, persist, kind, entityId, occurrence, now);
  if (!claim.claimed) return { skipped: 'already_sent' };
  try {
    const result = await send(payload);
    if (result?.success === false) throw new Error(result.error || 'send_failed');
    await finishLifecycleEvent(db, persist, claim.event, 'sent', result || {}, now);
    return { sent: true, result };
  } catch (error) {
    await finishLifecycleEvent(db, persist, claim.event, 'failed', { error: error.message }, now);
    return { sent: false, error: error.message };
  }
}

function attendanceForBooking(db, booking) {
  return rows(db, 'attendance').find((row) => (
    String(row.student_id || row.studentId || '') === String(booking.student_id)
    && String(row.group_id || row.groupId || '') === String(booking.group_id)
    && String(row.date || '') === String(booking.session_date)
  )) || null;
}

function introAttendanceResult(row) {
  if (!row) return 'missing';
  const status = normalizeAttStatus(row.status);
  if (isIntroAttStatus(status) || ['attended', 'makeup', 'saturday_makeup'].includes(status)) return 'attended';
  if (['absent', 'no_show', 'cancelled'].includes(status)) return 'no_show';
  return 'missing';
}

async function createTaskOnce({ db, persist, createTask, kind, entityId, occurrence, now, input }) {
  if (typeof createTask !== 'function') return { skipped: 'no_task_creator' };
  const claim = await claimLifecycleEvent(db, persist, kind, entityId, occurrence, now);
  if (!claim.claimed) return { skipped: 'already_created' };
  try {
    const task = await createTask(input);
    await finishLifecycleEvent(db, persist, claim.event, 'done', { task_id: task?.id || null }, now);
    return { created: true, task };
  } catch (error) {
    await finishLifecycleEvent(db, persist, claim.event, 'failed', { error: error.message }, now);
    return { created: false, error: error.message };
  }
}

/** Durable sweep: reminders, expiries, intro decisions and the next waitlist offer. */
export async function runRegistrationLifecycle({
  db,
  persist,
  now = new Date(),
  sendCustomer,
  createTask,
  isEligible = () => true,
} = {}) {
  const result = {
    reminders: 0,
    released: 0,
    offers: 0,
    introPrompts: 0,
    waitlistQuestions: 0,
    tasks: 0,
  };
  const at = new Date(now).getTime();
  const groupsWithOfferAttempt = new Set();

  // Expired rows must still be swept. `activeHolds()` intentionally hides
  // them from capacity calculations, so the worker reads the durable active
  // state directly and performs the expiry transition exactly once.
  const openHolds = rows(db, HOLD_COLLECTION)
    .filter((hold) => String(hold.status) === HOLD_ACTIVE);
  for (const hold of openHolds) {
    const student = db.getOne('students', hold.student_id);
    const parent = hold.parent_id ? db.getOne('parents', hold.parent_id) : null;
    if (hold.phase === HOLD_PHASE.AWAITING_PARENT
      && hold.reminder_at
      && !hold.reminder_sent_at
      && new Date(hold.reminder_at).getTime() <= at
      && new Date(hold.expires_at).getTime() > at) {
      const sent = await sendOnce({
        db, persist, kind: 'parent_deadline_reminder', entityId: hold.id,
        occurrence: hold.expires_at, now, send: sendCustomer,
        payload: {
          kind: 'parent_deadline_reminder', parent, student, hold,
          text: `תזכורת: השיבוץ של ${student?.name || 'המתאמן/ת'} שמור עד היום. כדי שלא יתבטל, צריך להשלים את ההרשמה במתנ״ס ולעדכן אותנו שנרשמתם.`,
        },
      });
      if (sent.sent) {
        const updated = db.update(HOLD_COLLECTION, hold.id, { reminder_sent_at: nowIso(now), updated_at: nowIso(now) });
        if (updated) await requirePersist(persist, HOLD_COLLECTION, updated);
        result.reminders += 1;
      }
    }

    if (!hold.expires_at || new Date(hold.expires_at).getTime() > at) continue;

    if (hold.phase === HOLD_PHASE.WAITLIST_OFFER) {
      const entry = hold.metadata?.waitlist_entry_id ? db.getOne(WAITLIST_COLLECTION, hold.metadata.waitlist_entry_id) : null;
      await releasePlacementHold({ db, persist, hold, now, reason: 'waitlist_offer_expired', nextStudentStatus: REGISTRATION_STATUS.WAITLIST, removeMembership: false });
      if (entry) {
        const moved = db.update(WAITLIST_COLLECTION, entry.id, {
          status: 'waiting',
          queue_entered_at: nowIso(now),
          offered_at: null,
          offered_until: null,
          offer_hold_id: null,
          updated_at: nowIso(now),
        });
        if (moved) await requirePersist(persist, WAITLIST_COLLECTION, moved);
      }
      const group = db.getOne('groups', hold.primary_group_id);
      if (group?.id) groupsWithOfferAttempt.add(String(group.id));
      const offered = group ? await offerNextWaitlistee({ db, persist, group, now, isEligible }) : null;
      if (offered?.ok) {
        const delivered = await sendOnce({
          db, persist, kind: 'waitlist_offer', entityId: offered.entry.id,
          occurrence: offered.hold.expires_at, now, send: sendCustomer,
          payload: {
            kind: 'waitlist_offer', parent: offered.parent, student: offered.student, hold: offered.hold,
            text: `התפנה מקום עבור ${offered.student.name || 'המתאמן/ת'}. המקום שמור ל־24 שעות — תרצו להתקדם להרשמה?`,
          },
        });
        if (delivered.sent) result.offers += 1;
        else await requeueUndeliveredWaitlistOffer({ db, persist, hold: offered.hold, now });
      }
      result.released += 1;
      continue;
    }

    if (hold.phase === HOLD_PHASE.INTRO_PAYMENT) {
      const booking = rows(db, INTRO_COLLECTION).find((row) => String(row.hold_id) === String(hold.id));
      if (booking && booking.status === 'payment_pending') {
        const updated = db.update(INTRO_COLLECTION, booking.id, { status: 'payment_expired', updated_at: nowIso(now) });
        if (updated) await requirePersist(persist, INTRO_COLLECTION, updated);
      }
      await releasePlacementHold({ db, persist, hold, now, reason: 'intro_payment_expired', nextStudentStatus: REGISTRATION_STATUS.DETAILS_COMPLETED, removeMembership: false });
      result.released += 1;
      continue;
    }

    if ([HOLD_PHASE.INTRO_SCHEDULED, HOLD_PHASE.INTRO_DECISION].includes(hold.phase)) {
      const booking = rows(db, INTRO_COLLECTION).find((row) => String(row.hold_id) === String(hold.id));
      if (booking) {
        const updated = db.update(INTRO_COLLECTION, booking.id, { status: 'expired', updated_at: nowIso(now) });
        if (updated) await requirePersist(persist, INTRO_COLLECTION, updated);
      }
      const heldGroups = new Set(uniqueStrings(hold.group_ids));
      for (const entry of rows(db, WAITLIST_COLLECTION).filter((row) => (
        String(row.student_id) === String(hold.student_id)
        && heldGroups.has(String(row.group_id))
      ))) {
        const removed = db.update(WAITLIST_COLLECTION, entry.id, { status: 'removed', removed_at: nowIso(now), updated_at: nowIso(now) });
        if (removed) await requirePersist(persist, WAITLIST_COLLECTION, removed);
      }
      await releasePlacementHold({ db, persist, hold, now, reason: 'intro_decision_expired', nextStudentStatus: REGISTRATION_STATUS.DETAILS_COMPLETED });
      result.released += 1;
      continue;
    }

    const centreExpired = hold.phase === HOLD_PHASE.AWAITING_CENTRE;
    await releasePlacementHold({
      db, persist, hold, now,
      reason: centreExpired ? 'centre_confirmation_expired' : 'parent_confirmation_expired',
      nextStudentStatus: REGISTRATION_STATUS.DETAILS_COMPLETED,
    });
    result.released += 1;
    if (centreExpired) {
      await sendOnce({
        db, persist, kind: 'centre_deadline_expired', entityId: hold.id,
        occurrence: hold.expires_at, now, send: sendCustomer,
        payload: {
          kind: 'centre_deadline_expired', parent, student, hold,
          text: `לא התקבל אישור הרשמה מהמתנ״ס עבור ${student?.name || 'המתאמן/ת'} בזמן, ולכן המקום השתחרר. הצוות יבדוק אתכם את המשך הטיפול.`,
        },
      });
      const task = await createTaskOnce({
        db, persist, createTask, kind: 'centre_expiry_task', entityId: hold.id,
        occurrence: hold.expires_at, now,
        input: {
          title: `בדיקת הרשמה במתנ״ס — ${student?.name || 'מתאמן/ת'}`,
          parent_id: parent?.id || null,
          student_id: student?.id || null,
          priority: 'high',
          notes: 'חלפו 10 ימים מאישור ההורה בלי אישור כרמית; המקום שוחרר.',
        },
      });
      if (task.created) result.tasks += 1;
    }
    for (const groupId of uniqueStrings(hold.group_ids)) {
      const group = db.getOne('groups', groupId);
      if (group?.id) groupsWithOfferAttempt.add(String(group.id));
      const offered = group ? await offerNextWaitlistee({ db, persist, group, now, isEligible }) : null;
      if (!offered?.ok) continue;
      const delivered = await sendOnce({
        db, persist, kind: 'waitlist_offer', entityId: offered.entry.id,
        occurrence: offered.hold.expires_at, now, send: sendCustomer,
        payload: {
          kind: 'waitlist_offer', parent: offered.parent, student: offered.student, hold: offered.hold,
          text: `התפנה מקום עבור ${offered.student.name || 'המתאמן/ת'}. המקום שמור ל־24 שעות — תרצו להתקדם להרשמה?`,
        },
      });
      if (delivered.sent) result.offers += 1;
      else await requeueUndeliveredWaitlistOffer({ db, persist, hold: offered.hold, now });
    }
  }

  // A seat may also become available through a manual CRM change. Scanning
  // every queue makes that path equivalent to an expiry, while the atomic
  // claim and message event keep multiple server instances idempotent.
  for (const group of rows(db, 'groups')) {
    if (groupsWithOfferAttempt.has(String(group.id))) continue;
    if (!waitlistEntriesForGroup(db, group.id).some((entry) => entry.status === 'waiting')) continue;
    if (!capacityForGroup(db, group.id, now).ok) continue;
    const offered = await offerNextWaitlistee({ db, persist, group, now, isEligible });
    if (!offered?.ok) continue;
    const delivered = await sendOnce({
      db,
      persist,
      kind: 'waitlist_offer',
      entityId: offered.entry.id,
      occurrence: offered.hold.expires_at,
      now,
      send: sendCustomer,
      payload: {
        kind: 'waitlist_offer',
        parent: offered.parent,
        student: offered.student,
        hold: offered.hold,
        text: `התפנה מקום עבור ${offered.student.name || 'המתאמן/ת'}. המקום שמור ל־24 שעות — תרצו להתקדם להרשמה?`,
      },
    });
    if (delivered.sent) result.offers += 1;
    else await requeueUndeliveredWaitlistOffer({ db, persist, hold: offered.hold, now });
  }

  // A successful registration pauses every other queue until the family says
  // whether to stay in it. While paused, no additional seat can be offered.
  const pausedByStudent = new Map();
  for (const entry of rows(db, WAITLIST_COLLECTION)) {
    if (String(entry.status) !== 'paused_after_acceptance') continue;
    const list = pausedByStudent.get(String(entry.student_id)) || [];
    list.push(entry);
    pausedByStudent.set(String(entry.student_id), list);
  }
  for (const [studentId, entries] of pausedByStudent) {
    const student = db.getOne('students', studentId);
    const parentId = student?.parentId || entries[0]?.parent_id;
    const parent = parentId ? db.getOne('parents', parentId) : null;
    const occurrence = entries
      .map((entry) => String(entry.paused_at || entry.updated_at || ''))
      .sort()
      .at(-1) || '';
    const groupNames = entries
      .map((entry) => entry.group_name || db.getOne('groups', entry.group_id)?.name)
      .filter(Boolean);
    const sent = await sendOnce({
      db,
      persist,
      kind: 'other_waitlists_choice',
      entityId: studentId,
      occurrence,
      now,
      send: sendCustomer,
      payload: {
        kind: 'other_waitlists_choice',
        parent,
        student,
        text: `${student?.name || 'המתאמן/ת'} נרשם/ה לקבוצה. להשאיר ברשימות ההמתנה האחרות${groupNames.length ? ` (${groupNames.join(', ')})` : ''}?`,
      },
    });
    if (sent.sent) result.waitlistQuestions += 1;
  }

  const local = israelParts(now);
  if (local.hour >= 9) {
    for (const booking of rows(db, INTRO_COLLECTION)) {
      if (booking.status !== 'scheduled' || booking.decision_prompt_sent_at) continue;
      if (!booking.decision_prompt_at || new Date(booking.decision_prompt_at).getTime() > at) continue;
      const student = db.getOne('students', booking.student_id);
      const parent = booking.parent_id ? db.getOne('parents', booking.parent_id) : null;
      const attendance = attendanceForBooking(db, booking);
      const attendanceResult = introAttendanceResult(attendance);
      if (attendanceResult === 'missing') {
        const task = await createTaskOnce({
          db, persist, createTask, kind: 'intro_attendance_missing', entityId: booking.id,
          occurrence: booking.session_date, now,
          input: {
            title: `חסרה נוכחות לאימון היכרות — ${student?.name || booking.student_name}`,
            parent_id: parent?.id || null,
            student_id: student?.id || booking.student_id,
            priority: 'high',
            notes: `${booking.group_name || 'קבוצה'}, ${booking.session_date}. אין לשלוח שאלת המשך עד לסימון נוכחות.`,
          },
        });
        if (task.created) result.tasks += 1;
        continue;
      }
      const hold = db.getOne(HOLD_COLLECTION, booking.hold_id);
      if (!hold || String(hold.status) !== HOLD_ACTIVE) continue;
      const decisionExpiry = new Date(new Date(now).getTime() + DAY_MS).toISOString();
      const advanced = await updateHoldPhase({ db, persist, hold, phase: HOLD_PHASE.INTRO_DECISION, now, expiresAt: decisionExpiry });
      if (!advanced.ok) continue;
      const prompt = attendanceResult === 'attended'
        ? `איך היה האימון של ${student?.name || 'המתאמן/ת'}? תרצו להמשיך בקבוצה? המקום שמור ל־24 שעות.`
        : `ראינו ש${student?.name || 'המתאמן/ת'} לא הגיע/ה לאימון. אפשר לשלם שוב למפגש הבא בתוך 24 שעות; לאחר מכן המקום ישתחרר.`;
      const sent = await sendOnce({
        db, persist, kind: 'intro_decision_prompt', entityId: booking.id,
        occurrence: booking.session_date, now, send: sendCustomer,
        payload: {
          kind: attendanceResult === 'attended' ? 'intro_decision_prompt' : 'intro_no_show_prompt',
          parent,
          student,
          hold: advanced.hold,
          booking,
          attendanceResult,
          text: prompt,
        },
      });
      if (sent.sent) {
        const updated = db.update(INTRO_COLLECTION, booking.id, {
          status: 'awaiting_decision',
          attendance_result: attendanceResult,
          decision_prompt_sent_at: nowIso(now),
          decision_expires_at: decisionExpiry,
          updated_at: nowIso(now),
        });
        if (updated) await requirePersist(persist, INTRO_COLLECTION, updated);
        result.introPrompts += 1;
      }
    }
  }
  return result;
}

export function lifecycleSnapshotForStudent(db, studentId, now = new Date()) {
  const hold = activeHoldForStudent(db, studentId, now);
  const waitlists = rows(db, WAITLIST_COLLECTION)
    .filter((entry) => String(entry.student_id) === String(studentId))
    .map((entry) => {
      const position = waitlistEntriesForGroup(db, entry.group_id).find((row) => row.id === entry.id)?.position || null;
      return { ...entry, position };
    });
  const intro = rows(db, INTRO_COLLECTION)
    .filter((booking) => String(booking.student_id) === String(studentId))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
  return { hold, waitlists, intro };
}

export function migrationDryRun({
  students = [],
  groups = [],
  centreChecks = [],
  waitlists = [],
  introBookings = [],
  now = new Date(),
} = {}) {
  const groupById = new Map((groups || []).map((group) => [String(group.id), group]));
  const checkByStudent = new Map((centreChecks || []).map((row) => [String(row.student_id), row]));
  const uncertain = [];
  const overloaded = [];
  const plannedHolds = [];
  const plannedWaitlists = [];
  for (const student of students || []) {
    if (student.status === 'health_signed') {
      plannedHolds.push({ student_id: student.id, from: 'health_signed', to: REGISTRATION_STATUS.DETAILS_COMPLETED, status_only: true });
    }
    if (student.status === 'pending_signup') {
      const selectedIds = uniqueStrings(studentGroupIds(student));
      const selectedGroups = selectedIds.map((id) => groupById.get(String(id))).filter(Boolean);
      if (!selectedIds.length || selectedGroups.length !== selectedIds.length) {
        uncertain.push({ student_id: student.id, name: student.name, reason: 'pending_signup_without_group' });
        continue;
      }
      const unknownCapacity = selectedGroups.find((group) => maxSlotsOf(group) === null);
      if (unknownCapacity) {
        uncertain.push({
          student_id: student.id,
          name: student.name,
          group_id: unknownCapacity.id,
          reason: 'capacity_unknown',
        });
        continue;
      }
      const reported = Boolean(student.placement_reported_at || checkByStudent.get(String(student.id)));
      plannedHolds.push({
        student_id: student.id,
        group_id: selectedGroups[0].id,
        group_ids: selectedGroups.map((group) => group.id),
        phase: reported ? HOLD_PHASE.AWAITING_CENTRE : HOLD_PHASE.AWAITING_PARENT,
        status: reported ? REGISTRATION_STATUS.AWAITING_CENTRE : REGISTRATION_STATUS.AWAITING_PARENT,
        expires_at: fullDayDeadline(now, reported ? 10 : 3),
      });
    }
    if (student.status === 'waitlist' && student.groupId) {
      plannedWaitlists.push({
        student_id: student.id,
        group_id: student.groupId,
        queue_entered_at: student.status_changed_at || student.created_at || student.created || nowIso(now),
      });
    }
  }
  for (const group of groups || []) {
    const capacity = maxSlotsOf(group);
    if (capacity === null) continue;
    const members = (students || []).filter((student) => countsTowardCapacity(student, group.id, { now })).length;
    const pending = plannedHolds.filter((hold) => (
      !hold.status_only
      && uniqueStrings(hold.group_ids || [hold.group_id]).includes(String(group.id))
    )).length;
    if (members + pending > capacity) {
      overloaded.push({ group_id: group.id, group_name: group.name, capacity, occupied_after: members + pending });
    }
  }
  for (const entry of waitlists || []) plannedWaitlists.push(entry);
  const uniquePlannedWaitlists = [...new Map(plannedWaitlists.map((entry) => [
    `${entry.student_id}|${entry.group_id}`,
    entry,
  ])).values()];
  const unverifiedIntroBookings = (introBookings || [])
    .filter((booking) => ['paid', 'scheduled', 'awaiting_decision', 'continued'].includes(String(booking.status || '')))
    .filter((booking) => !booking.paid_at || !booking.payment_id)
    .map((booking) => ({
      booking_id: booking.id,
      student_id: booking.student_id,
      student_name: booking.student_name,
      group_id: booking.group_id,
      session_date: booking.session_date,
      reason: !booking.paid_at ? 'paid_at_missing' : 'payment_id_missing',
    }));
  return {
    generated_at: nowIso(now),
    plannedHolds,
    plannedWaitlists: uniquePlannedWaitlists,
    uncertain,
    overloaded,
    unverifiedIntroBookings,
    safe_to_apply: uncertain.length === 0 && overloaded.length === 0 && unverifiedIntroBookings.length === 0,
  };
}

/** Apply only after an explicit production-data approval and a clean dry-run. */
export async function applyRegistrationLifecycleMigration({
  db,
  persist,
  now = new Date(),
  allowMutation = false,
  sendLegacyWarning,
} = {}) {
  if (!allowMutation) return { ok: false, reason: 'explicit_migration_approval_required' };
  const students = db.withStudentRelations?.(rows(db, 'students')) || rows(db, 'students');
  const groups = rows(db, 'groups');
  const centreChecks = rows(db, 'centre_registration_checks');
  const report = migrationDryRun({
    students,
    groups,
    centreChecks,
    waitlists: rows(db, WAITLIST_COLLECTION),
    introBookings: rows(db, INTRO_COLLECTION),
    now,
  });
  if (!report.safe_to_apply) return { ok: false, reason: 'dry_run_not_clean', report };

  const results = { statuses: 0, holds: 0, waitlists: 0, warnings: 0, failures: [] };
  const groupById = new Map(groups.map((group) => [String(group.id), group]));
  const reports = new Set(centreChecks
    .filter((row) => ['reported', 'asked', 'unconfirmed'].includes(String(row.status || '')))
    .map((row) => String(row.student_id)));

  for (const student of students) {
    try {
      if (student.status === 'health_signed') {
        const updated = db.update('students', student.id, { status: REGISTRATION_STATUS.DETAILS_COMPLETED });
        if (updated) await requirePersist(persist, 'students', updated);
        results.statuses += 1;
        continue;
      }
      if (student.status === 'waitlist' && student.groupId) {
        const group = groupById.get(String(student.groupId));
        if (group) {
          const parent = student.parentId ? db.getOne('parents', student.parentId) : null;
          const joined = await joinGroupWaitlist({ db, persist, student, parent, group, now, source: 'legacy_migration' });
          if (joined.ok && !joined.duplicate) results.waitlists += 1;
        }
        continue;
      }
      if (student.status !== 'pending_signup') continue;
      const groupIds = studentGroupIds(student);
      const selected = groupIds.map((id) => groupById.get(String(id))).filter(Boolean);
      if (!selected.length) throw new Error('pending_signup_without_group');
      const parent = student.parentId ? db.getOne('parents', student.parentId) : null;
      const reported = Boolean(student.placement_reported_at || reports.has(String(student.id)));
      const held = await createPlacementHold({
        db,
        persist,
        student,
        parent,
        groups: selected,
        phase: reported ? HOLD_PHASE.AWAITING_CENTRE : HOLD_PHASE.AWAITING_PARENT,
        source: 'legacy_migration',
        now,
        expiresAt: fullDayDeadline(now, reported ? 10 : 3),
      });
      if (!held.ok) throw new Error(held.reason || 'hold_failed');
      if (!held.duplicate) results.holds += 1;
      if (!reported && typeof sendLegacyWarning === 'function') {
        await sendLegacyWarning({ parent, student, hold: held.hold });
        results.warnings += 1;
      }
    } catch (error) {
      results.failures.push({ student_id: student.id, name: student.name, error: error.message });
    }
  }
  return { ok: results.failures.length === 0, report, ...results };
}
