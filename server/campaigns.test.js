import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIGGER_TYPES,
  SEND_STATUS,
  SKIP_REASONS,
  normalizeCampaign,
  buildActivityIndex,
  lastActivityFor,
  findCandidates,
  screenCandidate,
  fillCampaignMessage,
  campaignMessageVars,
  runCampaign,
  runCouponReminders,
  runDueCampaigns,
  campaignPresets,
} from './campaigns.js';
import { COUPON_STATUS } from './coupons.js';

function fakeDb(tables = {}) {
  let seq = 0;
  return {
    tables,
    get: (table) => tables[table] || [],
    getOne: (table, id) =>
      (tables[table] || []).find((row) => String(row.id) === String(id)) || null,
    insert: (table, record) => {
      if (!tables[table]) tables[table] = [];
      seq += 1;
      const row = { ...record, id: record.id || `${table}-${seq}` };
      tables[table].push(row);
      return row;
    },
    update: (table, id, patch) => {
      const rows = tables[table] || [];
      const idx = rows.findIndex((row) => String(row.id) === String(id));
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...patch };
      return rows[idx];
    },
  };
}

const TODAY = '2026-07-29';

const baseCampaign = (over = {}) =>
  normalizeCampaign({
    id: 'c1',
    name: 'חימום',
    trigger_type: TRIGGER_TYPES.INACTIVE_CUSTOMER,
    trigger_config: { inactiveDays: 60, maxInactiveDays: 365 },
    offer: { type: 'percent', value: 50, units: 1, validityDays: 30 },
    message: { text: 'שלום {{parentName}}, קוד {{coupon}}' },
    mode: 'auto',
    is_active: true,
    start_date: '2026-01-01',
    ...over,
  });

function collector() {
  const calls = [];
  return {
    calls,
    send: async (payload) => {
      calls.push(payload);
      return { sent: true };
    },
  };
}

test('campaign normalization clamps numbers and defaults to approval mode', () => {
  const c = normalizeCampaign({ id: 'x', daily_cap: 0, cooldown_days: -3, name: '  ' });
  assert.equal(c.mode, 'approval');
  assert.equal(c.daily_cap, 1);
  assert.equal(c.cooldown_days, 0);
  assert.equal(c.name, 'קמפיין ללא שם');
  assert.equal(c.is_active, false);
  assert.equal(c.requires_opt_in, true);
});

test('activity index takes the latest signal across check-ins, classes and sales', () => {
  const db = fakeDb({
    check_ins: [{ climber_id: 's1', timestamp: '2026-03-01T10:00:00Z' }],
    attendance: [
      { student_id: 's1', date: '2026-04-10', status: 'attended' },
      { student_id: 's1', date: '2026-06-10', status: 'absent' },
    ],
    pos_sales: [
      { id: 'sale1', parent_id: 'p1', total: 100, status: 'paid', created_at: '2026-05-02T09:00:00Z' },
      { id: 'sale2', parent_id: 'p1', total: 100, status: 'refunded', created_at: '2026-07-01T09:00:00Z' },
    ],
    payments: [{ parent_id: 'p1', status: 'paid', paid_at: '2026-05-20T09:00:00Z' }],
  });
  const index = buildActivityIndex(db);
  assert.equal(lastActivityFor(index, { parentId: 'p1', studentIds: ['s1'] }), '2026-05-20');
  // An absent mark and a refunded sale are not signs of life.
  assert.equal(index.byStudent.get('s1'), '2026-04-10');
});

test('the lapsed-customer trigger needs a real gap and ignores never-active leads', () => {
  const db = fakeDb({
    parents: [
      { id: 'p1', name: 'דנה', phone: '0501111111' },
      { id: 'p2', name: 'יוסי', phone: '0502222222' },
      { id: 'p3', name: 'ליד', phone: '0503333333' },
      { id: 'p4', name: 'עתיק', phone: '0504444444' },
    ],
    students: [
      { id: 's1', parentId: 'p1', name: 'נועם' },
      { id: 's2', parentId: 'p2', name: 'רן' },
    ],
    check_ins: [
      { climber_id: 's1', timestamp: '2026-04-01T10:00:00Z' }, // 119 days — in range
      { climber_id: 's2', timestamp: '2026-07-20T10:00:00Z' }, // 9 days — too recent
    ],
    pos_sales: [
      { id: 'sale-old', parent_id: 'p4', status: 'paid', created_at: '2020-01-01T10:00:00Z' },
    ],
  });

  const found = findCandidates(db, baseCampaign(), { today: TODAY });
  assert.deepEqual(found.map((c) => c.parentId), ['p1']);
  assert.match(found[0].reason, /119 ימים/);
});

