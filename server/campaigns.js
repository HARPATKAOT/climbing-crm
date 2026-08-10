/**
 * Campaigns: rules that decide, once a day, who should hear from us and what
 * benefit they get.
 *
 * A campaign is a trigger (who qualifies) plus an offer (what they get) plus a
 * message. Running it produces `campaign_sends` rows — one per person per
 * entry — which double as the audit trail and as the de-duplication key, the
 * same shape `automation_sends` uses for the intro-class jobs.
 *
 * Two things this file deliberately protects against, because both bite on day
 * one of any campaign system: sending the whole back catalogue the moment a
 * campaign is switched on, and one customer being caught by three campaigns in
 * the same morning.
 */

import {
  OFFER_TYPES,
  issueCoupon,
  activeCouponsFor,
  normalizeOffer,
  offerSummary,
  todayIsoDate,
  daysBetween,
  addDaysIso,
  couponState,
  COUPON_STATUS,
} from './coupons.js';
import { isPassUsable, PRODUCT_TYPES } from './posUtils.js';

export const TRIGGER_TYPES = {
  INACTIVE_CUSTOMER: 'inactive_customer',
  STALE_LEAD: 'stale_lead',
  NEW_SIGNUP: 'new_signup',
  PASS_ENDING: 'pass_ending',
};

export const TRIGGER_LABELS = {
  [TRIGGER_TYPES.INACTIVE_CUSTOMER]: 'לקוח שנעלם',
  [TRIGGER_TYPES.STALE_LEAD]: 'ליד שלא הבשיל',
  [TRIGGER_TYPES.NEW_SIGNUP]: 'נרשם עכשיו',
  [TRIGGER_TYPES.PASS_ENDING]: 'כרטיסייה או מנוי שנגמרים',
};

export const SEND_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  REJECTED: 'rejected',
};

/** Statuses that mean "still a lead" — nobody here has signed up for a class. */
const LEAD_STATUSES = new Set(['lead_new', 'health_signed', 'pending_signup', 'intro_scheduled', 'intro_paid', 'waitlist']);

const ATTENDED_STATUSES = new Set(['attended', 'intro_attended']);

// ─── Campaign definition ─────────────────────────────────────────────────────

