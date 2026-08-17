process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import {
  openStepCandidates,
  runOpenStepSweep,
  sweptRecently,
  SWEEP_SOURCE,
} from './openStepSweep.js';
import { FOLLOWUP_COLLECTION, FOLLOWUP_OPEN } from './botFollowUps.js';

const NOW = new Date('2026-08-16T09:00:00Z');
const COLLECTIONS = [
  'parents', 'students', 'groups', 'enrollments', 'health_declarations',
  'participation_waivers', 'student_equipment', FOLLOWUP_COLLECTION,
];

async function withSeed(data, run) {
  const backup = {};
  for (const key of COLLECTIONS) backup[key] = db.get(key) || [];
  for (const key of COLLECTIONS) db.set(key, structuredClone(data[key] || []));
  try {
    await run();
  } finally {
    for (const key of COLLECTIONS) db.set(key, backup[key]);
  }
}

const PARENT = { id: 'p1', name: 'דנה כהן', phone: '0500000001' };
const GROUP = { id: 'g1', name: 'ג׳-ד׳ יום א׳', ageCategory: 'ג׳-ד׳', day: 0, time: '16:00', maxSlots: 12 };

function student(patch = {}) {
  return { id: 's1', name: 'יותם כהן', parentId: PARENT.id, status: 'health_signed', groupId: null, ...patch };
}

const SIGNED = new Date('2026-08-01T08:00:00.000Z').toISOString();

/** The shapes participationEligibility actually reads — see botScenarios. */
function papers(studentId = 's1') {
  return {
    declarations: [{
      id: `hd-${studentId}`,
      studentId,
      signedDate: SIGNED,
      signature_url: 'https://example.com/sig.png',
    }],
    waivers: [{
      id: `pw-${studentId}`,
      studentId,
      scope: 'wall',
      signedDate: SIGNED,
      signature_url: 'https://example.com/sig.png',
    }],
  };
}

test('a signed form with no group is found, and the row says so', async () => {
  const { declarations, waivers } = papers();
  await withSeed({
    parents: [PARENT],
    students: [student()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  }, async () => {
    const found = openStepCandidates(db, { now: NOW });
    assert.equal(found.length, 1);
    assert.equal(found[0].reason, 'no_group_yet');

    const result = await runOpenStepSweep(db, null, { now: NOW });
    assert.equal(result.created, 1);
    const [row] = db.get(FOLLOWUP_COLLECTION);
    assert.equal(row.reason, 'no_group_yet');
    assert.equal(row.status, FOLLOWUP_OPEN);
    assert.equal(row.source, SWEEP_SOURCE);
    assert.equal(row.subject, 'יותם');
    // Outside a conversation there is no free-text window to rely on.
    assert.equal(row.needs_template, true);
  });
});

test('nobody is swept twice in a week, and nobody already in the queue is added', async () => {
  const { declarations, waivers } = papers();
  await withSeed({
    parents: [PARENT],
    students: [student()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
    [FOLLOWUP_COLLECTION]: [{
      id: 'bf-old', parent_id: PARENT.id, reason: 'no_group_yet', status: 'sent',
      source: SWEEP_SOURCE, created_at: '2026-08-14T09:00:00.000Z',
    }],
  }, async () => {
    assert.equal(sweptRecently(db, PARENT.id, NOW), true);
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    parents: [PARENT],
    students: [student()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
    [FOLLOWUP_COLLECTION]: [{
      id: 'bf-open', parent_id: PARENT.id, reason: 'customer_asked', status: FOLLOWUP_OPEN,
      created_at: '2026-08-15T09:00:00.000Z',
    }],
  }, async () => {
    // Already promised a call back — a second nudge on top is the noise this
    // whole sweep is supposed to avoid.
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    parents: [PARENT],
    students: [student()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
    [FOLLOWUP_COLLECTION]: [{
      id: 'bf-stale', parent_id: PARENT.id, reason: 'no_group_yet', status: 'sent',
      source: SWEEP_SOURCE, created_at: '2026-08-01T09:00:00.000Z',
    }],
  }, async () => {
    assert.equal(sweptRecently(db, PARENT.id, NOW), false);
    assert.equal(openStepCandidates(db, { now: NOW }).length, 1);
  });
});

test('whoever is waiting on us is not who the sweep is for', async () => {
  const { declarations, waivers } = papers();
  const cases = [
    ['archived', 0],
    ['past_registered', 0],
    ['lead_new', 0],
    ['waitlist', 0],
    ['intro_paid', 0],
    // The parent reported the מתנ״ס registration; the ball is ours.
    ['awaiting_centre_confirmation', 0],
    ['health_signed', 1],
    ['details_completed', 1],
  ];
  for (const [status, expected] of cases) {
    await withSeed({
      parents: [PARENT],
      students: [student({ status })],
      groups: [GROUP],
      health_declarations: declarations,
      participation_waivers: waivers,
    }, async () => {
      assert.equal(
        openStepCandidates(db, { now: NOW }).length,
        expected,
        `status ${status}`
      );
    });
  }
});

test('a customer who asked us to stop is never swept', async () => {
  const { declarations, waivers } = papers();
  await withSeed({
    parents: [{ ...PARENT, bot_opted_out: true }],
    students: [student()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  }, async () => {
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    parents: [{ ...PARENT, phone: '' }],
    students: [student()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  }, async () => {
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });
});

test('two children in one family are one message, not two', async () => {
  const first = papers('s1');
  const second = papers('s2');
  await withSeed({
    parents: [PARENT],
    students: [student(), student({ id: 's2', name: 'אלה כהן' })],
    groups: [GROUP],
    health_declarations: [...first.declarations, ...second.declarations],
    participation_waivers: [...first.waivers, ...second.waivers],
  }, async () => {
    const found = openStepCandidates(db, { now: NOW });
    assert.equal(found.length, 1);
    assert.equal(found[0].students.length, 2);
    const result = await runOpenStepSweep(db, null, { now: NOW });
    assert.equal(result.created, 1);
    assert.equal(db.get(FOLLOWUP_COLLECTION)[0].subject, 'יותם ואלה');
  });
});
