/**
 * משימות דיוור — מהלחיצה על «שלח» ועד דוח התוצאות.
 *
 * A job is created in `countdown` (a 30-second undo window) or `scheduled`,
 * and a background runner picks it up when due. The runner re-reads the job
 * row between recipients, so pause/stop take effect mid-send. Every job row
 * doubles as the audit record: who sent, to which audience, which template,
 * how many were suppressed and why.
 *
 * Enforcement lives here and in buildBroadcastPlan — never only in the UI.
 */

import { db } from '../db.js';
import { supa } from '../supa.js';
import { whatsappService } from '../whatsapp.js';
import { canSendFreeform } from './sessionWindow.js';
import { REASON_META } from './broadcastSuppression.js';
import { resolveTemplateVariableValues } from './templateVarFields.js';
import { appendMailingPreferencesFooter } from '../mailingPreferences.js';
import { shortMailingPreferencesUrl } from '../mailingShortLinks.js';
import {
  buildBroadcastPlan,
  findLocalTemplate,
  getBroadcastDefaults,
  renderMessageForRecipient,
} from './broadcastPlan.js';
import { quietStatus, nextAllowedTime } from './quietHours.js';
import { phoneBucket } from './broadcastSuppression.js';

const UNDO_SECONDS = 30;
const SEND_SPACING_MS = 150;
const TICK_MS = 2000;

/** Jobs a loop in this process is actively sending right now. */
const activeJobs = new Set();
let runnerTimer = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobRow(jobId) {
  return (db.get('broadcast_jobs') || []).find((j) => j.id === jobId) || null;
}

function pendingRecipients(jobId) {
  return (db.get('broadcast_recipients') || []).filter(
    (r) => r.job_id === jobId && r.status === 'pending'
  );
}

/**
 * Create a job. Throws a plain Error for user mistakes; throws an object with
 * `.quiet` when the only problem is quiet hours, so the route can offer the
 * next allowed slot instead of a dead end.
 */
