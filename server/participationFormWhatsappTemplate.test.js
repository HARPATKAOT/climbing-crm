import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTICIPATION_FORM_TEMPLATE,
  PARTICIPATION_FORM_TEMPLATE_ID,
  ensureParticipationFormWhatsappTemplate,
  participationFormDraftFields,
  participationFormButtonParam,
  buildParticipationFormRedirectUrl,
  findApprovedParticipationFormTemplate,
} from './participationFormWhatsappTemplate.js';

function createDb(seed = []) {
  const store = { message_templates: [...seed] };
  return {
    store,
    get: (table) => store[table] || [],
    insert: (table, row) => {
      const saved = { ...row, id: row.id || `${table}-1` };
      store[table] ||= [];
      store[table].push(saved);
      return saved;
    },
  };
}

test('the button points at the API redirect with a dynamic suffix', () => {
  const draft = participationFormDraftFields();
  const [button] = draft.buttons;
  assert.equal(button.type, 'URL');
  assert.match(button.url, /^https:\/\/[^/]+\/f\/\{\{1\}\}$/);
  assert.equal(button.url.includes('localhost'), false);
  assert.equal(button.text, 'למילוי הטופס');
});

test('button param carries the form slug only when it is not the default wall form', () => {
  assert.equal(participationFormButtonParam('st1'), 'st1');
  assert.equal(participationFormButtonParam('st1', { slug: 'wall', isDefault: true }), 'st1');
  assert.equal(participationFormButtonParam('st1', { slug: 'event' }), 'st1/event');
  assert.equal(participationFormButtonParam('st1', { slug: 'trip' }), 'st1/trip');
  assert.equal(
    participationFormButtonParam('st1', { slug: 'trip' }, { healthOnly: true }),
    'st1/health-renewal'
  );
});

test('redirect URL encodes student and optional slug as path segments', () => {
  assert.match(buildParticipationFormRedirectUrl('st1'), /\/f\/st1$/);
  assert.match(
    buildParticipationFormRedirectUrl('st1', { slug: 'trip' }),
    /\/f\/st1\/trip$/
  );
  assert.match(
    buildParticipationFormRedirectUrl('st1', null, { healthOnly: true }),
    /\/f\/st1\/health-renewal$/
  );
});

test('seeded as a draft that nobody can send by accident', () => {
  const db = createDb();
  const created = ensureParticipationFormWhatsappTemplate({ db });
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.active_for_send, false);
  assert.equal(created.meta_name, PARTICIPATION_FORM_TEMPLATE);
  assert.equal(findApprovedParticipationFormTemplate(db), null);
});

test('seeding twice does not create a second copy', () => {
  const db = createDb();
  ensureParticipationFormWhatsappTemplate({ db });
  ensureParticipationFormWhatsappTemplate({ db });
  assert.equal(db.store.message_templates.length, 1);

  const other = createDb([{ id: 'whatever', meta_name: PARTICIPATION_FORM_TEMPLATE }]);
  ensureParticipationFormWhatsappTemplate({ db: other });
  assert.equal(other.store.message_templates.length, 1);
  assert.equal(PARTICIPATION_FORM_TEMPLATE_ID, 'tpl-participation-form-link');
});

test('approved template is returned for sending', () => {
  const db = createDb([
    {
      id: PARTICIPATION_FORM_TEMPLATE_ID,
      meta_name: PARTICIPATION_FORM_TEMPLATE,
      status: 'APPROVED',
      active_for_send: true,
    },
  ]);
  const found = findApprovedParticipationFormTemplate(db);
  assert.equal(found.meta_name, PARTICIPATION_FORM_TEMPLATE);
});
