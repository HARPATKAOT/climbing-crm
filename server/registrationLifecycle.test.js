import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD_COLLECTION,
  HOLD_PHASE,
  INTRO_COLLECTION,
  REGISTRATION_STATUS,
  WAITLIST_COLLECTION,
  acceptWaitlistOffer,
  activeHoldForStudent,
  activeIntroProduct,
  capacityForGroup,
  confirmIntroPayment,
  confirmParentRegistration,
  continueAfterIntro,
  createIntroBooking,
  createPlacementHold,
  fullDayDeadline,
  joinGroupWaitlist,
  migrationDryRun,
  markPlacementRegistered,
  offerNextWaitlistee,
  resolveOtherWaitlists,
  runRegistrationLifecycle,
  waitlistEntriesForGroup,
} from './registrationLifecycle.js';

function memoryDb(seed = {}) {
  const data = structuredClone(seed);
  const ensure = (table) => (data[table] ||= []);
  return {
    data,
    get: (table) => ensure(table),
    set: (table, value) => { data[table] = structuredClone(value || []); },
    getOne: (table, id) => ensure(table).find((row) => String(row.id) === String(id)) || null,
    insert: (table, record) => {
      const saved = { ...record, id: record.id || `${table}_${ensure(table).length + 1}` };
      ensure(table).push(saved);
      return saved;
    },
    update: (table, id, patch) => {
      const index = ensure(table).findIndex((row) => String(row.id) === String(id));
      if (index < 0) return null;
      data[table][index] = { ...data[table][index], ...patch };
      return data[table][index];
    },
    appendOnly: async (table, record) => {
      const existing = ensure(table).find((row) => String(row.id) === String(record.id));
      if (existing) return { ok: true, duplicate: true, record: existing };
      ensure(table).push({ ...record });
      return { ok: true, duplicate: false, record };
    },
    withStudentRelations: (students) => (students || []).map((student) => {
      const groupIds = ensure('enrollments')
        .filter((row) => String(row.student_id) === String(student.id) && row.status !== 'cancelled')
        .map((row) => String(row.group_id));
      return { ...student, groupIds: [...new Set([...(student.groupIds || []), ...groupIds])] };
    }),
    withStudentRelation(student) {
      return this.withStudentRelations(student ? [student] : [])[0] || null;
    },
    setStudentGroups(studentId, groupIds = [], { primaryGroupId = null } = {}) {
      data.enrollments = ensure('enrollments')
        .filter((row) => String(row.student_id) !== String(studentId));
      for (const groupId of groupIds) {
        data.enrollments.push({
          id: `${studentId}:${groupId}`,
          student_id: studentId,
          group_id: groupId,
          status: 'active',
        });
      }
      return this.update('students', studentId, {
        groupId: primaryGroupId || groupIds[0] || null,
        groupIds: [...groupIds],
      });
    },
  };
}

const persist = async () => ({ ok: true });
const group = { id: 'g1', name: 'ג׳-ד׳ ראשון', maxSlots: 1, day: 0, time: '16:00' };
const parent = { id: 'p1', name: 'הורה', phone: '0501111111' };

test('three complete days end at 23:59 Israel time', () => {
  const deadline = fullDayDeadline(new Date('2026-08-13T10:00:00.000Z'), 3);
  assert.equal(deadline, '2026-08-16T20:59:59.999Z');
});

test('a hard hold consumes the last seat and is idempotent', async () => {
  const db = memoryDb({
    groups: [group],
    students: [
      { id: 's1', name: 'ראשון', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED },
      { id: 's2', name: 'שני', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED },
    ],
    parents: [parent],
  });
  const now = new Date('2026-08-13T10:00:00.000Z');
  const first = await createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now });
  assert.equal(first.ok, true);
  assert.equal(first.student.status, REGISTRATION_STATUS.AWAITING_PARENT);
  assert.equal(capacityForGroup(db, group.id, now).free, 0);

  const duplicate = await createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.get(HOLD_COLLECTION).length, 1);

  const second = await createPlacementHold({ db, persist, student: db.getOne('students', 's2'), parent, groups: [group], now });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'full');
});

test('one trainee cannot hold seats in two different groups', async () => {
  const secondGroup = { ...group, id: 'g2', name: 'קבוצה שנייה' };
  const db = memoryDb({
    groups: [{ ...group, maxSlots: 2 }, { ...secondGroup, maxSlots: 2 }],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
    parents: [parent],
  });
  const now = new Date('2026-08-13T10:00:00.000Z');
  const first = await createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now });
  assert.equal(first.ok, true);
  const second = await createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [secondGroup], now });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'student_already_holding');
  assert.equal(db.get(HOLD_COLLECTION).length, 1);
});

