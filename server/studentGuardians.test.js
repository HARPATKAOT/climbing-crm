import test from 'node:test';
import assert from 'node:assert/strict';
import {
  childrenOfParent,
  familyCandidates,
  findChildMatches,
  guardianParentIds,
  isChildOfParent,
  linkGuardian,
  mergeFamily,
  parentLastName,
  publicChildMatchPayload,
  publicFamilyCandidatesPayload,
  studentsForParent,
  unlinkGuardian,
} from './studentGuardians.js';
import { saveCrmParticipants } from './crmWaiverService.js';
import { declarationGap, mustConfirm } from './healthQuestions.js';

function createDb(seed = {}) {
  const store = {
    parents: [
      { id: 'p-avner', name: 'אבנר לוי', phone: '0521112222', email: 'avner@example.com' },
    ],
    students: [
      { id: 's-noam', name: 'נועם לוי', parentId: 'p-avner', birthDate: '2014-03-02' },
    ],
    student_guardians: [],
    health_declarations: [],
    form_templates: [{
      id: 'form-1',
      slug: 'wall',
      title: 'הצהרה',
      waiverText: 'כתב ויתור',
      healthQuestions: [{ id: 'required', label: 'כשיר', requireYes: true }],
      isDefault: true,
      isActive: true,
    }],
    ...seed,
  };
  let sequence = 0;
  return {
    store,
    get: (table) => store[table] || [],
    getOne: (table, id) => (store[table] || []).find((row) => String(row.id) === String(id)),
    insert: (table, row) => {
      const saved = { ...row, id: row.id || `${table}-${++sequence}` };
      store[table] ||= [];
      store[table].push(saved);
      return saved;
    },
    update: (table, id, patch) => {
      const index = (store[table] || []).findIndex((row) => String(row.id) === String(id));
      if (index < 0) return null;
      store[table][index] = { ...store[table][index], ...patch };
      return store[table][index];
    },
    delete: (table, id) => {
      const index = (store[table] || []).findIndex((row) => String(row.id) === String(id));
      if (index < 0) return false;
      store[table].splice(index, 1);
      return true;
    },
    upsertParentByPhone: (name, phone, email) => {
      const normalized = String(phone).replace(/\D/g, '').replace(/^972/, '0');
      let parent = store.parents.find(
        (row) => String(row.phone).replace(/\D/g, '').replace(/^972/, '0') === normalized
      );
      if (!parent) {
        parent = { id: `p-${++sequence}`, name, phone: normalized, email };
        store.parents.push(parent);
      }
      return parent;
    },
  };
}

const persist = async () => ({ ok: true });
const mum = { name: 'רותם לוי', phone: '0539998888', email: 'rotem@example.com' };
const signedNoam = {
  type: 'child',
  name: 'נועם לוי',
  birthDate: '2014-03-02',
  answers: { required: true },
  waiverAccepted: true,
  signature: 'data:image/png;base64,signed',
};

test('a match needs both the name and the exact date of birth', () => {
  const db = createDb();
  assert.equal(findChildMatches(db, { name: 'נועם לוי', birthDate: '2014-03-02' }).length, 1);
  assert.equal(findChildMatches(db, { name: ' נועם   לוי ', birthDate: '2014-03-02' }).length, 1);
  // Same name, different child.
  assert.equal(findChildMatches(db, { name: 'נועם לוי', birthDate: '2016-01-01' }).length, 0);
  // A form with no birth date gets nothing rather than a risky guess.
  assert.equal(findChildMatches(db, { name: 'נועם לוי', birthDate: '' }).length, 0);
});

test('a legacy question with no requireYes stays optional', () => {
  // The trip and birthday templates predate the field. Demanding a tick on
  // "does the child have asthma?" would block the families it asks about.
  const legacy = [{ id: 'q1', label: 'האם המתאמן סובל מאסתמה?' }];
  assert.equal(mustConfirm(legacy[0]), false);
  assert.equal(declarationGap(legacy, {}, 'נועם'), '');

  // An explicit requireYes still has to be ticked.
  const required = [{ id: 'h1', requireYes: true, label: 'אני מצהיר/ה' }];
  assert.match(declarationGap(required, {}, 'נועם'), /יש לסמן/);
  assert.equal(declarationGap(required, { h1: true }, 'נועם'), '');

  // A screening question has to be answered either way; blank is not "no".
  const screening = [{ id: 'm1', kind: 'screen', label: 'האם יש אסתמה?' }];
  assert.match(declarationGap(screening, {}, 'נועם'), /יש לענות/);
  assert.match(declarationGap(screening, { m1: null }, 'נועם'), /יש לענות/);
  assert.equal(declarationGap(screening, { m1: false }, 'נועם'), '');
  assert.equal(declarationGap(screening, { m1: true }, 'נועם'), '');
});

