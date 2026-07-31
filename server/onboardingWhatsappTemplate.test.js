import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_LINK_TEMPLATE,
  ONBOARDING_TEMPLATE_ID,
  ensureOnboardingLinkTemplate,
  onboardingLinkDraftFields,
} from './onboardingWhatsappTemplate.js';

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

test('the button points at the API redirect, never at an outside form', () => {
  const draft = onboardingLinkDraftFields();
  const [button] = draft.buttons;
  assert.equal(button.type, 'URL');
  assert.match(button.url, /^https:\/\/[^/]+\/o$/);
  assert.equal(button.url.includes('noteforms'), false);
  assert.equal(button.url.includes('localhost'), false);
  // Static URL: nothing about the customer travels in the address.
  assert.equal(/\{\{\d+\}\}/.test(button.url), false);
});

test('seeded as a draft that nobody can send by accident', () => {
  const db = createDb();
  const created = ensureOnboardingLinkTemplate({ db });
  assert.equal(created.status, 'DRAFT');
  assert.equal(created.active_for_send, false);
  assert.equal(created.meta_name, ONBOARDING_LINK_TEMPLATE);
  assert.equal(created.tag, 'מילוי פרטים');
  assert.ok(created.usage.includes('coustumer_details'), 'says which template it replaces');
});

test('seeding twice does not create a second copy', () => {
  const db = createDb();
  ensureOnboardingLinkTemplate({ db });
  ensureOnboardingLinkTemplate({ db });
  assert.equal(db.store.message_templates.length, 1);

  // Also recognised when only the Meta name matches (id assigned elsewhere).
  const other = createDb([{ id: 'whatever', meta_name: ONBOARDING_LINK_TEMPLATE }]);
  ensureOnboardingLinkTemplate({ db: other });
  assert.equal(other.store.message_templates.length, 1);
  assert.equal(ONBOARDING_TEMPLATE_ID, 'tpl-customer-details-v2');
});

test('the old NoteForms template is left alone — deleting it is a human decision', () => {
  const db = createDb([{ id: 'tpl_old', meta_name: 'coustumer_details', status: 'APPROVED' }]);
  ensureOnboardingLinkTemplate({ db });
  assert.equal(db.store.message_templates.length, 2);
  assert.equal(db.store.message_templates[0].status, 'APPROVED');
});