test('parallel claims for the same trainee produce exactly one active hold', async () => {
  const secondGroup = { ...group, id: 'g2', name: 'קבוצה שנייה', maxSlots: 2 };
  const db = memoryDb({
    groups: [{ ...group, maxSlots: 2 }, secondGroup],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
    parents: [parent],
  });
  const now = new Date('2026-08-13T10:00:00.000Z');
  const [first, second] = await Promise.all([
    createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now }),
    createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [secondGroup], now }),
  ]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].filter((result) => result.reason === 'student_already_holding').length, 1);
  assert.equal(db.get(HOLD_COLLECTION).filter((hold) => hold.status === 'active').length, 1);
});

test('parallel claims for the last group seat cannot overbook it', async () => {
  const db = memoryDb({
    groups: [group],
    students: [
      { id: 's1', name: 'ראשון', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED },
      { id: 's2', name: 'שני', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED },
    ],
    parents: [parent],
  });
  const now = new Date('2026-08-13T10:00:00.000Z');
  const results = await Promise.all([
    createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now }),
    createPlacementHold({ db, persist, student: db.getOne('students', 's2'), parent, groups: [group], now }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.reason === 'full').length, 1);
  assert.equal(capacityForGroup(db, group.id, now).occupied, 1);
});

test('parent confirmation starts ten complete days and Carmit expiry releases the seat', async () => {
  const db = memoryDb({
    groups: [group],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
    parents: [parent],
  });
  const selectedAt = new Date('2026-08-13T10:00:00.000Z');
  await createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now: selectedAt });
  const confirmedAt = new Date('2026-08-14T08:00:00.000Z');
  const confirmed = await confirmParentRegistration({ db, persist, student: db.getOne('students', 's1'), now: confirmedAt });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.student.status, REGISTRATION_STATUS.AWAITING_CENTRE);
  assert.equal(confirmed.hold.expires_at, '2026-08-24T20:59:59.999Z');

  const messages = [];
  const tasks = [];
  const result = await runRegistrationLifecycle({
    db,
    persist,
    now: new Date('2026-08-24T21:00:00.000Z'),
    sendCustomer: async (payload) => { messages.push(payload); return { success: true }; },
    createTask: async (input) => { tasks.push(input); return { id: `task-${tasks.length}` }; },
  });
  assert.equal(result.released, 1);
  assert.equal(db.getOne('students', 's1').status, REGISTRATION_STATUS.DETAILS_COMPLETED);
  assert.equal(activeHoldForStudent(db, 's1', new Date('2026-08-24T21:00:00.000Z')), null);
  assert.equal(messages.some((message) => message.kind === 'centre_deadline_expired'), true);
  assert.equal(tasks.length, 1);
});

test('an expired parent hold releases without silently joining a waitlist', async () => {
  const db = memoryDb({
    groups: [group],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
    parents: [parent],
  });
  const now = new Date('2026-08-13T10:00:00.000Z');
  const created = await createPlacementHold({ db, persist, student: db.getOne('students', 's1'), parent, groups: [group], now });
  await runRegistrationLifecycle({
    db,
    persist,
    now: new Date(new Date(created.hold.expires_at).getTime() + 1),
    sendCustomer: async () => ({ success: true }),
  });
  assert.equal(db.getOne('students', 's1').status, REGISTRATION_STATUS.DETAILS_COMPLETED);
  assert.equal(db.get(WAITLIST_COLLECTION).length, 0);
});

test('waitlist offer reserves the seat for 24 hours and timeout moves the candidate to the end', async () => {
  const db = memoryDb({
    groups: [{ ...group, maxSlots: 2 }],
    parents: [parent],
    students: [
      { id: 's1', name: 'ראשון', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED },
      { id: 's2', name: 'שני', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED },
    ],
  });
  const firstAt = new Date('2026-08-13T08:00:00.000Z');
  await joinGroupWaitlist({ db, persist, student: db.getOne('students', 's1'), parent, group: db.getOne('groups', 'g1'), now: firstAt });
  await joinGroupWaitlist({ db, persist, student: db.getOne('students', 's2'), parent, group: db.getOne('groups', 'g1'), now: new Date(firstAt.getTime() + 1_000) });
  const offered = await offerNextWaitlistee({ db, persist, group: db.getOne('groups', 'g1'), now: firstAt });
  assert.equal(offered.ok, true);
  assert.equal(offered.student.id, 's1');
  assert.equal(new Date(offered.hold.expires_at).getTime() - firstAt.getTime(), 24 * 60 * 60 * 1000);

  const messages = [];
  await runRegistrationLifecycle({
    db,
    persist,
    now: new Date(new Date(offered.hold.expires_at).getTime() + 1),
    sendCustomer: async (payload) => { messages.push(payload); return { success: true }; },
  });
  const ordered = waitlistEntriesForGroup(db, 'g1');
  assert.equal(ordered[0].student_id, 's2');
  assert.equal(ordered.find((entry) => entry.student_id === 's2').status, 'offered');
  assert.equal(messages.filter((message) => message.kind === 'waitlist_offer').length, 1);
});