test('an ID number identifies the child even when the name was typed differently', () => {
  const db = createDb({
    students: [
      { id: 's-noam', name: 'נועם לוי', parentId: 'p-avner', birthDate: '2014-03-02', idNumber: '123456782' },
    ],
  });
  // Nickname instead of the registered name, and the birth date mistyped —
  // exactly the submission the name+date matcher misses.
  const byId = findChildMatches(db, { name: 'נומי', birthDate: '2014-03-03', idNumber: '123456782' });
  assert.equal(byId.length, 1);
  assert.equal(byId[0].student.id, 's-noam');

  // Punctuation is not part of an ID.
  assert.equal(findChildMatches(db, { name: '', birthDate: '', idNumber: '123-456-782' }).length, 1);
  // A stored ID that contradicts the one typed says this is somebody else,
  // however well the name and the birth date line up.
  assert.equal(findChildMatches(db, { name: 'נועם לוי', birthDate: '2014-03-02', idNumber: '999999999' }).length, 0);
  // Without an ID the old behaviour stands.
  assert.equal(findChildMatches(db, { name: 'נועם לוי', birthDate: '2014-03-02' }).length, 1);
  // And a child on file with no ID recorded — nearly all of them — is still
  // matched by name and birth date when the form supplies an ID.
  const noIdOnFile = createDb();
  assert.equal(
    findChildMatches(noIdOnFile, { name: 'נועם לוי', birthDate: '2014-03-02', idNumber: '123456782' }).length,
    1
  );
});

test('a child already on the caller own card is not offered as a match', () => {
  const db = createDb();
  const mine = findChildMatches(db, {
    name: 'נועם לוי',
    birthDate: '2014-03-02',
    excludeParentId: 'p-avner',
  });
  assert.equal(mine.length, 0);
});

test('the public answer carries a first name and nothing else', () => {
  const db = createDb();
  const payload = publicChildMatchPayload(
    findChildMatches(db, { name: 'נועם לוי', birthDate: '2014-03-02' })
  );
  assert.equal(payload.match, true);
  assert.equal(payload.guardian_first_name, 'אבנר');
  assert.equal(payload.ambiguous, false);
  assert.equal(JSON.stringify(payload).includes('0521112222'), false);
  assert.equal(JSON.stringify(payload).includes('avner@example.com'), false);
});

test('two children with the same name and birth date are never auto-linked', () => {
  const db = createDb({
    parents: [
      { id: 'p-avner', name: 'אבנר לוי', phone: '0521112222' },
      { id: 'p-other', name: 'שרה כהן', phone: '0524443333' },
    ],
    students: [
      { id: 's-noam', name: 'נועם לוי', parentId: 'p-avner', birthDate: '2014-03-02' },
      { id: 's-noam2', name: 'נועם לוי', parentId: 'p-other', birthDate: '2014-03-02' },
    ],
  });
  const payload = publicChildMatchPayload(
    findChildMatches(db, { name: 'נועם לוי', birthDate: '2014-03-02' })
  );
  assert.equal(payload.ambiguous, true);
});

test('linking is idempotent, refuses the primary parent, and can be undone', () => {
  const db = createDb();
  assert.equal(linkGuardian(db, { studentId: 's-noam', parentId: 'p-avner' }), null);
  const first = linkGuardian(db, { studentId: 's-noam', parentId: 'p-mum' });
  assert.equal(first.id, 'sg-s-noam-p-mum');
  assert.equal(linkGuardian(db, { studentId: 's-noam', parentId: 'p-mum' }), null);
  assert.deepEqual(guardianParentIds(db, 's-noam'), ['p-avner', 'p-mum']);
  assert.equal(unlinkGuardian(db, { studentId: 's-noam', parentId: 'p-mum' }), true);
  assert.deepEqual(guardianParentIds(db, 's-noam'), ['p-avner']);
});