test('the stale-lead trigger respects the age window and covers card-only leads', () => {
  const db = fakeDb({
    parents: [
      { id: 'p1', name: 'הורה', phone: '050', created_at: '2026-07-10' },
      { id: 'p2', name: 'ליד בלי ילד', phone: '051', status: 'lead_new', created_at: '2026-07-10' },
      { id: 'p3', name: 'ליד ישן', phone: '052', status: 'lead_new', created_at: '2020-01-01' },
    ],
    students: [
      { id: 's1', parentId: 'p1', name: 'ילד', status: 'lead_new', created_at: '2026-07-10' },
      { id: 's2', parentId: 'p1', name: 'רשום', status: 'registered', created_at: '2026-07-10' },
    ],
  });
  const campaign = baseCampaign({
    trigger_type: TRIGGER_TYPES.STALE_LEAD,
    trigger_config: { leadMinDays: 7, leadMaxDays: 90 },
  });
  const found = findCandidates(db, campaign, { today: TODAY });
  assert.deepEqual(found.map((c) => c.parentId).sort(), ['p1', 'p2']);
});

test('the new-signup trigger reads the status history and falls back to creation date', () => {
  const db = fakeDb({
    parents: [
      { id: 'p1', name: 'א', phone: '050' },
      { id: 'p2', name: 'ב', phone: '051' },
    ],
    students: [
      { id: 's1', parentId: 'p1', name: 'חדש', status: 'registered', created_at: '2020-01-01' },
      { id: 's2', parentId: 'p2', name: 'ותיק', status: 'registered', created_at: '2026-07-28' },
    ],
    lead_status_history: [
      { entity_type: 'student', entity_id: 's1', parent_id: 'p1', to_status: 'registered', changed_at: '2026-07-28T08:00:00Z' },
      { entity_type: 'student', entity_id: 's2', parent_id: 'p2', to_status: 'registered', changed_at: '2020-01-01T08:00:00Z', is_baseline: true },
    ],
  });
  const campaign = baseCampaign({
    trigger_type: TRIGGER_TYPES.NEW_SIGNUP,
    trigger_config: { signupWithinDays: 3 },
  });
  const found = findCandidates(db, campaign, { today: TODAY });
  // s1 via history (registered long after it was created), s2 via the fallback.
  assert.deepEqual(found.map((c) => c.studentId).sort(), ['s1', 's2']);
  assert.equal(found.length, 2);
});

test('the pass-ending trigger catches low punches and near expiry, not dead passes', () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'א', phone: '050' }],
    students: [{ id: 's1', parentId: 'p1', name: 'ילד' }],
    customer_passes: [
      { id: 'pass1', student_id: 's1', parent_id: 'p1', pass_type: 'punch_card', status: 'active', visits_remaining: 2, visits_total: 10, valid_until: '2026-12-01', name: 'כרטיסייה' },
      { id: 'pass2', student_id: 's1', parent_id: 'p1', pass_type: 'time_membership', status: 'active', valid_until: '2026-08-05', name: 'מנוי' },
      { id: 'pass3', student_id: 's1', parent_id: 'p1', pass_type: 'punch_card', status: 'active', visits_remaining: 9, valid_until: '2026-12-01', name: 'חדשה' },
      { id: 'pass4', student_id: 's1', parent_id: 'p1', pass_type: 'punch_card', status: 'active', visits_remaining: 0, valid_until: '2026-12-01', name: 'ריקה' },
    ],
  });
  const campaign = baseCampaign({
    trigger_type: TRIGGER_TYPES.PASS_ENDING,
    trigger_config: { visitsRemaining: 2, expiringWithinDays: 14 },
  });
  const found = findCandidates(db, campaign, { today: TODAY });
  assert.equal(found.length, 2);
  assert.match(found.map((c) => c.reason).join(' '), /נשארו 2 כניסות/);
});