export function createBroadcastJob(input = {}, { user = null } = {}) {
  const filters = input.filters || {};
  const templateId = input.templateId || input.templateName || null;
  const customMessage = input.customMessage || input.message || '';
  const listName = input.listName || filters.listKey || 'segment';

  if (!templateId && !customMessage) {
    throw new Error('יש לבחור תבנית או הודעה');
  }
  // תבנית שלא קיימת אסור שתהפוך בשקט להודעת טקסט עם "[תבנית: X]" בגוף.
  const template = templateId ? findLocalTemplate(templateId) : null;
  if (templateId && !template) {
    throw new Error(`התבנית «${templateId}» לא נמצאה במערכת — סנכרנו תבניות מ-Meta ונסו שוב`);
  }

  const plan = buildBroadcastPlan({
    filters,
    templateId,
    customMessage,
    listKey: filters.listKey || '',
    overrides: Array.isArray(input.overrides) ? input.overrides : [],
    recencyDays: input.recencyDays,
    capHours: input.capHours,
    sampleLimit: 0,
  });

  if (plan.compliance.blockers.length) {
    throw new Error(plan.compliance.blockers[0]);
  }

  let eligible = plan.eligible;

  // Split-to-quota / resend flows pin the job to an explicit phone list.
  const allowlist = Array.isArray(input.phoneAllowlist) && input.phoneAllowlist.length
    ? new Set(input.phoneAllowlist.map((p) => phoneBucket(p)))
    : null;
  if (allowlist) {
    eligible = eligible.filter((r) => allowlist.has(phoneBucket(r.phone)));
  }

  if (!eligible.length) {
    throw new Error('אין נמענים זכאים לשליחה אחרי שכבת החסימות');
  }

  const now = Date.now();
  const defaults = getBroadcastDefaults();

  let scheduledAt = null;
  if (input.scheduledAt) {
    const ts = new Date(input.scheduledAt).getTime();
    if (!Number.isFinite(ts)) throw new Error('מועד התזמון לא תקין');
    if (ts <= now) throw new Error('מועד התזמון כבר עבר');
    const atScheduled = quietStatus(new Date(ts), defaults.quiet);
    if (atScheduled.quiet) {
      const err = new Error(`המועד שנבחר הוא בשעות שקטות (${atScheduled.reason})`);
      err.quiet = atScheduled;
      throw err;
    }
    scheduledAt = new Date(ts).toISOString();
  } else {
    const quietNow = quietStatus(new Date(now), defaults.quiet);
    if (quietNow.quiet && !input.allowQuiet) {
      const err = new Error(`עכשיו שעות שקטות (${quietNow.reason}) — אפשר לתזמן במקום`);
      err.quiet = quietNow;
      throw err;
    }
  }

  // עלות ההערכה מחושבת על הזכאים שבאמת ייכנסו למשימה (רלוונטי לשליחה חוזרת).
  const costEstimate = {
    ...plan.cost,
    total: Math.round((plan.cost.perMessage || 0) * eligible.length * 100) / 100,
  };

  const job = db.insert('broadcast_jobs', {
    // סיומת אקראית: שתי משימות באותה מילישנייה לא יחלקו מזהה.
    id: `bj_${now}_${Math.random().toString(36).slice(2, 6)}`,
    campaign_name: input.campaignName || `דיוור ${new Date(now).toLocaleDateString('he-IL')}`,
    list_name: listName,
    template_name: template ? (template.meta_name || template.name) : (templateId || 'הודעה אישית'),
    template_display: template?.name || (templateId ? String(templateId) : 'הודעה חופשית'),
    template_category: plan.template?.category || (templateId ? 'UTILITY' : 'SERVICE'),
    is_template: !!template,
    message_text: customMessage || `[תבנית: ${template?.name || templateId}]`,
    filters,
    overrides: Array.isArray(input.overrides) ? input.overrides : [],
    audience_count: plan.audience.count,
    child_count: plan.audience.childCount,
    recipient_count: eligible.length,
    suppressed_count: plan.suppressedCount,
    suppressed_summary: plan.summary,
    // Names and reasons, capped — the panel already showed the full list live.
    suppressed_detail: plan.suppressed.slice(0, 400).map((s) => ({
      phone: s.phone,
      name: s.name,
      reasons: s.reasons.map((r) => r.code),
    })),
    cost_estimate: costEstimate,
    is_marketing: plan.isMarketing,
    recency_days: plan.settings.recencyDays,
    cap_hours: plan.settings.capHours,
    sent_count: 0,
    failed_count: 0,
    status: scheduledAt ? 'scheduled' : 'countdown',
    scheduled_at: scheduledAt,
    undo_until: scheduledAt ? null : new Date(now + UNDO_SECONDS * 1000).toISOString(),
    created_by: user ? { name: user.name || '', email: user.email || '' } : null,
    parent_job_id: input.parentJobId || null,
  });

  // Legacy campaign history row (older screens read this table).
  db.insert('broadcast_campaigns', {
    id: job.id,
    campaign_name: job.campaign_name,
    list_name: listName,
    template_name: job.template_name,
    message_text: job.message_text,
    recipient_count: eligible.length,
    status: job.status,
  });

  for (const r of eligible) {
    db.insert('broadcast_recipients', {
      id: `br_${job.id}_${phoneBucket(r.phone)}`,
      job_id: job.id,
      parent_id: r.parentId || r.id,
      phone: r.phone,
      name: r.name,
      student_names: r.studentName || '',
      // הילד שהסינון תפס — כדי שהמשתנים בהודעה ימולאו מהילד שהוצג בתצוגה
      // המקדימה, ולא מהילד הראשון בטבלה.
      student_id: r.students?.[0]?.id || null,
      overridden: !!r.overridden,
      status: 'pending',
    });
  }

  return { job, eligibleCount: eligible.length, undoSeconds: scheduledAt ? 0 : UNDO_SECONDS };
}

