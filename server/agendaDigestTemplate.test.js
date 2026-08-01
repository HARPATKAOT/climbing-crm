import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENDA_DIGEST_TEMPLATE,
  AGENDA_DIGEST_TEMPLATE_ID,
  agendaDigestDraftFields,
  ensureAgendaDigestTemplate,
} from './agendaDigestTemplate.js';

function fakeDb(rows = []) {
  const store = [...rows];
  return {
    rows: store,
    get: () => store,
    insert: (_table, record) => {
      store.push(record);
      return record;
    },
  };
}

test('the draft carries exactly one body variable, with text around it', () => {
  const fields = agendaDigestDraftFields();
  const placeholders = fields.body.match(/\{\{\d+\}\}/g) || [];
  assert.deepEqual(placeholders, ['{{1}}']);
  assert.equal(fields.variables.length, 1);
  assert.equal(fields.body_examples.length, 1);
  // Meta rejects a body that starts or ends on a variable.
  assert.ok(!fields.body.trim().startsWith('{{'));
  assert.ok(!fields.body.trim().endsWith('}}'));
});

test('the example value has no newline, the way a real send flattens it', () => {
  assert.doesNotMatch(agendaDigestDraftFields().body_examples[0], /\n/);
});

test('it seeds a draft so staff can submit it to Meta', () => {
  const db = fakeDb();
  const created = ensureAgendaDigestTemplate({ db });
  assert.equal(created.meta_name, AGENDA_DIGEST_TEMPLATE);
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.active_for_send, false);
  assert.equal(db.rows.length, 1);
});

test('seeding twice does not create a second copy', () => {
  const db = fakeDb();
  ensureAgendaDigestTemplate({ db });
  ensureAgendaDigestTemplate({ db });
  assert.equal(db.rows.length, 1);
});

test('an existing template with the same meta name is left alone', () => {
  const db = fakeDb([
    { id: 'other-id', meta_name: AGENDA_DIGEST_TEMPLATE, status: 'APPROVED' },
  ]);
  const found = ensureAgendaDigestTemplate({ db });
  assert.equal(found.id, 'other-id');
  assert.equal(found.status, 'APPROVED');
  assert.equal(db.rows.length, 1);
});

test('the id stays stable so a redeploy does not duplicate it', () => {
  assert.equal(agendaDigestDraftFields().id, AGENDA_DIGEST_TEMPLATE_ID);
});
