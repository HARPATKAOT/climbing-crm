process.env.LOCAL_DURABLE_STORAGE = '1';

import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db.js';
import {
  inClassProcess,
  openStepCandidates,
  runOpenStepSweep,
  sweptRecently,
  SWEEP_SOURCE,
} from './openStepSweep.js';
import { FOLLOWUP_COLLECTION, FOLLOWUP_OPEN } from './botFollowUps.js';
import { OUTREACH_PAUSE_COLLECTION } from './botOutreachPause.js';

const NOW = new Date('2026-08-16T09:00:00Z');
const COLLECTIONS = [
  'parents', 'students', 'groups', 'enrollments', 'health_declarations',
  'participation_waivers', 'student_equipment', FOLLOWUP_COLLECTION,
  OUTREACH_PAUSE_COLLECTION, 'group_placement_holds',
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
const SIGNED = new Date('2026-08-01T08:00:00.000Z').toISOString();

/** Placed in a group — the only thing that proves a class process. */
function placed(patch = {}) {
  return {
    id: 's1', name: 'יותם כהן', parentId: PARENT.id,
    status: 'pending_signup', groupId: GROUP.id, ...patch,
  };
}

function papers(studentId = 's1') {
  return {
    declarations: [{
      id: `hd-${studentId}`, studentId, signedDate: SIGNED,
      signature_url: 'https://example.com/sig.png',
    }],
    waivers: [{
      id: `pw-${studentId}`, studentId, scope: 'wall', signedDate: SIGNED,
      signature_url: 'https://example.com/sig.png',
    }],
  };
}

const kit = (studentId, payment_status) => ({
  id: `se-${studentId}-${payment_status}`, student_id: studentId, item_type: 'shoes', payment_status,
});

test('a place held and never registered at the מתנ״ס is what the sweep is for', async () => {
  const { declarations, waivers } = papers();
  await withSeed({
    parents: [PARENT],
    students: [placed()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  }, async () => {
    const found = openStepCandidates(db, { now: NOW });
    assert.equal(found.length, 1);
    assert.equal(found[0].reason, 'pending_signup');

    const result = await runOpenStepSweep(db, null, { now: NOW });
    assert.equal(result.created, 1);
    const [row] = db.get(FOLLOWUP_COLLECTION);
    assert.equal(row.reason, 'pending_signup');
    assert.equal(row.status, FOLLOWUP_OPEN);
    assert.equal(row.source, SWEEP_SOURCE);
    assert.equal(row.subject, 'יותם');
    // Outside a conversation there is no free-text window to lean on.
    assert.equal(row.needs_template, true);
  });
});

test('a signed form and no group is not a case this sweep can read', async () => {
  // The first dry run found 23 of these, and every one was somebody who came
  // to climb once and signed the waiver at the counter. Nothing in the data
  // separates them from a family that stopped halfway, so the sweep leaves
  // them to a conversation instead of guessing.
  const { declarations, waivers } = papers();
  await withSeed({
    parents: [PARENT],
    students: [placed({ status: 'health_signed', groupId: null })],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
    // Equipment rows do not prove it either — hundreds exist from the import.
    student_equipment: [kit('s1', 'unpaid')],
  }, async () => {
    assert.equal(inClassProcess(db, db.getOne('students', 's1')), false);
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });
});

test('a kit left open on a placed trainee is swept', async () => {
  const { declarations, waivers } = papers();
  await withSeed({
    parents: [PARENT],
    students: [placed({ status: 'registered' })],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
    student_equipment: [kit('s1', 'unpaid')],
  }, async () => {
    const found = openStepCandidates(db, { now: NOW });
    assert.equal(found.length, 1);
    assert.equal(found[0].reason, 'equipment_unpaid');
  });

  await withSeed({
    parents: [PARENT],
    students: [placed({ status: 'registered' })],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
    student_equipment: [kit('s1', 'own')],
  }, async () => {
    // Marked as owned from home is settled — nothing is open.
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });
});

test('nobody is swept twice in a week, and nobody already in the queue is added', async () => {
  const { declarations, waivers } = papers();
  const seed = {
    parents: [PARENT],
    students: [placed()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  };

  await withSeed({
    ...seed,
    [FOLLOWUP_COLLECTION]: [{
      id: 'bf-old', parent_id: PARENT.id, reason: 'pending_signup', status: 'sent',
      source: SWEEP_SOURCE, created_at: '2026-08-14T09:00:00.000Z',
    }],
  }, async () => {
    assert.equal(sweptRecently(db, PARENT.id, NOW), true);
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    ...seed,
    [FOLLOWUP_COLLECTION]: [{
      id: 'bf-open', parent_id: PARENT.id, reason: 'customer_asked', status: FOLLOWUP_OPEN,
      created_at: '2026-08-15T09:00:00.000Z',
    }],
  }, async () => {
    // Already promised a call back — a second nudge on top is the noise this
    // whole sweep exists to avoid.
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    ...seed,
    [FOLLOWUP_COLLECTION]: [{
      id: 'bf-stale', parent_id: PARENT.id, reason: 'pending_signup', status: 'sent',
      source: SWEEP_SOURCE, created_at: '2026-08-01T09:00:00.000Z',
    }],
  }, async () => {
    assert.equal(sweptRecently(db, PARENT.id, NOW), false);
    assert.equal(openStepCandidates(db, { now: NOW }).length, 1);
  });
});

test('a pause on that very subject is the customer answering the sweep in advance', async () => {
  const { declarations, waivers } = papers();
  const seed = {
    parents: [PARENT],
    students: [placed()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  };

  await withSeed({
    ...seed,
    [OUTREACH_PAUSE_COLLECTION]: [{
      id: 'bop-p1-centre', parent_id: PARENT.id, topics: ['centre'],
      until: '2026-08-30T06:00:00.000Z',
    }],
  }, async () => {
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    ...seed,
    [OUTREACH_PAUSE_COLLECTION]: [{
      id: 'bop-p1-equipment', parent_id: PARENT.id, topics: ['equipment'],
      until: '2026-08-30T06:00:00.000Z',
    }],
  }, async () => {
    // They deferred the equipment; the מתנ״ס registration is still ours to ask.
    assert.equal(openStepCandidates(db, { now: NOW }).length, 1);
  });
});

test('a customer who asked us to stop, or has no number, is never swept', async () => {
  const { declarations, waivers } = papers();
  for (const parent of [{ ...PARENT, bot_opted_out: true }, { ...PARENT, phone: '' }]) {
    await withSeed({
      parents: [parent],
      students: [placed()],
      groups: [GROUP],
      health_declarations: declarations,
      participation_waivers: waivers,
    }, async () => {
      assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
    });
  }
});

test('the three days we promised are not interrupted', async () => {
  // "המקום שמור לשלושה ימים" and then, the next morning, "הספקתם להשלים את
  // ההרשמה?". The hold carries its own reminder for the deadline morning —
  // that is the message, and nothing else goes out before it.
  const { declarations, waivers } = papers();
  const seed = {
    parents: [PARENT],
    students: [placed()],
    groups: [GROUP],
    health_declarations: declarations,
    participation_waivers: waivers,
  };

  await withSeed({
    ...seed,
    group_placement_holds: [{
      id: 'hold-1', student_id: 's1', parent_id: PARENT.id, group_ids: [GROUP.id],
      phase: 'awaiting_parent', status: 'active',
      expires_at: '2026-08-18T20:59:59.000Z',
    }],
  }, async () => {
    assert.equal(openStepCandidates(db, { now: NOW }).length, 0);
  });

  await withSeed({
    ...seed,
    group_placement_holds: [{
      id: 'hold-1', student_id: 's1', parent_id: PARENT.id, group_ids: [GROUP.id],
      phase: 'awaiting_parent', status: 'active',
      expires_at: '2026-08-15T20:59:59.000Z',
    }],
  }, async () => {
    // The three days are up and nobody registered — now it is ours again.
    assert.equal(openStepCandidates(db, { now: NOW }).length, 1);
  });
});

test('two children in one family are one message, not two', async () => {
  const first = papers('s1');
  const second = papers('s2');
  await withSeed({
    parents: [PARENT],
    students: [placed(), placed({ id: 's2', name: 'אלה כהן' })],
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
