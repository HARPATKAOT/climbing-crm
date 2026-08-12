import crypto from 'crypto';
import { expandHousehold, mergeFamily, normalizedChildName } from './studentGuardians.js';

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function normalizedPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('972')) digits = `0${digits.slice(3)}`;
  return digits;
}

function parentMember(db, parentId) {
  return (db.get('household_members') || []).find((row) => String(row.parent_id || '') === String(parentId)) || null;
}

export function householdIdForParent(db, parentId) {
  return parentMember(db, parentId)?.household_id || null;
}

function studentMember(db, studentId) {
  return (db.get('household_members') || []).find((row) => String(row.student_id || '') === String(studentId)) || null;
}

function memberTargetExists(db, row) {
  if (row?.parent_id) return !!db.getOne('parents', row.parent_id);
  if (row?.student_id) return !!db.getOne('students', row.student_id);
  return false;
}

async function save(persist, table, row) {
  if (!persist) return;
  const result = await persist(table, row);
  if (result?.ok === false) throw Object.assign(new Error(result.error || `שמירת ${table} נכשלה`), { status: 503 });
}

function upsertMember(db, householdId, patch) {
  const existing = patch.parent_id ? parentMember(db, patch.parent_id) : studentMember(db, patch.student_id);
  if (existing) return db.update('household_members', existing.id, { ...patch, household_id: householdId, updated_at: new Date().toISOString() }) || existing;
  return db.insert('household_members', {
    id: makeId('hm'),
    household_id: householdId,
    profile_status: 'complete',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
  });
}