/** Backwards-compatible entry the old route used; now creates and returns fast. */
export async function startBroadcastJob(input = {}, context = {}) {
  const { job, eligibleCount, undoSeconds } = createBroadcastJob(input, context);
  return {
    success: true,
    jobId: job.id,
    status: job.status,
    recipientCount: eligibleCount,
    undoSeconds,
    scheduledAt: job.scheduled_at || null,
  };
}

async function sendToRecipient(job, recipient, { template }) {
  const parents = db.get('parents') || [];
  const parent = parents.find((p) => p.id === recipient.parent_id) || null;
  if (template) {
    const students = db.get('students') || [];
    // קודם הילד שהסינון תפס (נשמר על שורת הנמען); רק באין כזה — ילד כלשהו.
    const student = (recipient.student_id
      && students.find((s) => s.id === recipient.student_id))
      || (parent
        ? students.find((s) => s.parentId === parent.id || s.parent_id === parent.id)
        : null)
      || null;
    const preferenceUrl = shortMailingPreferencesUrl(parent || {
      id: recipient.parent_id,
      phone: recipient.phone,
    });
    const preferenceOverrides = Array.isArray(template.variables)
      ? template.variables.map((variable) => (
        variable && typeof variable === 'object' && variable.field === 'mailing_preferences'
          ? preferenceUrl
          : null
      ))
      : [];
    const variables = resolveTemplateVariableValues(template, parent, student, preferenceOverrides);
    return whatsappService.sendTemplateMessage(
      recipient.phone,
      template.meta_name || template.name,
      variables,
      { parentId: recipient.parent_id, fallbackName: recipient.name || '', source: 'broadcast' }
    );
  }

  // החלון שייך למספר, לא לכרטיס: כרטיס כפול של אותו טלפון עשוי להחזיק את
  // ה-last_inbound — בדיוק כמו שהקהל נבנה.
  const siblingCards = parents.filter((p) => phoneBucket(p.phone) === phoneBucket(recipient.phone));
  const windowOpen = (siblingCards.length ? siblingCards : (parent ? [parent] : []))
    .some((card) => canSendFreeform(card, 'whatsapp'));
  if (!windowOpen) {
    return { success: false, error: 'חלון 24 שעות סגור' };
  }
  const footerOwner = parent || { id: recipient.parent_id, phone: recipient.phone };
  const message = appendMailingPreferencesFooter(job.message_text, footerOwner, {
    url: shortMailingPreferencesUrl(footerOwner),
  });
  return whatsappService.sendTextMessage(recipient.phone, message, false, {
    parentId: recipient.parent_id,
    source: 'broadcast',
    clip: false,
  });
}

function finalizeJob(jobId, status) {
  const rows = (db.get('broadcast_recipients') || []).filter((r) => r.job_id === jobId);
  const sent = rows.filter((r) => r.status === 'sent').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const cancelled = rows.filter((r) => r.status === 'cancelled').length;
  const notes = status === 'completed'
    ? `נשלח ל-${sent} מתוך ${sent + failed}`
    : `נעצר: נשלחו ${sent}, נכשלו ${failed}, בוטלו ${cancelled}`;
  db.update('broadcast_jobs', jobId, {
    status,
    sent_count: sent,
    failed_count: failed,
    cancelled_count: cancelled,
    finished_at: new Date().toISOString(),
    notes,
  });
  db.update('broadcast_campaigns', jobId, { status, notes, recipient_count: sent + failed });
}

/**
 * Live blocks at send time. The plan ran when the job was created — possibly
 * yesterday for a scheduled job — and an opt-out that arrived since is the
 * customer's word, so it is honoured here as well, per recipient.
 * Data sources are injectable so the guarantee can be unit-tested.
 */