export function normalizeCampaign(raw = {}) {
  const triggerType = Object.values(TRIGGER_TYPES).includes(raw.trigger_type)
    ? raw.trigger_type
    : TRIGGER_TYPES.INACTIVE_CUSTOMER;

  const cfg = raw.trigger_config || {};
  const num = (value, fallback, { min = 0, max = 3650 } = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  return {
    id: raw.id,
    name: String(raw.name || '').trim() || 'קמפיין ללא שם',
    trigger_type: triggerType,
    trigger_config: {
      inactiveDays: num(cfg.inactiveDays, 60, { min: 7 }),
      maxInactiveDays: num(cfg.maxInactiveDays, 365, { min: 14 }),
      leadMinDays: num(cfg.leadMinDays, 7, { min: 1 }),
      leadMaxDays: num(cfg.leadMaxDays, 90, { min: 2 }),
      signupWithinDays: num(cfg.signupWithinDays, 3, { min: 1, max: 60 }),
      visitsRemaining: num(cfg.visitsRemaining, 2, { min: 0, max: 20 }),
      expiringWithinDays: num(cfg.expiringWithinDays, 14, { min: 1, max: 90 }),
    },
    offer: raw.offer ? normalizeOffer(raw.offer) : null,
    message: {
      text: String(raw.message?.text || '').trim(),
      templateName: raw.message?.templateName || null,
      templateVarKeys: Array.isArray(raw.message?.templateVarKeys)
        ? raw.message.templateVarKeys
        : ['parentName', 'couponLabel', 'coupon', 'expires'],
      language: raw.message?.language || undefined,
      preferTemplate: raw.message?.preferTemplate !== false,
    },
    mode: raw.mode === 'auto' ? 'auto' : 'approval',
    is_active: raw.is_active === true,
    daily_cap: num(raw.daily_cap, 20, { min: 1, max: 500 }),
    cooldown_days: num(raw.cooldown_days, 14, { min: 0, max: 365 }),
    re_entry_days: num(raw.re_entry_days, 180, { min: 1 }),
    reminder_days_before: num(raw.reminder_days_before, 3, { min: 0, max: 60 }),
    requires_opt_in: raw.requires_opt_in !== false,
    skip_if_active_coupon: raw.skip_if_active_coupon !== false,
    skip_if_active_pass: raw.skip_if_active_pass === true,
    start_date: raw.start_date || todayIsoDate(),
    created_at: raw.created_at || new Date().toISOString(),
    updated_at: raw.updated_at || null,
  };
}

// ─── Customer activity ───────────────────────────────────────────────────────

function isoDay(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function laterDay(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/**
 * Last time we saw this person: a check-in, a class they attended, or money
 * that changed hands. Built once per run as two maps so a campaign over a few
 * thousand customers stays a single pass over each table.
 */
export function buildActivityIndex(db) {
  const byStudent = new Map();
  const byParent = new Map();
  const bump = (map, key, day) => {
    if (!key || !day) return;
    const id = String(key);
    map.set(id, laterDay(map.get(id), day));
  };

  for (const row of db.get('check_ins') || []) {
    bump(byStudent, row.climber_id, isoDay(row.timestamp || row.created_at));
  }
  for (const row of db.get('attendance') || []) {
    if (!ATTENDED_STATUSES.has(row.status)) continue;
    bump(byStudent, row.student_id, isoDay(row.date));
  }
  for (const sale of db.get('pos_sales') || []) {
    if (sale.status === 'refunded' || sale.status === 'cancelled') continue;
    if (sale.status === 'pending_payment' || sale.status === 'quoted') continue;
    const day = isoDay(sale.created_at);
    bump(byStudent, sale.student_id, day);
    bump(byParent, sale.parent_id, day);
  }
  for (const payment of db.get('payments') || []) {
    if (payment.status !== 'paid') continue;
    const day = isoDay(payment.paid_at || payment.updated_at || payment.created_at);
    bump(byStudent, payment.student_id, day);
    bump(byParent, payment.parent_id, day);
  }

  return { byStudent, byParent };
}

export function lastActivityFor(index, { parentId, studentIds = [] }) {
  let latest = parentId ? index.byParent.get(String(parentId)) || null : null;
  for (const id of studentIds) {
    latest = laterDay(latest, index.byStudent.get(String(id)) || null);
  }
  return latest;
}

// ─── Candidate discovery ─────────────────────────────────────────────────────

function familyIndex(db) {
  const students = db.get('students') || [];
  const byParent = new Map();
  for (const student of students) {
    if (!student.parentId) continue;
    const key = String(student.parentId);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(student);
  }
  return byParent;
}

function candidate({ parent, student, reason, sortKey }) {
  return {
    parentId: parent?.id || null,
    parentName: parent?.name || '',
    phone: parent?.phone || '',
    studentId: student?.id || null,
    studentName: student?.name || '',
    reason,
    sortKey: sortKey || '',
  };
}

/**
 * Everyone the trigger would catch today, before any guard is applied.
 * `runCampaign` filters this list; the dry run shows it as-is so the numbers
 * the screen reports are the numbers the campaign will act on.
 */
export function findCandidates(db, rawCampaign, { today = todayIsoDate() } = {}) {
  const campaign = normalizeCampaign(rawCampaign);
  const cfg = campaign.trigger_config;
  const parents = db.get('parents') || [];
  const parentById = new Map(parents.map((p) => [String(p.id), p]));
  const kids = familyIndex(db);
  const out = [];

  if (campaign.trigger_type === TRIGGER_TYPES.INACTIVE_CUSTOMER) {
    const activity = buildActivityIndex(db);
    for (const parent of parents) {
      const students = kids.get(String(parent.id)) || [];
      const last = lastActivityFor(activity, {
        parentId: parent.id,
        studentIds: students.map((s) => s.id),
      });
      // Never been active at all — that is a lead, not a lapsed customer.
      if (!last) continue;
      const gap = daysBetween(last, today);
      if (gap == null || gap < cfg.inactiveDays || gap > cfg.maxInactiveDays) continue;
      out.push(
        candidate({
          parent,
          student: students[0] || null,
          reason: `לא היה פעיל ${gap} ימים · לאחרונה ב-${last}`,
          sortKey: last,
        })
      );
    }
    return out;
  }

  if (campaign.trigger_type === TRIGGER_TYPES.STALE_LEAD) {
    const seenParents = new Set();
    for (const student of db.get('students') || []) {
      if (!LEAD_STATUSES.has(student.status)) continue;
      const created = isoDay(student.created_at || student.created);
      if (!created) continue;
      const age = daysBetween(created, today);
      if (age == null || age < cfg.leadMinDays || age > cfg.leadMaxDays) continue;
      const parent = parentById.get(String(student.parentId));
      if (!parent) continue;
      seenParents.add(String(parent.id));
      out.push(
        candidate({
          parent,
          student,
          reason: `ליד בן ${age} ימים · סטטוס: ${student.status}`,
          sortKey: created,
        })
      );
    }
    // Leads that only ever had a customer card and no trainee record.
    for (const parent of parents) {
      if (seenParents.has(String(parent.id))) continue;
      if (!LEAD_STATUSES.has(parent.status)) continue;
      if ((kids.get(String(parent.id)) || []).length) continue;
      const created = isoDay(parent.created_at);
      if (!created) continue;
      const age = daysBetween(created, today);
      if (age == null || age < cfg.leadMinDays || age > cfg.leadMaxDays) continue;
      out.push({
        ...candidate({ parent, student: null, reason: `ליד בן ${age} ימים`, sortKey: created }),
      });
    }
    return out;
  }

  if (campaign.trigger_type === TRIGGER_TYPES.NEW_SIGNUP) {
    const since = addDaysIso(today, -cfg.signupWithinDays);
    const history = (db.get('lead_status_history') || []).filter(
      (row) => row.to_status === 'registered' && row.is_baseline !== true
    );
    const seen = new Set();

    for (const row of history) {
      const day = isoDay(row.changed_at);
      if (!day || day < since || day > today) continue;
      const student =
        row.entity_type === 'student'
          ? (db.get('students') || []).find((s) => String(s.id) === String(row.entity_id))
          : null;
      const parent =
        parentById.get(String(row.parent_id)) ||
        parentById.get(String(student?.parentId)) ||
        (row.entity_type === 'parent' ? parentById.get(String(row.entity_id)) : null);
      if (!parent) continue;
      const key = `${parent.id}:${student?.id || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(
        candidate({ parent, student, reason: `נרשם ב-${day}`, sortKey: day })
      );
    }

    // Fallback for records created before status history existed.
    for (const student of db.get('students') || []) {
      if (student.status !== 'registered') continue;
      const created = isoDay(student.created_at || student.created);
      if (!created || created < since || created > today) continue;
      const parent = parentById.get(String(student.parentId));
      if (!parent) continue;
      const key = `${parent.id}:${student.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(candidate({ parent, student, reason: `נרשם ב-${created}`, sortKey: created }));
    }
    return out;
  }

  // PASS_ENDING
  const students = db.get('students') || [];
  const studentById = new Map(students.map((s) => [String(s.id), s]));
  const limit = addDaysIso(today, cfg.expiringWithinDays);
  for (const pass of db.get('customer_passes') || []) {
    if (!isPassUsable(pass, today)) continue;
    const lowVisits =
      pass.pass_type === PRODUCT_TYPES.PUNCH_CARD &&
      Number(pass.visits_remaining) <= cfg.visitsRemaining;
    const expiringSoon =
      !!pass.valid_until &&
      String(pass.valid_until) >= String(today) &&
      String(pass.valid_until) <= String(limit);
    if (!lowVisits && !expiringSoon) continue;

    const student = studentById.get(String(pass.student_id)) || null;
    const parent =
      parentById.get(String(pass.parent_id)) || parentById.get(String(student?.parentId)) || null;
    if (!parent) continue;
    const reason = lowVisits
      ? `נשארו ${Number(pass.visits_remaining) || 0} כניסות ב"${pass.name || 'כרטיסייה'}"`
      : `"${pass.name || 'מנוי'}" פג ב-${pass.valid_until}`;
    out.push(
      candidate({ parent, student, reason, sortKey: pass.valid_until || today })
    );
  }
  return out;
}

// ─── Guards ──────────────────────────────────────────────────────────────────

export const SKIP_REASONS = {
  NO_PHONE: 'אין מספר טלפון',
  NO_OPT_IN: 'הלקוח לא מאושר לדיוור',
  ALREADY_IN_CAMPAIGN: 'כבר נכנס לקמפיין הזה',
  COOLDOWN: 'קיבל דיוור שיווקי לאחרונה',
  ACTIVE_COUPON: 'כבר יש לו הטבה פעילה',
  ACTIVE_PASS: 'יש לו מנוי או כרטיסייה בתוקף',
  DAILY_CAP: 'נגמרה המכסה היומית',
};

function latestSendFor(sends, campaignId, parentId) {
  let latest = null;
  for (const row of sends) {
    if (String(row.campaign_id) !== String(campaignId)) continue;
    if (String(row.parent_id) !== String(parentId)) continue;
    if (row.status === SEND_STATUS.FAILED) continue;
    const day = row.date || isoDay(row.created_at);
    if (!day) continue;
    if (!latest || day > latest) latest = day;
  }
  return latest;
}

function lastMarketingTouch(sends, parentId, campaignId) {
  let latest = null;
  for (const row of sends) {
    if (String(row.parent_id) !== String(parentId)) continue;
    if (String(row.campaign_id) === String(campaignId)) continue;
    if (row.status !== SEND_STATUS.SENT && row.status !== SEND_STATUS.PENDING) continue;
    const day = row.date || isoDay(row.created_at);
    if (!day) continue;
    if (!latest || day > latest) latest = day;
  }
  return latest;
}

function hasUsablePass(db, { parentId, studentIds }, today) {
  const ids = new Set(studentIds.map(String));
  return (db.get('customer_passes') || []).some((pass) => {
    const mine =
      (pass.parent_id && String(pass.parent_id) === String(parentId)) ||
      ids.has(String(pass.student_id));
    return mine && isPassUsable(pass, today);
  });
}

/** Why this person is or is not getting the campaign today. */
export function screenCandidate(db, campaign, entry, ctx) {
  const { today, sends, kids } = ctx;
  if (!entry.phone) return { ok: false, reason: SKIP_REASONS.NO_PHONE };

  const parent = (db.get('parents') || []).find((p) => String(p.id) === String(entry.parentId));
  if (campaign.requires_opt_in && parent && parent.marketing_opt_in === false) {
    return { ok: false, reason: SKIP_REASONS.NO_OPT_IN };
  }

  const previous = latestSendFor(sends, campaign.id, entry.parentId);
  if (previous) {
    const since = daysBetween(previous, today);
    if (since == null || since < campaign.re_entry_days) {
      return { ok: false, reason: SKIP_REASONS.ALREADY_IN_CAMPAIGN };
    }
  }

  if (campaign.cooldown_days > 0) {
    const touched = lastMarketingTouch(sends, entry.parentId, campaign.id);
    if (touched) {
      const since = daysBetween(touched, today);
      if (since != null && since < campaign.cooldown_days) {
        return { ok: false, reason: SKIP_REASONS.COOLDOWN };
      }
    }
  }

  const studentIds = (kids.get(String(entry.parentId)) || []).map((s) => s.id);
  if (entry.studentId) studentIds.push(entry.studentId);

  if (campaign.skip_if_active_coupon) {
    const active = activeCouponsFor(db, { parentId: entry.parentId }, today);
    if (active.length) return { ok: false, reason: SKIP_REASONS.ACTIVE_COUPON };
  }

  if (campaign.skip_if_active_pass && hasUsablePass(db, { parentId: entry.parentId, studentIds }, today)) {
    return { ok: false, reason: SKIP_REASONS.ACTIVE_PASS };
  }

  return { ok: true };
}

// ─── Message text ────────────────────────────────────────────────────────────

export function fillCampaignMessage(text, vars = {}) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  );
}

export function campaignMessageVars({ entry, coupon, businessName = '' }) {
  return {
    name: entry?.studentName || entry?.parentName || '',
    parentName: entry?.parentName || '',
    business: businessName,
    coupon: coupon?.code || '',
    couponLabel: coupon?.label || '',
    expires: coupon?.expires_at
      ? new Date(`${coupon.expires_at}T12:00:00Z`).toLocaleDateString('he-IL')
      : 'ללא הגבלת זמן',
  };
}

// ─── Running ─────────────────────────────────────────────────────────────────

/**
 * Evaluate a campaign for one day.
 *
 * `dryRun` answers "who would this catch?" without writing anything, which is
 * the only safe way to switch on a rule that looks at the whole customer base.
 * `sendMessage` is injected so the decision logic can be tested without a
 * messaging channel.
 */
export async function runCampaign(
  db,
  rawCampaign,
  { today = todayIsoDate(), dryRun = false, sendMessage = null, businessName = '' } = {}
) {
  const campaign = normalizeCampaign(rawCampaign);
  const sends = db.get('campaign_sends') || [];
  const kids = familyIndex(db);
  const ctx = { today, sends, kids };

  const alreadyToday = sends.filter(
    (row) => String(row.campaign_id) === String(campaign.id) && row.date === today
  ).length;
  let budget = Math.max(0, campaign.daily_cap - alreadyToday);

  const all = findCandidates(db, campaign, { today }).sort((a, b) =>
    String(a.sortKey).localeCompare(String(b.sortKey))
  );

  const accepted = [];
  const skipped = [];
  for (const entry of all) {
    const verdict = screenCandidate(db, campaign, entry, ctx);
    if (!verdict.ok) {
      skipped.push({ ...entry, skipReason: verdict.reason });
      continue;
    }
    if (budget <= 0) {
      skipped.push({ ...entry, skipReason: SKIP_REASONS.DAILY_CAP });
      continue;
    }
    budget -= 1;
    accepted.push(entry);
  }

  const summary = {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    date: today,
    mode: campaign.mode,
    candidates: all.length,
    accepted: accepted.length,
    skipped: skipped.length,
    issued: 0,
    sent: 0,
    pending: 0,
    failed: 0,
    dry_run: !!dryRun,
    sample: accepted.slice(0, 20),
    skippedSample: skipped.slice(0, 20),
  };

  if (dryRun) return summary;

  for (const entry of accepted) {
    // In approval mode nothing reaches the customer and no coupon exists yet —
    // a rejected suggestion must not leave a benefit sitting in their file.
    if (campaign.mode === 'approval') {
      db.insert('campaign_sends', {
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        parent_id: entry.parentId,
        parent_name: entry.parentName,
        student_id: entry.studentId,
        student_name: entry.studentName,
        phone: entry.phone,
        reason: entry.reason,
        offer: campaign.offer,
        status: SEND_STATUS.PENDING,
        date: today,
        created_at: new Date().toISOString(),
      });
      summary.pending += 1;
      continue;
    }

    const result = await deliverCampaignEntry(db, campaign, entry, {
      today,
      sendMessage,
      businessName,
    });
    if (result.couponId) summary.issued += 1;
    if (result.status === SEND_STATUS.SENT) summary.sent += 1;
    else summary.failed += 1;
  }

  db.insert('campaign_runs', {
    campaign_id: campaign.id,
    date: today,
    candidates: summary.candidates,
    accepted: summary.accepted,
    skipped: summary.skipped,
    issued: summary.issued,
    sent: summary.sent,
    pending: summary.pending,
    failed: summary.failed,
    created_at: new Date().toISOString(),
  });

  return summary;
}

/** Issue the coupon, send the message, and record what happened. */
export async function deliverCampaignEntry(
  db,
  rawCampaign,
  entry,
  { today = todayIsoDate(), sendMessage = null, businessName = '', offer = null, decidedBy = '' } = {}
) {
  const campaign = normalizeCampaign(rawCampaign);
  const chosenOffer = offer || campaign.offer;

  let coupon = null;
  if (chosenOffer) {
    coupon = issueCoupon(db, {
      offer: chosenOffer,
      parentId: entry.parentId,
      studentId: entry.studentId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      source: 'campaign',
      today,
    });
  }

  const vars = campaignMessageVars({ entry, coupon, businessName });
  let status = SEND_STATUS.SENT;
  let error = '';

  if (sendMessage) {
    try {
      const result = await sendMessage({
        phone: entry.phone,
        parentId: entry.parentId,
        text: fillCampaignMessage(campaign.message.text, vars),
        templateName: campaign.message.templateName,
        templateVars: (campaign.message.templateVarKeys || []).map((key) => String(vars[key] ?? '')),
        preferTemplate: campaign.message.preferTemplate,
        language: campaign.message.language,
      });
      if (result && result.sent === false) {
        status = SEND_STATUS.FAILED;
        error = result.reason || 'שליחה נכשלה';
      }
    } catch (err) {
      status = SEND_STATUS.FAILED;
      error = err?.message || 'שליחה נכשלה';
    }
  }

  const record = db.insert('campaign_sends', {
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    parent_id: entry.parentId,
    parent_name: entry.parentName,
    student_id: entry.studentId,
    student_name: entry.studentName,
    phone: entry.phone,
    reason: entry.reason,
    offer: chosenOffer,
    coupon_id: coupon?.id || null,
    coupon_code: coupon?.code || null,
    status,
    error,
    date: today,
    sent_at: status === SEND_STATUS.SENT ? new Date().toISOString() : null,
    decided_by: decidedBy || '',
    created_at: new Date().toISOString(),
  });

  return { status, error, couponId: coupon?.id || null, coupon, send: record };
}

/**
 * Nudge people holding a coupon that is about to run out. Costs nothing and is
 * usually worth more than the original message.
 */
export async function runCouponReminders(
  db,
  rawCampaign,
  { today = todayIsoDate(), sendMessage = null, businessName = '' } = {}
) {
  const campaign = normalizeCampaign(rawCampaign);
  if (!campaign.reminder_days_before) return { reminded: 0 };
  const parents = db.get('parents') || [];
  let reminded = 0;

  for (const coupon of db.get('customer_coupons') || []) {
    if (String(coupon.campaign_id || '') !== String(campaign.id)) continue;
    if (couponState(coupon, today) !== COUPON_STATUS.ACTIVE) continue;
    if (coupon.reminder_sent_at) continue;
    const left = daysBetween(today, coupon.expires_at);
    if (left == null || left > campaign.reminder_days_before || left < 0) continue;

    const parent = parents.find((p) => String(p.id) === String(coupon.parent_id));
    if (!parent?.phone) continue;

    const entry = {
      parentId: parent.id,
      parentName: parent.name || '',
      phone: parent.phone,
      studentName: '',
    };
    const vars = campaignMessageVars({ entry, coupon, businessName });
    const text = fillCampaignMessage(
      `שלום {{parentName}}, רק תזכורת — ההטבה שלכם ({{couponLabel}}) בתוקף עד {{expires}}.\nקוד: {{coupon}}\nנשמח לראות אתכם 🧗`,
      vars
    );

    if (sendMessage) {
      try {
        await sendMessage({
          phone: parent.phone,
          parentId: parent.id,
          text,
          templateName: campaign.message.templateName,
          templateVars: (campaign.message.templateVarKeys || []).map((k) => String(vars[k] ?? '')),
          preferTemplate: campaign.message.preferTemplate,
          language: campaign.message.language,
        });
      } catch {
        continue;
      }
    }
    db.update('customer_coupons', coupon.id, { reminder_sent_at: new Date().toISOString() });
    reminded += 1;
  }
  return { reminded };
}

/** The daily pass over every switched-on campaign. */
export async function runDueCampaigns(
  db,
  { today = todayIsoDate(), sendMessage = null, businessName = '' } = {}
) {
  const results = [];
  for (const raw of db.get('campaigns') || []) {
    if (!raw.is_active) continue;
    // A campaign never reaches back before the day it was switched on.
    if (raw.start_date && String(raw.start_date) > String(today)) continue;
    const summary = await runCampaign(db, raw, { today, sendMessage, businessName });
    const reminders = await runCouponReminders(db, raw, { today, sendMessage, businessName });
    results.push({ ...summary, reminded: reminders.reminded });
  }
  return results;
}

/** Suggested starting points, so the screen is never an empty form. */
export function campaignPresets() {
  return [
    {
      name: 'חימום לקוח שנעלם',
      trigger_type: TRIGGER_TYPES.INACTIVE_CUSTOMER,
      trigger_config: { inactiveDays: 60, maxInactiveDays: 365 },
      offer: {
        type: OFFER_TYPES.PERCENT,
        value: 50,
        appliesTo: 'all',
        units: 1,
        validityDays: 30,
        label: '50% הנחה על כניסה לקיר',
      },
      message: {
        text:
          'שלום {{parentName}}, מזמן לא ראינו אתכם על הקיר!\n' +
          'שמרנו לכם {{couponLabel}} — קוד {{coupon}}, בתוקף עד {{expires}}.\n' +
          'פשוט תגידו את הקוד בדלפק 🧗',
      },
      mode: 'approval',
      daily_cap: 20,
      cooldown_days: 14,
    },
    {
      name: 'ליד שלא סגר',
      trigger_type: TRIGGER_TYPES.STALE_LEAD,
      trigger_config: { leadMinDays: 7, leadMaxDays: 60 },
      offer: {
        type: OFFER_TYPES.FREE_ITEM,
        appliesTo: 'all',
        units: 1,
        validityDays: 21,
        label: 'כניסה ראשונה חינם',
      },
      message: {
        text:
          'שלום {{parentName}}, פנינו אליכם בעבר ולא סגרנו.\n' +
          'שמרנו לכם {{couponLabel}} — קוד {{coupon}}, בתוקף עד {{expires}}.\n' +
          'בואו לנסות, בלי התחייבות 🙂',
      },
      mode: 'approval',
      daily_cap: 15,
      cooldown_days: 21,
    },
    {
      name: 'ברוכים הבאים',
      trigger_type: TRIGGER_TYPES.NEW_SIGNUP,
      trigger_config: { signupWithinDays: 3 },
      offer: {
        type: OFFER_TYPES.BOGO,
        appliesTo: 'all',
        units: 1,
        validityDays: 45,
        label: 'אחד פלוס אחד על כניסה — הביאו חבר',
      },
      message: {
        text:
          'ברוכים הבאים {{parentName}}! שמחים שהצטרפתם.\n' +
          'מתנת הצטרפות: {{couponLabel}} — קוד {{coupon}}, בתוקף עד {{expires}}.',
      },
      mode: 'approval',
      daily_cap: 30,
      cooldown_days: 0,
      skip_if_active_pass: false,
    },
    {
      name: 'חידוש כרטיסייה',
      trigger_type: TRIGGER_TYPES.PASS_ENDING,
      trigger_config: { visitsRemaining: 2, expiringWithinDays: 14 },
      offer: {
        type: OFFER_TYPES.AMOUNT,
        value: 30,
        appliesTo: 'all',
        validityDays: 30,
        label: '₪30 הנחה על חידוש כרטיסייה',
      },
      message: {
        text:
          'שלום {{parentName}}, הכרטיסייה שלכם עומדת להיגמר.\n' +
          'לחידוש בתקופה הקרובה שמרנו {{couponLabel}} — קוד {{coupon}}, עד {{expires}}.',
      },
      mode: 'approval',
      daily_cap: 25,
      cooldown_days: 7,
    },
  ];
}