test('a second parent joins the child file instead of creating a copy', async () => {
  const db = createDb();
  const result = await saveCrmParticipants({
    db,
    persist,
    parent: mum,
    participants: [{ ...signedNoam, link_student_id: 's-noam' }],
  });

  assert.equal(db.store.students.length, 1, 'no duplicate child');
  assert.equal(db.store.parents.length, 2, 'the second parent got their own card');
  const student = db.store.students[0];
  assert.equal(student.parentId, 'p-avner', 'the primary parent is not taken over');
  const mumId = db.store.parents.find((p) => p.name === 'רותם לוי').id;
  assert.deepEqual(guardianParentIds(db, 's-noam'), ['p-avner', mumId]);
  assert.equal(result.participants[0].student.id, 's-noam');

  // Both parents now see the same child, once.
  const enriched = { ...student, guardianIds: guardianParentIds(db, student) };
  assert.equal(isChildOfParent(enriched, 'p-avner'), true);
  assert.equal(isChildOfParent(enriched, mumId), true);
  assert.equal(studentsForParent([enriched], mumId).length, 1);
});

test('a surname typed first still finds the household', async () => {
  const db = createDb();
  // The form sends the two halves separately, so the family name no longer
  // depends on which order the parent wrote them in.
  await saveCrmParticipants({
    db,
    persist,
    parent: { name: 'לוי רותם', lastName: 'לוי', phone: '0539998888' },
    participants: [{ ...signedNoam, name: 'עידו לוי', birthDate: '2016-05-05' }],
  });

  const saved = db.store.parents.find((p) => p.phone === '0539998888');
  assert.equal(saved.lastName, 'לוי');
  assert.equal(parentLastName(saved), 'לוי', 'not "רותם", the last word of the name');
  // Which is what lets the other parent of this household be offered it.
  assert.deepEqual(
    familyCandidates(db, { lastName: 'לוי', excludeParentId: saved.id }).map((row) => row.parent.id),
    ['p-avner']
  );
});

test('the same parent on a new phone lands on their own card, not a second one', async () => {
  const db = createDb({
    parents: [
      { id: 'p-avner', name: 'אבנר לוי', phone: '0521112222', email: 'avner@example.com', idNumber: '311111119' },
    ],
  });
  await saveCrmParticipants({
    db,
    persist,
    // New handset, same person — the ID is the only thread between the two.
    parent: { name: 'אבנר לוי', lastName: 'לוי', phone: '0587776666', idNumber: '311111119' },
    participants: [{ ...signedNoam, name: 'עידו לוי', birthDate: '2016-05-05' }],
  });

  assert.equal(db.store.parents.length, 1, 'no second card for the same person');
  const saved = db.store.parents[0];
  assert.equal(saved.id, 'p-avner');
  assert.equal(saved.phone, '0587776666', 'the card now carries the number they actually used');
  assert.equal(db.store.students.filter((s) => s.parentId === 'p-avner').length, 2);
});

test('an ID shared by two cards is too ambiguous to merge on', async () => {
  const db = createDb({
    parents: [
      { id: 'p-avner', name: 'אבנר לוי', phone: '0521112222', idNumber: '311111119' },
      { id: 'p-dana', name: 'דנה כהן', phone: '0533334444', idNumber: '311111119' },
    ],
  });
  await saveCrmParticipants({
    db,
    persist,
    parent: { name: 'רותם לוי', lastName: 'לוי', phone: '0539998888', idNumber: '311111119' },
    participants: [{ ...signedNoam, name: 'עידו לוי', birthDate: '2016-05-05' }],
  });
  // Falls back to the phone rather than picking one of the two.
  assert.equal(db.store.parents.length, 3);
  assert.equal(db.store.parents.at(-1).phone, '0539998888');
});

test('a link whose details do not match the child is refused', async () => {
  const db = createDb();
  await assert.rejects(
    saveCrmParticipants({
      db,
      persist,
      parent: mum,
      // Right id, wrong child — the classic way to attach to a stranger's file.
      participants: [{ ...signedNoam, name: 'ילד אחר', link_student_id: 's-noam' }],
    }),
    /לא תואמים את הילד שנבחר/
  );
  assert.equal(db.store.student_guardians.length, 0);
});

test('a family is offered by surname, with the names a parent can recognise', () => {
  const db = createDb();
  assert.equal(parentLastName({ name: 'אבנר לוי' }), 'לוי');
  assert.equal(parentLastName({ name: 'אבנר', lastName: 'כהן' }), 'כהן');

  const payload = publicFamilyCandidatesPayload(familyCandidates(db, { lastName: 'לוי' }));
  assert.deepEqual(payload.families, [{
    parent_id: 'p-avner',
    parent_name: 'אבנר לוי',
    children: ['נועם לוי'],
    more_children: 0,
  }]);
  // Nothing to recognise, nothing offered.
  assert.equal(familyCandidates(db, { lastName: 'כהן' }).length, 0);
  assert.equal(familyCandidates(db, { lastName: 'ל' }).length, 0);
  assert.equal(familyCandidates(db, { lastName: '' }).length, 0);
  // No phone, no email — only what the question shows.
  assert.equal(JSON.stringify(payload).includes('0521112222'), false);
});