test('accepting a waitlist offer starts the three-day parent window', async () => {
  const db = memoryDb({
    groups: [{ ...group, maxSlots: 2 }],
    parents: [parent],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
  });
  const now = new Date('2026-08-13T08:00:00.000Z');
  await joinGroupWaitlist({ db, persist, student: db.getOne('students', 's1'), parent, group: db.getOne('groups', 'g1'), now });
  await offerNextWaitlistee({ db, persist, group: db.getOne('groups', 'g1'), now });
  const accepted = await acceptWaitlistOffer({ db, persist, student: db.getOne('students', 's1'), now });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.hold.phase, HOLD_PHASE.AWAITING_PARENT);
  assert.equal(accepted.student.status, REGISTRATION_STATUS.AWAITING_PARENT);
});

test('registration pauses other waitlists, asks once, and preserves position when kept', async () => {
  const secondGroup = { ...group, id: 'g2', name: 'קבוצה שנייה', maxSlots: 2 };
  const db = memoryDb({
    groups: [{ ...group, maxSlots: 2 }, secondGroup],
    parents: [parent],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
  });
  const now = new Date('2026-08-13T08:00:00.000Z');
  const waiting = await joinGroupWaitlist({
    db,
    persist,
    student: db.getOne('students', 's1'),
    parent,
    group: secondGroup,
    now,
  });
  const originalQueueTime = waiting.entry.queue_entered_at;
  const hold = await createPlacementHold({
    db,
    persist,
    student: db.getOne('students', 's1'),
    parent,
    groups: [group],
    now,
  });
  assert.equal(hold.ok, true);
  const registered = await markPlacementRegistered({
    db,
    persist,
    student: db.getOne('students', 's1'),
    now: new Date('2026-08-14T08:00:00.000Z'),
  });
  assert.equal(registered.otherWaitlists.length, 1);
  assert.equal(registered.otherWaitlists[0].status, 'paused_after_acceptance');

  const messages = [];
  const firstSweep = await runRegistrationLifecycle({
    db,
    persist,
    now: new Date('2026-08-14T08:01:00.000Z'),
    sendCustomer: async (payload) => { messages.push(payload); return { success: true }; },
  });
  const secondSweep = await runRegistrationLifecycle({
    db,
    persist,
    now: new Date('2026-08-14T08:02:00.000Z'),
    sendCustomer: async (payload) => { messages.push(payload); return { success: true }; },
  });
  assert.equal(firstSweep.waitlistQuestions, 1);
  assert.equal(secondSweep.waitlistQuestions, 0);
  assert.equal(messages.filter((message) => message.kind === 'other_waitlists_choice').length, 1);

  const resolved = await resolveOtherWaitlists({
    db,
    persist,
    student: db.getOne('students', 's1'),
    keep: true,
    now: new Date('2026-08-14T08:03:00.000Z'),
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.entries[0].status, 'waiting');
  assert.equal(resolved.entries[0].queue_entered_at, originalQueueTime);
});

test('intro requires exactly one active product and keeps the seat after verified payment', async () => {
  const db = memoryDb({
    groups: [group],
    parents: [parent],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
    pricelist: [{ id: 'intro', name: 'אימון היכרות', price: 80, active: true }],
  });
  assert.equal(activeIntroProduct(db.get('pricelist')).ok, true);
  assert.equal(activeIntroProduct([...db.get('pricelist'), { id: 'intro2', name: 'אימון היכרות', price: 90 }]).reason, 'intro_product_ambiguous');
  const now = new Date('2026-08-31T10:00:00.000Z');
  const created = await createIntroBooking({
    db,
    persist,
    student: db.getOne('students', 's1'),
    parent,
    group,
    now,
    createPaymentLink: async ({ booking }) => ({ paymentId: `pay-${booking.id}`, shareUrl: 'https://pay.example/intro' }),
  });
  assert.equal(created.ok, true);
  assert.equal(created.booking.session_date >= '2026-09-01', true);
  const paid = await confirmIntroPayment({ db, persist, bookingId: created.booking.id, now: new Date('2026-08-31T11:00:00.000Z') });
  assert.equal(paid.ok, true);
  assert.equal(paid.student.status, REGISTRATION_STATUS.INTRO_SCHEDULED);
  assert.equal(paid.hold.expires_at, null);
  assert.equal(capacityForGroup(db, group.id, new Date('2026-09-01T08:00:00.000Z')).free, 0);
});

test('missing intro attendance opens one task and never guesses or releases the seat', async () => {
  const db = memoryDb({
    groups: [group],
    parents: [parent],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.INTRO_SCHEDULED }],
    [HOLD_COLLECTION]: [{
      id: 'hold-intro', student_id: 's1', parent_id: parent.id, primary_group_id: group.id,
      group_ids: [group.id], phase: HOLD_PHASE.INTRO_SCHEDULED, status: 'active', expires_at: null,
    }],
    [INTRO_COLLECTION]: [{
      id: 'intro1', student_id: 's1', parent_id: parent.id, group_id: group.id,
      group_name: group.name, session_date: '2026-09-06', status: 'scheduled', hold_id: 'hold-intro',
      decision_prompt_at: '2026-09-07T06:00:00.000Z', paid_at: '2026-09-01T10:00:00.000Z',
    }],
  });
  const tasks = [];
  const messages = [];
  await runRegistrationLifecycle({
    db,
    persist,
    now: new Date('2026-09-07T07:00:00.000Z'),
    sendCustomer: async (payload) => { messages.push(payload); return { success: true }; },
    createTask: async (input) => { tasks.push(input); return { id: 'task1' }; },
  });
  assert.equal(tasks.length, 1);
  assert.equal(messages.length, 0);
  assert.equal(activeHoldForStudent(db, 's1', new Date('2026-09-07T07:00:00.000Z'))?.id, 'hold-intro');
  const premature = await continueAfterIntro({
    db,
    persist,
    student: db.getOne('students', 's1'),
    now: new Date('2026-09-07T07:01:00.000Z'),
  });
  assert.equal(premature.ok, false);
  assert.equal(premature.reason, 'no_intro_decision_hold');
});