export function liveBlockReason(job, recipient, {
  parents = db.get('parents') || [],
  listRows = db.get('broadcast_lists') || [],
} = {}) {
  const bucket = phoneBucket(recipient.phone);
  const cards = parents.filter((p) => phoneBucket(p.phone) === bucket);
  if (job.is_marketing && cards.some((card) => card.marketing_opt_in === false)) {
    return REASON_META.opted_out.label;
  }
  const listKey = job.filters?.listKey;
  if (listKey) {
    const cardIds = new Set(cards.map((card) => card.id));
    const unsubscribed = listRows.some(
      (row) => row.listName === listKey && cardIds.has(row.parentId) && row.subscribed === false
    );
    if (unsubscribed) return REASON_META.list_unsubscribed.label;
  }
  return '';
}

async function processJob(jobId) {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);
  try {
    const job = jobRow(jobId);
    if (!job) return;
    const template = job.is_template ? findLocalTemplate(job.template_name) : null;
    if (job.is_template && !template) {
      for (const left of pendingRecipients(jobId)) {
        db.update('broadcast_recipients', left.id, { status: 'failed', error: 'התבנית נמחקה מהמערכת' });
      }
      finalizeJob(jobId, 'completed');
      return;
    }
    const isTemplateSend = !!template;

    for (const recipient of pendingRecipients(jobId)) {
      const current = jobRow(jobId);
      if (!current || current.status === 'paused') return;
      if (current.status === 'stopping' || current.status === 'stopped' || current.status === 'cancelled') {
        for (const left of pendingRecipients(jobId)) {
          db.update('broadcast_recipients', left.id, { status: 'cancelled' });
        }
        finalizeJob(jobId, 'stopped');
        return;
      }

      const blocked = liveBlockReason(current, recipient);
      if (blocked) {
        db.update('broadcast_recipients', recipient.id, {
          status: 'cancelled',
          error: blocked,
        });
        continue;
      }

      try {
        const result = await sendToRecipient(current, recipient, {
          template: isTemplateSend ? template : null,
        });
        if (!result.success) throw new Error(result.error || 'שליחה נכשלה');
        db.update('broadcast_recipients', recipient.id, {
          status: 'sent',
          sent_at: new Date().toISOString(),
          meta_message_id: result.messageId || null,
        });
        db.update('broadcast_jobs', jobId, {
          sent_count: (jobRow(jobId)?.sent_count || 0) + 1,
        });
      } catch (err) {
        db.update('broadcast_recipients', recipient.id, {
          status: 'failed',
          error: err.message,
        });
        db.update('broadcast_jobs', jobId, {
          failed_count: (jobRow(jobId)?.failed_count || 0) + 1,
        });
      }
      await sleep(SEND_SPACING_MS);
    }

    finalizeJob(jobId, 'completed');
  } finally {
    activeJobs.delete(jobId);
  }
}

/** One runner beat: promote due jobs and (re)attach to sending ones. */
export async function broadcastRunnerTick(now = Date.now()) {
  const defaults = getBroadcastDefaults();
  const jobs = db.get('broadcast_jobs') || [];

  for (const job of jobs) {
    if (job.status === 'countdown') {
      const due = new Date(job.undo_until || 0).getTime();
      if (Number.isFinite(due) && now >= due) {
        db.update('broadcast_jobs', job.id, { status: 'sending', started_at: new Date(now).toISOString() });
        db.update('broadcast_campaigns', job.id, { status: 'sending' });
      }
    } else if (job.status === 'scheduled') {
      const due = new Date(job.scheduled_at || 0).getTime();
      if (Number.isFinite(due) && now >= due) {
        const quiet = quietStatus(new Date(now), defaults.quiet);
        if (quiet.quiet) {
          // A schedule that drifted into quiet hours moves itself forward.
          const next = nextAllowedTime(new Date(now), defaults.quiet).toISOString();
          db.update('broadcast_jobs', job.id, {
            scheduled_at: next,
            notes: `נדחה אוטומטית בגלל שעות שקטות (${quiet.reason})`,
          });
        } else {
          db.update('broadcast_jobs', job.id, { status: 'sending', started_at: new Date(now).toISOString() });
          db.update('broadcast_campaigns', job.id, { status: 'sending' });
        }
      }
    }
  }

  for (const job of db.get('broadcast_jobs') || []) {
    // 'stopping' is included: a cancel that lands between resume and the next
    // tick has no live loop to observe it, and would otherwise hang forever.
    // processJob handles it by cancelling the pendings and finalizing.
    if ((job.status === 'sending' || job.status === 'stopping') && !activeJobs.has(job.id)) {
      // Deliberately not awaited — the tick must stay fast.
      processJob(job.id).catch((err) =>
        console.error(`broadcast job ${job.id} failed:`, err.message));
    }
  }
}