test('parents who share a child are offered as one household, not three', () => {
  const db = createDb({
    parents: [
      { id: 'p-avner', name: 'אבנר לוי', phone: '0521112222' },
      { id: 'p-rotem', name: 'רותם לוי', phone: '0523334444' },
      { id: 'p-michal', name: 'מיכל לוי', phone: '0525556666' },
    ],
    students: [
      { id: 's-noam', name: 'נועם לוי', parentId: 'p-avner', birthDate: '2014-03-02' },
      { id: 's-yuval', name: 'יובל לוי', parentId: 'p-avner', birthDate: '2018-11-20' },
    ],
    student_guardians: [
      { id: 'sg-s-noam-p-rotem', student_id: 's-noam', parent_id: 'p-rotem' },
      { id: 'sg-s-noam-p-michal', student_id: 's-noam', parent_id: 'p-michal' },
    ],
  });
  const payload = publicFamilyCandidatesPayload(familyCandidates(db, { lastName: 'לוי' }));
  assert.equal(payload.families.length, 1);
  // Merging happens against the card holding the whole family.
  assert.equal(payload.families[0].parent_id, 'p-avner');
  assert.deepEqual(payload.families[0].children.sort(), ['יובל לוי', 'נועם לוי'].sort());
  assert.match(payload.families[0].parent_name, /אבנר לוי/);
  assert.match(payload.families[0].parent_name, /רותם לוי/);
});

test('a childless card is not a family anyone could confirm', () => {
  const db = createDb({
    parents: [
      { id: 'p-avner', name: 'אבנר לוי', phone: '0521112222' },
      { id: 'p-empty', name: 'דנה לוי', phone: '0525556666' },
    ],
  });
  assert.deepEqual(
    familyCandidates(db, { lastName: 'לוי' }).map((row) => row.parent.id),
    ['p-avner']
  );
});

test('confirming the same family puts both parents on every child, once', async () => {
  const db = createDb();
  const result = await saveCrmParticipants({
    db,
    persist,
    // Mum registers a different child, and confirms this is Avner's household.
    parent: { ...mum, family_parent_id: 'p-avner' },
    participants: [{
      type: 'child',
      name: 'שקד לוי',
      birthDate: '2017-06-06',
      answers: { required: true },
      waiverAccepted: true,
      signature: 'data:image/png;base64,signed',
    }],
  });

  const mumId = result.parent.id;
  assert.equal(db.store.students.length, 2, 'the new child is created once');
  const shaked = db.store.students.find((s) => s.name === 'שקד לוי');

  // One household: both parents on both children.
  assert.deepEqual(guardianParentIds(db, 's-noam').sort(), ['p-avner', mumId].sort());
  assert.deepEqual(guardianParentIds(db, shaked.id).sort(), ['p-avner', mumId].sort());
  assert.equal(childrenOfParent(db, 'p-avner').length, 2);
  assert.equal(childrenOfParent(db, mumId).length, 2);
  // Neither child changed hands.
  assert.equal(db.store.students.find((s) => s.id === 's-noam').parentId, 'p-avner');
  assert.equal(shaked.parentId, mumId);
});

test('merging is idempotent and refuses to merge a card with itself', () => {
  const db = createDb();
  linkGuardian(db, { studentId: 's-noam', parentId: 'p-mum' });
  db.store.parents.push({ id: 'p-mum', name: 'רותם לוי', phone: '0539998888' });
  const first = mergeFamily(db, { parentId: 'p-mum', familyParentId: 'p-avner' });
  const second = mergeFamily(db, { parentId: 'p-mum', familyParentId: 'p-avner' });
  assert.equal(second.length, 0, 'nothing new the second time');
  assert.equal(mergeFamily(db, { parentId: 'p-avner', familyParentId: 'p-avner' }).length, 0);
  assert.ok(first.length >= 0);
});

test('without a link the old behaviour stands: a new child for the new parent', async () => {
  const db = createDb();
  await saveCrmParticipants({
    db,
    persist,
    parent: mum,
    participants: [signedNoam],
  });
  assert.equal(db.store.students.length, 2);
  assert.equal(db.store.student_guardians.length, 0);
});