test('guards refuse no phone, opted-out, re-entry, cooldown and an existing coupon', () => {
  const db = fakeDb({
    parents: [
      { id: 'p1', name: 'א', phone: '050' },
      { id: 'p2', name: 'ב', phone: '051', marketing_opt_in: false },
    ],
    customer_coupons: [
      { id: 'cp1', parent_id: 'p3', status: COUPON_STATUS.ACTIVE, expires_at: '2026-12-01' },
    ],
  });
  const campaign = baseCampaign({ cooldown_days: 14, re_entry_days: 180 });
  const ctx = {
    today: TODAY,
    kids: new Map(),
    sends: [
      { campaign_id: 'c1', parent_id: 'p4', status: SEND_STATUS.SENT, date: '2026-07-01' },
      { campaign_id: 'other', parent_id: 'p5', status: SEND_STATUS.SENT, date: '2026-07-25' },
    ],
  };

  const check = (entry) => screenCandidate(db, campaign, entry, ctx);
  assert.equal(check({ parentId: 'p1', phone: '' }).reason, SKIP_REASONS.NO_PHONE);
  assert.equal(check({ parentId: 'p2', phone: '051' }).reason, SKIP_REASONS.NO_OPT_IN);
  assert.equal(check({ parentId: 'p4', phone: '052' }).reason, SKIP_REASONS.ALREADY_IN_CAMPAIGN);
  assert.equal(check({ parentId: 'p5', phone: '053' }).reason, SKIP_REASONS.COOLDOWN);
  assert.equal(check({ parentId: 'p3', phone: '054' }).reason, SKIP_REASONS.ACTIVE_COUPON);
  assert.equal(check({ parentId: 'p1', phone: '050' }).ok, true);
});

test('an active pass only blocks when the campaign asks it to', () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'א', phone: '050' }],
    customer_passes: [
      { id: 'pass1', parent_id: 'p1', student_id: 's1', pass_type: 'time_membership', status: 'active', valid_until: '2026-12-01' },
    ],
  });
  const ctx = { today: TODAY, kids: new Map(), sends: [] };
  const entry = { parentId: 'p1', phone: '050' };
  assert.equal(screenCandidate(db, baseCampaign(), entry, ctx).ok, true);
  assert.equal(
    screenCandidate(db, baseCampaign({ skip_if_active_pass: true }), entry, ctx).reason,
    SKIP_REASONS.ACTIVE_PASS
  );
});

test('a dry run reports the numbers without writing anything', async () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'דנה', phone: '050' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם' }],
    check_ins: [{ climber_id: 's1', timestamp: '2026-01-01T10:00:00Z' }],
  });
  const summary = await runCampaign(db, baseCampaign(), { today: TODAY, dryRun: true });
  assert.equal(summary.candidates, 1);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.dry_run, true);
  assert.equal(db.get('customer_coupons').length, 0);
  assert.equal(db.get('campaign_sends').length, 0);
});

test('an automatic run issues a coupon, sends once, and will not repeat tomorrow', async () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם' }],
    check_ins: [{ climber_id: 's1', timestamp: '2026-01-01T10:00:00Z' }],
  });
  const sender = collector();

  const first = await runCampaign(db, baseCampaign(), { today: TODAY, sendMessage: sender.send });
  assert.equal(first.sent, 1);
  assert.equal(first.issued, 1);
  assert.equal(db.get('customer_coupons').length, 1);

  const coupon = db.get('customer_coupons')[0];
  assert.equal(coupon.parent_id, 'p1');
  assert.equal(coupon.source, 'campaign');
  assert.match(sender.calls[0].text, new RegExp(coupon.code));

  const second = await runCampaign(db, baseCampaign(), { today: '2026-07-30', sendMessage: sender.send });
  assert.equal(second.accepted, 0);
  assert.equal(second.skippedSample[0].skipReason, SKIP_REASONS.ALREADY_IN_CAMPAIGN);
  assert.equal(db.get('customer_coupons').length, 1);
});

test('approval mode records a suggestion and issues no coupon', async () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם' }],
    check_ins: [{ climber_id: 's1', timestamp: '2026-01-01T10:00:00Z' }],
  });
  const sender = collector();
  const summary = await runCampaign(db, baseCampaign({ mode: 'approval' }), {
    today: TODAY,
    sendMessage: sender.send,
  });
  assert.equal(summary.pending, 1);
  assert.equal(summary.sent, 0);
  assert.equal(sender.calls.length, 0);
  assert.equal(db.get('customer_coupons').length, 0);
  assert.equal(db.get('campaign_sends')[0].status, SEND_STATUS.PENDING);
});

test('the daily cap holds back the rest of the back catalogue', async () => {
  const parents = [];
  const students = [];
  const checkIns = [];
  for (let i = 0; i < 10; i += 1) {
    parents.push({ id: `p${i}`, name: `הורה ${i}`, phone: `05011111${i}` });
    students.push({ id: `s${i}`, parentId: `p${i}`, name: `ילד ${i}` });
    checkIns.push({ climber_id: `s${i}`, timestamp: '2026-01-01T10:00:00Z' });
  }
  const db = fakeDb({ parents, students, check_ins: checkIns });
  const sender = collector();

  const summary = await runCampaign(db, baseCampaign({ daily_cap: 3, cooldown_days: 0 }), {
    today: TODAY,
    sendMessage: sender.send,
  });
  assert.equal(summary.candidates, 10);
  assert.equal(summary.sent, 3);
  assert.equal(sender.calls.length, 3);
  assert.equal(
    summary.skippedSample.filter((s) => s.skipReason === SKIP_REASONS.DAILY_CAP).length,
    7
  );

  // Running again the same day respects what already went out.
  const again = await runCampaign(db, baseCampaign({ daily_cap: 3, cooldown_days: 0 }), {
    today: TODAY,
    sendMessage: sender.send,
  });
  assert.equal(again.sent, 0);
});