/** A restart mid-send leaves the job paused, never silently half-finished. */
export function recoverInterruptedBroadcasts() {
  for (const job of db.get('broadcast_jobs') || []) {
    if (job.status === 'sending') {
      db.update('broadcast_jobs', job.id, {
        status: 'paused',
        notes: 'השרת הופעל מחדש באמצע השליחה — אפשר להמשיך מהמסך',
      });
    } else if (job.status === 'stopping') {
      // The user asked to stop before the restart; a stopped job must not
      // come back resumable.
      for (const r of pendingRecipients(job.id)) {
        db.update('broadcast_recipients', r.id, { status: 'cancelled' });
      }
      finalizeJob(job.id, 'stopped');
    }
  }
}

/**
 * חד-פעמי: משימות דיוור ישנות ישבו בטבלאות SQL ייעודיות עם עמודות קבועות,
 * שאינן יכולות להחזיק את שדות המשימה החדשים (תזמון, חסימות, ביטול). הצינור
 * החדש שומר אותן ב-kv_collections; השורות הישנות מועתקות לשם פעם אחת, כדי
 * שההיסטוריה לא תיעלם מהמסך.
 */
async function migrateLegacyBroadcastRows() {
  if (!supa.isEnabled()) return;
  try {
    const marker = await supa.getAppSetting('broadcast_jobs_kv_migrated');
    if (marker) return;
    for (const table of ['broadcast_jobs', 'broadcast_recipients']) {
      const legacy = await supa.readDirectTableRaw(table);
      if (!Array.isArray(legacy)) return; // read failed — retry next boot
      const existing = new Set((db.get(table) || []).map((row) => String(row.id)));
      let moved = 0;
      for (const row of legacy) {
        if (!row?.id || existing.has(String(row.id))) continue;
        db.mergeLocal(table, [row]);
        const result = await supa.upsert(table, row);
        if (result?.ok === false) return; // leave marker unset — retry next boot
        moved += 1;
      }
      if (moved) console.log(`📦 Broadcast history: migrated ${moved} legacy ${table} row(s) to kv`);
    }
    await supa.setAppSetting('broadcast_jobs_kv_migrated', true);
  } catch (err) {
    console.error('legacy broadcast migration failed:', err.message);
  }
}

export function startBroadcastRunner() {
  if (runnerTimer) return runnerTimer;
  recoverInterruptedBroadcasts();
  migrateLegacyBroadcastRows().catch((err) =>
    console.error('legacy broadcast migration failed:', err.message));
  runnerTimer = setInterval(() => {
    broadcastRunnerTick().catch((err) => console.error('broadcast runner tick failed:', err.message));
  }, TICK_MS);
  if (runnerTimer.unref) runnerTimer.unref();
  return runnerTimer;
}

export function stopBroadcastRunner() {
  if (!runnerTimer) return;
  clearInterval(runnerTimer);
  runnerTimer = null;
}

