import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSuppression,
  isSendablePhone,
  isMarketingSend,
  missingTemplateVariables,
  phoneBucket,
} from './broadcastSuppression.js';

const NOW = new Date('2026-08-12T10:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const MARKETING_TPL = {
  name: 'מבצע קיץ',
  meta_name: 'summer_sale',
  category: 'MARKETING',
  body: 'שלום {{1}}, מבצע!',
  variables: [{ key: '1', field: 'parent_first', label: 'שם פרטי (הורה)' }],
};

function recipient(overrides = {}) {
  return {
    id: '972501111111',
    phone: '972501111111',
    name: 'דנה כהן',
    parentId: 'p1',
    students: [{ id: 's1', name: 'נועם כהן', status: 'registered' }],
    windowOpen: true,
    marketingOptOut: false,
    invalidPhone: false,
    ...overrides,
  };
}

function log(overrides = {}) {
  return {
    direction: 'outbound',
    phone: '972501111111',
    status: 'sent',
    created_at: new Date(NOW - HOUR).toISOString(),
    ...overrides,
  };
}

test('a clean recipient passes', () => {
  const out = evaluateSuppression({ recipients: [recipient()], template: MARKETING_TPL, now: NOW });
  assert.equal(out.eligible.length, 1);
  assert.equal(out.suppressed.length, 0);
});

test('opted-out is blocked for marketing and cannot be overridden', () => {
  const out = evaluateSuppression({
    recipients: [recipient({ marketingOptOut: true })],
    template: MARKETING_TPL,
    overrides: ['972501111111'],
    now: NOW,
  });
  assert.equal(out.eligible.length, 0);
  assert.equal(out.suppressed[0].reasons[0].code, 'opted_out');
  assert.equal(out.suppressed[0].overridable, false);
});

test('opted-out still receives utility templates', () => {
  const out = evaluateSuppression({
    recipients: [recipient({ marketingOptOut: true })],
    template: { ...MARKETING_TPL, category: 'UTILITY' },
    now: NOW,
  });
  assert.equal(out.eligible.length, 1);
});

test('invalid phones are flagged, not silently dropped', () => {
  assert.equal(isSendablePhone('972501234567'), true);
  assert.equal(isSendablePhone('97231234567'), false); // landline prefix, 972 but not mobile
  assert.equal(isSendablePhone('abc'), false);
  const out = evaluateSuppression({
    recipients: [recipient({ phone: '05012', id: '05012' })],
    template: MARKETING_TPL,
    now: NOW,
  });
  assert.equal(out.suppressed[0].reasons[0].code, 'invalid_phone');
});

test('same template within the recency window suppresses; outside it does not', () => {
  const recent = evaluateSuppression({
    recipients: [recipient()],
    template: MARKETING_TPL,
    recencyDays: 7,
    logs: [log({ template_id: 'summer_sale', created_at: new Date(NOW - 2 * DAY).toISOString() })],
    now: NOW,
  });
  assert.equal(recent.suppressed[0]?.reasons[0]?.code, 'template_recency');

  const old = evaluateSuppression({
    recipients: [recipient()],
    template: MARKETING_TPL,
    recencyDays: 7,
    logs: [log({ template_id: 'summer_sale', created_at: new Date(NOW - 9 * DAY).toISOString() })],
    now: NOW,
  });
  assert.equal(old.suppressed.length, 0);
});

test('the global frequency cap counts any recent broadcast message', () => {
  const out = evaluateSuppression({
    recipients: [recipient()],
    template: MARKETING_TPL,
    capHours: 72,
    logs: [log({ source: 'broadcast', template_id: 'another_template', created_at: new Date(NOW - 10 * HOUR).toISOString() })],
    now: NOW,
  });
  assert.equal(out.suppressed[0].reasons[0].code, 'frequency_cap');
});

test('three straight failures suppress the number', () => {
  const fails = [1, 2, 3].map((i) => log({
    status: 'failed',
    created_at: new Date(NOW - i * DAY).toISOString(),
  }));
  const out = evaluateSuppression({
    recipients: [recipient()], template: MARKETING_TPL, logs: fails, now: NOW,
  });
  assert.equal(out.suppressed[0].reasons[0].code, 'repeated_failures');

  // A success since the failures clears the streak.
  const recovered = evaluateSuppression({
    recipients: [recipient()],
    template: MARKETING_TPL,
    logs: [log({ status: 'sent', created_at: new Date(NOW - HOUR).toISOString() }), ...fails],
    now: NOW,
  });
  assert.equal(recovered.suppressed.length, 0);
});

test('a placeholder name counts as a missing template variable', () => {
  const missing = missingTemplateVariables(
    MARKETING_TPL,
    { name: 'לקוח וואטסאפ', phone: '972501111111' },
    null
  );
  assert.equal(missing.length, 1);
  const out = evaluateSuppression({
    recipients: [recipient({ name: 'לקוח וואטסאפ', _parent: { name: 'לקוח וואטסאפ' }, students: [] })],
    template: MARKETING_TPL,
    now: NOW,
  });
  assert.equal(out.suppressed[0].reasons[0].code, 'missing_variables');
});

test('an override lifts overridable reasons only', () => {
  const logs = [log({ template_id: 'summer_sale', created_at: new Date(NOW - DAY).toISOString() })];
  const blocked = evaluateSuppression({
    recipients: [recipient()], template: MARKETING_TPL, logs, now: NOW,
  });
  assert.equal(blocked.eligible.length, 0);
  const overridden = evaluateSuppression({
    recipients: [recipient()], template: MARKETING_TPL, logs, overrides: ['972501111111'], now: NOW,
  });
  assert.equal(overridden.eligible.length, 1);
  assert.equal(overridden.eligible[0].overridden, true);
});

test('freeform message to a closed window is blocked', () => {
  const out = evaluateSuppression({
    recipients: [recipient({ windowOpen: false })],
    template: null,
    customMessage: 'שלום לכולם',
    now: NOW,
  });
  assert.equal(out.suppressed[0].reasons[0].code, 'window_closed');
  assert.equal(out.suppressed[0].overridable, false);
});

test('marketing send detection: template category first, then list', () => {
  assert.equal(isMarketingSend({ template: MARKETING_TPL }), true);
  assert.equal(isMarketingSend({ template: { category: 'UTILITY' } }), false);
  assert.equal(isMarketingSend({ template: null, listKey: 'operational' }), false);
  assert.equal(isMarketingSend({ template: null, listKey: 'marketing' }), true);
  assert.equal(isMarketingSend({ template: null, listKey: '' }), true);
});

test('phoneBucket folds 050 and 972 formats together', () => {
  assert.equal(phoneBucket('050-123-4567'), phoneBucket('972501234567'));
});