/** Materialise the explicit household model from the proven guardian graph. */
export async function ensureHouseholdForParent(db, persist, parentId) {
  const graph = expandHousehold(db, parentId);
  // Guardian links can outlive a parent card after an old merge/delete. Such
  // an orphan is useful to clean up separately, but it must never be written
  // into household_members: that table has a real FK to parents and the whole
  // signed-form submission would otherwise fail at its final step.
  const parentIds = (graph.parentIds?.length ? graph.parentIds : [parentId])
    .map(String)
    .filter((id, index, ids) => ids.indexOf(id) === index && db.getOne('parents', id));
  if (!parentIds.length) {
    throw Object.assign(new Error('לא ניתן ליצור תיק משפחה ללא הורה קיים'), { status: 409 });
  }
  const existingMembers = (db.get('household_members') || []).filter((row) => parentIds.includes(row.parent_id));
  const householdId = existingMembers[0]?.household_id || makeId('hh');
  let household = db.getOne('households', householdId);
  if (!household) {
    household = db.insert('households', {
      id: householdId,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await save(persist, 'households', household);
  }

  // If the guardian graph joined two previously explicit households, fold all
  // members into the first one. Nothing is deleted; the spare household is
  // marked merged so a staff split can reconstruct it later.
  const otherIds = [...new Set(existingMembers.map((row) => row.household_id).filter((id) => id && id !== householdId))];
  for (const otherId of otherIds) {
    for (const row of (db.get('household_members') || []).filter((item) => item.household_id === otherId)) {
      // A stale local cache may still carry the member row after its parent or
      // student was deleted durably. Do not make a harmless household merge
      // retry that invalid FK row.
      if (!memberTargetExists(db, row)) continue;
      const updated = db.update('household_members', row.id, { household_id: householdId, updated_at: new Date().toISOString() }) || row;
      await save(persist, 'household_members', updated);
    }
    const old = db.getOne('households', otherId);
    if (old) await save(persist, 'households', db.update('households', old.id, { status: 'merged', merged_into_id: householdId, updated_at: new Date().toISOString() }) || old);
  }

  // כל בן משפחה נשמר בנסיעה נפרדת, והנסיעות המתינו זו לזו. נסיעה אחת היא
  // כ-450 מ״ש, כך שתיק של שישה נפשות עלה קרוב לשלוש שניות — וזה קרה בכל
  // מכירה בדלפק, כי מסלול הזכאות לקיר מתחיל כאן. במדידה בקופה השלב הזה היה
  // הגדול ביותר: כשש שניות מתוך אחת-עשרה, יותר מ-iCount ומהמסמך גם יחד.
  //
  // השורות עצמן נכתבות כמקודם — שורה לכל אדם, אין קיצור דרך בנתונים. הן פשוט
  // כבר לא ממתינות זו לזו, כי שורות של אנשים שונים אינן תלויות זו בזו.
  const memberRows = [
    ...parentIds.map((id) => upsertMember(db, householdId, { parent_id: id, role: 'adult' })),
    ...(graph.students || []).map((student) => upsertMember(db, householdId, {
      student_id: student.id,
      role: student.isAdult === true ? 'adult' : 'child',
      profile_status: 'complete',
    })),
  ];
  await Promise.all(memberRows.map((row) => save(persist, 'household_members', row)));

  return household;
}

export function householdMemberStudentIds(db, householdId) {
  return new Set((db.get('household_members') || [])
    .filter((row) => row.household_id === householdId && row.student_id)
    .map((row) => String(row.student_id)));
}

export function isStudentInHousehold(db, householdId, studentId) {
  return householdMemberStudentIds(db, householdId).has(String(studentId));
}

/** Adults supplied by a caller must be the payer or an existing adult member. */
export function assertNoExternalAdults(db, { parent, participants = [], householdId = null } = {}) {
  const payerName = normalizedChildName(parent?.name);
  const allowedStudentIds = householdId ? householdMemberStudentIds(db, householdId) : new Set();
  for (const participant of participants) {
    if (participant?.type !== 'adult') continue;
    if (participant.id && allowedStudentIds.has(String(participant.id))) continue;
    if (!participant.id && normalizedChildName(participant.name) === payerName) continue;
    throw Object.assign(new Error('אפשר לרשום ולשלם רק עבור בני המשפחה בתיק'), { status: 403 });
  }
}

export async function addPendingSpouse(db, persist, {
  householdId,
  name,
  phone,
  source = 'public_form',
} = {}) {
  const phoneKey = normalizedPhone(phone);
  if (!householdId || !String(name || '').trim() || phoneKey.length < 9) {
    throw Object.assign(new Error('נדרשים שם וטלפון של בן/בת הזוג'), { status: 400 });
  }
  const matches = (db.get('parents') || []).filter((row) => normalizedPhone(row.phone) === phoneKey);
  if (matches.length > 1) {
    throw Object.assign(new Error('נמצאו כמה תיקים עם מספר הטלפון — נדרש טיפול צוות'), { status: 409, code: 'AMBIGUOUS_PHONE' });
  }
  let parent = matches[0] || db.insert('parents', {
    name: String(name).trim(),
    phone: phoneKey,
    source,
    status: 'pending_profile',
    created_at: new Date().toISOString(),
  });
  await save(persist, 'parents', parent);
  if (matches[0]) {
    const anchorParentId = (db.get('household_members') || []).find((row) => (
      row.household_id === householdId && row.parent_id && String(row.parent_id) !== String(parent.id)
    ))?.parent_id || null;
    if (anchorParentId) {
      for (const link of mergeFamily(db, { parentId: parent.id, familyParentId: anchorParentId })) {
        await save(persist, 'student_guardians', link);
      }
    }

    // Move the spouse's whole explicit household, including its children.
    const existingHouseholdId = parentMember(db, parent.id)?.household_id || null;
    if (existingHouseholdId && existingHouseholdId !== householdId) {
      for (const row of (db.get('household_members') || []).filter((item) => item.household_id === existingHouseholdId)) {
        const moved = db.update('household_members', row.id, {
          household_id: householdId,
          updated_at: new Date().toISOString(),
        }) || row;
        await save(persist, 'household_members', moved);
      }
      const old = db.getOne('households', existingHouseholdId);
      if (old) {
        await save(persist, 'households', db.update('households', old.id, {
          status: 'merged',
          merged_into_id: householdId,
          updated_at: new Date().toISOString(),
        }) || old);
      }
    }
  }
  const member = upsertMember(db, householdId, {
    parent_id: parent.id,
    role: 'adult',
    profile_status: matches[0] ? 'complete' : 'pending_profile',
  });
  await save(persist, 'household_members', member);
  return { parent, member, matchedExisting: !!matches[0] };
}

/** Rebuild separate explicit household rows after staff reverses a merge. */
export async function splitExplicitHousehold(db, persist, { parentIds = [], assignments = [] } = {}) {
  const parents = [...new Set(parentIds.map(String))].filter((id) => db.getOne('parents', id));
  if (!parents.length) return { households: [] };
  const oldIds = [...new Set(parents.map((id) => householdIdForParent(db, id)).filter(Boolean))];
  const created = [];

  for (const parentId of parents) {
    const household = db.insert('households', {
      id: makeId('hh'),
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await save(persist, 'households', household);
    created.push(household);
    await save(persist, 'household_members', upsertMember(db, household.id, {
      parent_id: parentId,
      role: 'adult',
      profile_status: 'complete',
    }));

    const assignedStudentIds = new Set(assignments
      .filter((row) => String(row.parentId) === parentId)
      .map((row) => String(row.studentId)));
    for (const student of db.get('students') || []) {
      const ownAdultCard = student.isAdult === true && String(student.parentId || '') === parentId;
      if (!ownAdultCard && !assignedStudentIds.has(String(student.id))) continue;
      await save(persist, 'household_members', upsertMember(db, household.id, {
        student_id: student.id,
        role: student.isAdult === true ? 'adult' : 'child',
        profile_status: 'complete',
      }));
    }
  }

  for (const oldId of oldIds) {
    const old = db.getOne('households', oldId);
    if (old) {
      await save(persist, 'households', db.update('households', old.id, {
        status: 'split',
        merged_into_id: null,
        updated_at: new Date().toISOString(),
      }) || old);
    }
  }
  return { households: created };
}

export async function ensureAdultParticipantForParent(db, persist, {
  householdId,
  parent,
  profileStatus = 'pending_profile',
  source = 'public_form',
} = {}) {
  if (!parent?.id || !householdId) throw Object.assign(new Error('לא ניתן ליצור משתתף מבוגר ללא תיק משפחה'), { status: 400 });
  let student = (db.get('students') || []).find((row) => (
    row.isAdult === true
    && (
      String(row.parentId || '') === String(parent.id)
      || (parent.idNumber && row.idNumber && String(row.idNumber) === String(parent.idNumber))
    )
  ));
  if (!student) {
    student = db.insert('students', {
      id: makeId('student'),
      name: parent.name || '',
      parentId: parent.id,
      isAdult: true,
      phone: parent.phone || '',
      status: 'lead_new',
      source,
      birthDate: '',
      gender: '',
      idNumber: parent.idNumber || '',
      created: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    });
    await save(persist, 'students', student);
  }
  const member = upsertMember(db, householdId, {
    student_id: student.id,
    role: 'adult',
    profile_status: profileStatus,
  });
  await save(persist, 'household_members', member);
  return { student, member };
}