export function cancelBroadcastJob(jobId) {
  const job = jobRow(jobId);
  if (!job) return { error: 'המשימה לא נמצאה', status: 404 };
  if (job.status === 'countdown' || job.status === 'scheduled') {
    for (const r of pendingRecipients(jobId)) {
      db.update('broadcast_recipients', r.id, { status: 'cancelled' });
    }
    db.update('broadcast_jobs', jobId, {
      status: 'cancelled',
      finished_at: new Date().toISOString(),
      notes: 'בוטל לפני תחילת השליחה',
    });
    db.update('broadcast_campaigns', jobId, { status: 'cancelled', notes: 'בוטל לפני תחילת השליחה' });
    return { success: true, status: 'cancelled', sentBeforeCancel: 0 };
  }
  if (job.status === 'sending') {
    db.update('broadcast_jobs', jobId, { status: 'stopping' });
    return { success: true, status: 'stopping', sentBeforeCancel: job.sent_count || 0 };
  }
  if (job.status === 'paused') {
    for (const r of pendingRecipients(jobId)) {
      db.update('broadcast_recipients', r.id, { status: 'cancelled' });
    }
    finalizeJob(jobId, 'stopped');
    return { success: true, status: 'stopped', sentBeforeCancel: job.sent_count || 0 };
  }
  return { error: `אי אפשר לבטל משימה במצב ${job.status}`, status: 409 };
}

export function pauseBroadcastJob(jobId) {
  const job = jobRow(jobId);
  if (!job) return { error: 'המשימה לא נמצאה', status: 404 };
  if (job.status !== 'sending') return { error: 'המשימה אינה בשליחה כרגע', status: 409 };
  db.update('broadcast_jobs', jobId, { status: 'paused', paused_at: new Date().toISOString() });
  return { success: true, status: 'paused' };
}

export function resumeBroadcastJob(jobId) {
  const job = jobRow(jobId);
  if (!job) return { error: 'המשימה לא נמצאה', status: 404 };
  if (job.status !== 'paused') return { error: 'המשימה אינה מושהית', status: 409 };
  db.update('broadcast_jobs', jobId, { status: 'sending' });
  return { success: true, status: 'sending' };
}

/**
 * Job report with live delivery data: the webhook updates message rows by
 * Meta id, so delivered/read are read from the journal at request time.
 */
export function getBroadcastJob(jobId) {
  const job = jobRow(jobId);
  if (!job) return null;
  const logsByMetaId = new Map(
    (db.get('whatsapp_logs') || [])
      .filter((l) => l.meta_message_id)
      .map((l) => [l.meta_message_id, l])
  );
  const recipients = (db.get('broadcast_recipients') || [])
    .filter((r) => r.job_id === jobId)
    .map((r) => {
      const log = r.meta_message_id ? logsByMetaId.get(r.meta_message_id) : null;
      const delivery = log?.status && ['delivered', 'read'].includes(log.status) ? log.status : null;
      return { ...r, delivery_status: delivery || (r.status === 'sent' ? 'sent' : r.status) };
    });

  const stats = { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, cancelled: 0 };
  const failureReasons = {};
  for (const r of recipients) {
    if (r.status === 'failed') {
      stats.failed += 1;
      const key = String(r.error || 'שגיאה לא ידועה');
      failureReasons[key] = (failureReasons[key] || 0) + 1;
    } else if (r.status === 'cancelled') stats.cancelled += 1;
    else if (r.status === 'pending') stats.pending += 1;
    else if (r.delivery_status === 'read') stats.read += 1;
    else if (r.delivery_status === 'delivered') stats.delivered += 1;
    else stats.sent += 1;
  }

  return { ...job, recipients, stats, failureReasons };
}