test('the background sweep offers a manually freed seat to the oldest eligible waitlist entry', async () => {
  const db = memoryDb({
    groups: [{ ...group, maxSlots: 1 }],
    parents: [parent],
    students: [{ id: 's1', name: 'ילד', parentId: parent.id, status: REGISTRATION_STATUS.DETAILS_COMPLETED }],
  });
  const now = new Date('2026-08-13T08:00:00.000Z');
  await joinGroupWaitlist({
    db,
    persist,
    student: db.getOne('students', 's1'),
    parent,
    group: db.getOne('groups', group.id),
    now,
  });
  const messages = [];
  const sweep = await runRegistrationLifecycle({
    db,
    persist,
    now: new Date('2026-08-13T08:15:00.000Z'),
    sendCustomer: async (payload) => { messages.push(payload); return { success: true }; },
  });
  assert.equal(sweep.offers, 1);
  assert.equal(messages[0].kind, 'waitlist_offer');
  assert.equal(activeHoldForStudent(db, 's1', new Date('2026-08-13T08:15:00.000Z'))?.phase, HOLD_PHASE.WAITLIST_OFFER);
});

test('migration dry-run blocks uncertain, overloaded and unverified records', () => {
  const report = migrationDryRun({
    now: new Date('2026-08-13T10:00:00.000Z'),
    groups: [{ ...group, maxSlots: 1 }],
    students: [
      { id: 'registered', status: 'registered', groupId: group.id },
      { id: 'pending', status: 'pending_signup', groupId: group.id },
      { id: 'missing', status: 'pending_signup', groupId: 'missing-group' },
      { id: 'signed', status: 'health_signed' },
    ],
    introBookings: [{ id: 'intro-bad', status: 'paid', student_id: 'pending', group_id: group.id }],
  });
  assert.equal(report.safe_to_apply, false);
  assert.equal(report.overloaded.length, 1);
  assert.equal(report.uncertain[0].reason, 'pending_signup_without_group');
  assert.equal(report.unverifiedIntroBookings.length, 1);
  assert.equal(report.plannedHolds.some((row) => row.status_only && row.to === REGISTRATION_STATUS.DETAILS_COMPLETED), true);
});
