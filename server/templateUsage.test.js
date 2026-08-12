import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_SENDERS, USAGE_KINDS, automationTemplateNames, withUsage } from './templateUsage.js';
import { POS_INVOICE_TEMPLATE_NAME } from './channels/templates.js';
import {
  EVENT_HOST_PAYMENT_TEMPLATE,
  EVENT_PARTICIPANT_LINK_TEMPLATE,
} from './eventWhatsappTemplates.js';
import { EQUIPMENT_TEMPLATE_NAME } from './equipmentService.js';
import { PARTICIPATION_FORM_TEMPLATE } from './participationFormWhatsappTemplate.js';
import { ONBOARDING_LINK_TEMPLATE } from './onboardingWhatsappTemplate.js';
import { AGENDA_DIGEST_TEMPLATE } from './agendaDigestTemplate.js';
import { getPaymentTemplateName } from './icount.js';

// A rename in any of those modules must break here, not go unnoticed in a badge.
test('every name in the map is still the name its module sends', () => {
  assert.equal(TEMPLATE_SENDERS[POS_INVOICE_TEMPLATE_NAME], 'pos');
  assert.equal(TEMPLATE_SENDERS[EVENT_HOST_PAYMENT_TEMPLATE], 'event');
  assert.equal(TEMPLATE_SENDERS[EVENT_PARTICIPANT_LINK_TEMPLATE], 'event');
  assert.equal(TEMPLATE_SENDERS[EQUIPMENT_TEMPLATE_NAME], 'equipment');
  assert.equal(TEMPLATE_SENDERS[PARTICIPATION_FORM_TEMPLATE], 'form');
  assert.equal(TEMPLATE_SENDERS[ONBOARDING_LINK_TEMPLATE], 'form');
  assert.equal(TEMPLATE_SENDERS[AGENDA_DIGEST_TEMPLATE], 'agenda');
  assert.equal(TEMPLATE_SENDERS[getPaymentTemplateName()], 'finance');
});

test('every kind in the map has a label', () => {
  for (const kind of Object.values(TEMPLATE_SENDERS)) {
    assert.ok(USAGE_KINDS[kind]?.label, `missing label for ${kind}`);
  }
});

test('an automation lends its own name to every template it points at', () => {
  const found = automationTemplateNames([
    {
      name: 'אישור קליטה',
      action_payload: {
        templateName: 'onboarding_completed_v1',
        templateNameWall: 'wall_form_received_v1',
        templateNameNext: '',
      },
    },
  ]);
  assert.deepEqual(found.get('onboarding_completed_v1'), ['אישור קליטה']);
  assert.deepEqual(found.get('wall_form_received_v1'), ['אישור קליטה']);
  assert.equal(found.has(''), false);
});

test('a switched-off automation does not claim its template', () => {
  const found = automationTemplateNames([
    { name: 'ישנה', enabled: false, action_payload: { templateName: 'hello' } },
  ]);
  assert.equal(found.size, 0);
});

test('the bot template is marked as the bot, and an unused one as nobody', () => {
  const rows = withUsage(
    [{ meta_name: 'bot_followup_v1' }, { meta_name: 'group_signup_link_v1' }],
    { automations: [] }
  );
  assert.deepEqual(rows[0].used_by, [{ kind: 'bot', label: 'הבוט' }]);
  assert.deepEqual(rows[1].used_by, []);
});

test('a template both hardcoded and wired to an automation shows both', () => {
  const [row] = withUsage([{ meta_name: 'my_agenda_v1' }], {
    automations: [{ name: 'תקציר יומי', action_payload: { templateName: 'my_agenda_v1' } }],
  });
  assert.deepEqual(row.used_by.map((u) => u.kind), ['agenda', 'automation']);
  assert.equal(row.used_by[1].label, 'תקציר יומי');
});