export function listBroadcastJobs() {
  return [...(db.get('broadcast_jobs') || [])].sort(
    (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
}

/** דיוור חוזר לנכשלים בלבד — משימה חדשה שמוגבלת למספרים שנכשלו. */
export function resendFailedRecipients(jobId, { user = null } = {}) {
  const job = jobRow(jobId);
  if (!job) throw new Error('המשימה לא נמצאה');
  const failed = (db.get('broadcast_recipients') || []).filter(
    (r) => r.job_id === jobId && r.status === 'failed'
  );
  if (!failed.length) throw new Error('אין נמענים שנכשלו במשימה הזאת');
  // משימות ותיקות (לפני השדרוג) לא נושאות is_template — מסיקים מהתבנית עצמה.
  const isTemplate = job.is_template !== undefined
    ? !!job.is_template
    : !!findLocalTemplate(job.template_name);
  return createBroadcastJob({
    campaignName: `${job.campaign_name} — שליחה חוזרת לנכשלים`,
    listName: job.list_name,
    templateId: isTemplate ? job.template_name : null,
    customMessage: isTemplate ? '' : job.message_text,
    filters: job.filters || {},
    // אותם כללים ואותן עקיפות מהמשימה המקורית — אחרת נמען שאושר במודע
    // בשליחה הראשונה נחסם בשקט בשליחה החוזרת.
    overrides: Array.isArray(job.overrides) ? job.overrides : [],
    recencyDays: job.recency_days,
    capHours: job.cap_hours,
    phoneAllowlist: failed.map((r) => r.phone),
    parentJobId: job.id,
  }, { user });
}

/** שליחת בדיקה — ההודעה האמיתית, עם נתוני נמען אמיתי, למספר שבחרת. */
export async function sendBroadcastTest({
  phone,
  templateId = null,
  customMessage = '',
  sampleParentId = null,
} = {}) {
  const target = String(phone || '').trim();
  if (!target) throw new Error('חסר מספר לשליחת הבדיקה');
  const template = findLocalTemplate(templateId);
  if (!template && !String(customMessage || '').trim()) {
    throw new Error('אין תבנית או הודעה לבדיקה');
  }

  const parent = sampleParentId
    ? (db.get('parents') || []).find((p) => p.id === sampleParentId) || null
    : null;
  const student = parent
    ? (db.get('students') || []).find((s) => s.parentId === parent.id) || null
    : null;

  if (template) {
    const preferenceUrl = parent ? shortMailingPreferencesUrl(parent) : '';
    const overrides = Array.isArray(template.variables)
      ? template.variables.map((v) => (
        v && typeof v === 'object' && v.field === 'mailing_preferences' ? preferenceUrl : null
      ))
      : [];
    const variables = resolveTemplateVariableValues(template, parent, student, overrides);
    const result = await whatsappService.sendTemplateMessage(
      target,
      template.meta_name || template.name,
      variables,
      { fallbackName: parent?.name || 'בדיקה', source: 'broadcast_test' }
    );
    if (!result.success) throw new Error(result.error || 'שליחת הבדיקה נכשלה');
    return { success: true, mock: !!result.mock, message: result.message || '' };
  }

  const rendered = renderMessageForRecipient({
    template: null,
    customMessage,
    recipient: { parentId: parent?.id, phone: target },
    parent,
    student,
  });
  const result = await whatsappService.sendTextMessage(target, rendered.body, false, {
    source: 'broadcast_test',
    clip: false,
  });
  if (!result.success) {
    throw new Error(`${result.error || 'שליחת הבדיקה נכשלה'} — הודעה חופשית עוברת רק אם למספר הבדיקה יש חלון 24 שעות פתוח`);
  }
  return { success: true, message: rendered.body };
}

/** ההיסטוריה הדיוורית של לקוח — לשימוש כרטיס הלקוח. */
export function parentBroadcastHistory(parentId) {
  const parent = (db.get('parents') || []).find((p) => p.id === parentId);
  if (!parent) return [];
  const bucket = phoneBucket(parent.phone);
  const jobsById = new Map((db.get('broadcast_jobs') || []).map((j) => [j.id, j]));
  return (db.get('broadcast_recipients') || [])
    .filter((r) => r.parent_id === parentId || (bucket && phoneBucket(r.phone) === bucket))
    .map((r) => {
      const job = jobsById.get(r.job_id);
      return {
        id: r.id,
        jobId: r.job_id,
        campaign: job?.campaign_name || '',
        template: job?.template_display || job?.template_name || '',
        status: r.status,
        error: r.error || '',
        sentAt: r.sent_at || job?.created_at || r.created_at,
      };
    })
    .sort((a, b) => new Date(b.sentAt || 0) - new Date(a.sentAt || 0));
}