test('a failed send is recorded and no send is counted', async () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם' }],
    check_ins: [{ climber_id: 's1', timestamp: '2026-01-01T10:00:00Z' }],
  });
  const summary = await runCampaign(db, baseCampaign(), {
    today: TODAY,
    sendMessage: async () => ({ sent: false, reason: 'window_closed' }),
  });
  assert.equal(summary.sent, 0);
  assert.equal(summary.failed, 1);
  assert.equal(db.get('campaign_sends')[0].status, SEND_STATUS.FAILED);
  assert.equal(db.get('campaign_sends')[0].error, 'window_closed');
});

test('a campaign never reaches back before the day it was switched on', async () => {
  const db = fakeDb({
    campaigns: [baseCampaign({ start_date: '2026-08-15' })],
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם' }],
    check_ins: [{ climber_id: 's1', timestamp: '2026-01-01T10:00:00Z' }],
  });
  const results = await runDueCampaigns(db, { today: TODAY, sendMessage: async () => ({ sent: true }) });
  assert.equal(results.length, 0);
  assert.equal(db.get('customer_coupons').length, 0);
});

test('switched-off campaigns are ignored by the daily pass', async () => {
  const db = fakeDb({
    campaigns: [baseCampaign({ is_active: false })],
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    students: [{ id: 's1', parentId: 'p1', name: 'נועם' }],
    check_ins: [{ climber_id: 's1', timestamp: '2026-01-01T10:00:00Z' }],
  });
  const results = await runDueCampaigns(db, { today: TODAY, sendMessage: async () => ({ sent: true }) });
  assert.equal(results.length, 0);
});

test('expiry reminders go out once, only near the end of the validity', async () => {
  const db = fakeDb({
    parents: [{ id: 'p1', name: 'דנה', phone: '0501111111' }],
    customer_coupons: [
      { id: 'cp1', campaign_id: 'c1', parent_id: 'p1', status: COUPON_STATUS.ACTIVE, expires_at: '2026-07-31', label: 'חצי מחיר', code: 'AAA111' },
      { id: 'cp2', campaign_id: 'c1', parent_id: 'p1', status: COUPON_STATUS.ACTIVE, expires_at: '2026-09-30', label: 'חצי מחיר', code: 'BBB222' },
    ],
  });
  const sender = collector();
  const first = await runCouponReminders(db, baseCampaign({ reminder_days_before: 3 }), {
    today: TODAY,
    sendMessage: sender.send,
  });
  assert.equal(first.reminded, 1);
  assert.match(sender.calls[0].text, /AAA111/);

  const second = await runCouponReminders(db, baseCampaign({ reminder_days_before: 3 }), {
    today: TODAY,
    sendMessage: sender.send,
  });
  assert.equal(second.reminded, 0);
});

test('message placeholders resolve to the coupon that was just issued', () => {
  const vars = campaignMessageVars({
    entry: { parentName: 'דנה', studentName: 'נועם' },
    coupon: { code: 'AAA111', label: 'חצי מחיר', expires_at: '2026-08-30' },
    businessName: 'קיר בועז',
  });
  const text = fillCampaignMessage(
    'שלום {{parentName}}, {{couponLabel}} קוד {{coupon}} עד {{expires}} · {{business}} · {{missing}}',
    vars
  );
  assert.match(text, /דנה/);
  assert.match(text, /חצי מחיר/);
  assert.match(text, /AAA111/);
  assert.match(text, /קיר בועז/);
  assert.doesNotMatch(text, /\{\{/);
});

test('every preset is a valid campaign with an offer and a message', () => {
  for (const preset of campaignPresets()) {
    const c = normalizeCampaign(preset);
    assert.ok(Object.values(TRIGGER_TYPES).includes(c.trigger_type), c.name);
    assert.ok(c.offer, c.name);
    assert.ok(c.message.text.includes('{{coupon}}'), c.name);
    assert.equal(c.mode, 'approval', c.name);
    assert.equal(c.is_active, false, c.name);
  }
});
