import { db } from './db.js';
import { whatsappService } from './whatsapp.js';
import { canSendFreeform } from './channels/sessionWindow.js';
import { phonesMatch } from './whatsappConnect.js';
import {
  dateToWeekday,
  getGroupDays,
  israelDateStr,
  israelHour,
} from './attendanceUtils.js';
import { studentGroupIds } from './studentGroups.js';
import { alertRecipients } from './staffAlerts.js';
import { persistCore } from './db.js';
import { recordBotAction } from './botActivityLog.js';
import {
  isOptedOut,
  isBotPaused,
  parentFirstName,
  withBotMark,
} from './whatsappBot.js';
import {
  FOLLOWUP_COLLECTION,
  dueFollowUps,
  followUpMessage,
} from './botFollowUps.js';
import { FOLLOWUP_TEMPLATE_NAME } from './scripts/createFollowUpTemplate.js';

/** A follow-up is answered once — sent, or handed to the team, or dropped. */
async function closeFollowUp(row, status) {
  const updated = db.update(FOLLOWUP_COLLECTION, row.id, {
    status,
    closed_at: new Date().toISOString(),
  });
  if (updated) await persistCore(FOLLOWUP_COLLECTION, updated);
}

/**
 * Where to come. Read from the business facts the owner edits, because a
 * hard-coded address survives a move: reminder messages were still sending
 * parents to the wall's previous address in another city.
 */
export function arrivalText(settings = null) {
  const s = settings || (db.getSettings ? db.getSettings() : {});
  const line = String(s?.aiBusinessFacts || '')
    .split('\n')
    .find((l) => /^\s*כתובת\s*:/.test(l));
  const address = line ? line.replace(/^\s*כתובת\s*:\s*/, '').trim() : '';
  return address ? `${address}. יש חניה בחזית.` : 'נשלח לכם את הכתובת המדויקת בהודעה נפרדת.';
}

/** Kept for callers that still read a constant; prefer `arrivalText()`. */
export const DEFAULT_ARRIVAL = 'יש חניה בחזית הקיר.';

export const INTRO_STATUSES = new Set(['intro_scheduled', 'intro_paid']);

const SCHEDULED_EVENTS = new Set([
  'intro_reminder_day_of',
  'intro_followup_day_after',
]);

function yesterdayIsraelDateStr(d = new Date()) {
  const today = israelDateStr(d);
  const noon = new Date(`${today}T12:00:00`);
  noon.setDate(noon.getDate() - 1);
  return israelDateStr(noon);
}

function resolvePhone(payload = {}) {
  if (payload.phone) return payload.phone;
  const parentId = payload.parentId || payload.parent_id;
  if (parentId) {
    const parent = db.getOne('parents', parentId);
    if (parent?.phone) return parent.phone;
  }
  return null;
}

function resolveParentName(payload = {}) {
  if (payload.parentName) return payload.parentName;
  const parentId = payload.parentId || payload.parent_id;
  if (parentId) {
    const parent = db.getOne('parents', parentId);
    if (parent?.name) return parent.name;
  }
  return '';
}

function buildPlaceholderMap(payload = {}) {
  return {
    name: payload.name || '',
    parentName: resolveParentName(payload),
    time: payload.time || '',
    trainer: payload.trainerName || payload.trainer || '',
    arrival: payload.arrival || arrivalText(),
    group: payload.groupName || '',
  };
}

export function fillMessageTemplate(message, payload = {}) {
  const map = buildPlaceholderMap(payload);
  return String(message || '').replace(/\{\{(\w+)\}\}/g, (_, key) =>
    map[key] != null ? String(map[key]) : ''
  );
}

function templateIsApproved(metaName) {
  const template = (db.get('message_templates') || []).find(
    (t) => (t.meta_name || t.name) === metaName
  );
  return String(template?.status || '').toUpperCase() === 'APPROVED';
}

/** Same person, allowing for the spacing people actually type. */
function sameHebrewName(a, b) {
  const clean = (value) => String(value || '').trim().replace(/\s+/g, ' ');
  return !!clean(a) && clean(a) === clean(b);
}

function templateVariableValues(payload, keys) {
  const map = buildPlaceholderMap(payload);
  const list = Array.isArray(keys) && keys.length ? keys : ['name'];
  return list.map((key) => String(map[key] ?? ''));
}

function matchesTriggerCondition(automation, payload = {}) {
  if (automation.trigger_event !== 'status_changed') return true;
  const condition = automation.trigger_condition;
  if (!condition) return true;
  const status = payload.new_status || payload.status;
  return status === condition;
}

function alreadySent(sendId) {
  const rows = db.get('automation_sends') || [];
  return rows.some((r) => r.id === sendId);
}

function markSent({ id, event, automationId, studentId, date, phone }) {
  if (alreadySent(id)) return;
  db.insert('automation_sends', {
    id,
    event,
    automation_id: automationId,
    student_id: studentId,
    date,
    phone: phone || '',
    sent_at: new Date().toISOString(),
  });
}

function trainerNameForGroup(group) {
  if (!group) return '';
  if (group.trainerName) return group.trainerName;
  const trainerId = group.trainer;
  if (!trainerId) return '';
  const employees = db.get('employees') || [];
  const emp = employees.find((e) => e.id === trainerId);
  return emp?.name || '';
}

export function buildIntroClassPayload(student, group, extras = {}) {
  const parent = student?.parentId ? db.getOne('parents', student.parentId) : null;
  return {
    name: student?.name || '',
    phone: parent?.phone || extras.phone || null,
    parentId: student?.parentId || null,
    parentName: parent?.name || '',
    studentId: student?.id || null,
    groupId: group?.id || student?.groupId || null,
    groupName: group?.name || '',
    time: group?.time || '',
    trainerName: trainerNameForGroup(group),
    arrival: extras.arrival || arrivalText(),
    date: extras.date || null,
    new_status: student?.status,
    status: student?.status,
  };
}

/** Intro students whose group meets on `date` (YYYY-MM-DD). */
export function findIntroReminderCandidates(date = israelDateStr()) {
  const weekday = dateToWeekday(date);
  const students = db.get('students') || [];
  const groups = db.get('groups') || [];
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const out = [];

  for (const student of students) {
    if (!INTRO_STATUSES.has(student.status)) continue;
    const gids = studentGroupIds(student);
    if (!gids.length) continue;
    for (const gid of gids) {
      const group = groupById.get(gid);
      if (!group || group.active === false) continue;
      if (!getGroupDays(group).includes(weekday)) continue;
      out.push({
        student,
        group,
        date,
        payload: buildIntroClassPayload(student, group, { date }),
      });
    }
  }
  return out;
}

/**
 * Day-after follow-up candidates: marked "הגיע" (attended) yesterday,
 * and the student status is still an intro class status.
 * Also accepts legacy intro_attended marks.
 */
export function findIntroFollowupCandidates(date = yesterdayIsraelDateStr()) {
  const attendance = db.get('attendance') || [];
  const students = db.get('students') || [];
  const groups = db.get('groups') || [];
  const studentById = new Map(students.map((s) => [s.id, s]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const out = [];
  const arrivedStatuses = new Set(['attended', 'intro_attended']);

  for (const row of attendance) {
    if (row.date !== date) continue;
    if (!arrivedStatuses.has(row.status)) continue;
    const student = studentById.get(row.student_id);
    if (!student) continue;
    if (!INTRO_STATUSES.has(student.status)) continue;
    const group = groupById.get(row.group_id) || groupById.get(student.groupId);
    out.push({
      student,
      group,
      attendance: row,
      date,
      payload: buildIntroClassPayload(student, group, { date }),
    });
  }
  return out;
}

/** Staff numbers as the owner wrote them in the bot settings. */


/** When this trainee entered the status they are sitting in now. */
function statusEnteredAt(student, status, store = db) {
  const rows = (store.get('lead_status_history') || []).filter(
    (r) => String(r.entity_id || '') === String(student.id) && r.to_status === status
  );
  const latest = rows
    .map((r) => Date.parse(r.changed_at || r.created_at || ''))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)[0];
  // No history row (a hold made before the trigger existed): fall back to the
  // record's own timestamp rather than pretending it just happened.
  return latest ?? Date.parse(student.updated_at || student.created_at || '') ?? null;
}

/**
 * Trainees held as "ממתין להרשמה" for longer than `days`.
 * @returns {{ student: object, daysWaiting: number }[]}
 */
export function findStalledSignups({ days = 5, today = israelDateStr(), store = db } = {}) {
  // Everything is measured against `today`, so the count a person reads is the
  // same one the test can assert.
  const todayMs = Date.parse(`${today}T00:00:00`);
  const cutoffMs = todayMs - days * 86400000;
  return (store.get('students') || [])
    .filter((s) => String(s.status || '') === 'pending_signup')
    .map((student) => {
      const enteredAt = statusEnteredAt(student, 'pending_signup', store);
      if (!Number.isFinite(enteredAt)) return null;
      if (enteredAt > cutoffMs) return null;
      return {
        student,
        daysWaiting: Math.max(1, Math.round((todayMs - enteredAt) / 86400000)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.daysWaiting - a.daysWaiting);
}

export const automationsService = {
  triggerEvent: async (eventName, payload) => {
    try {
      const automations = db.get('automations') || [];
      const activeAutomations = automations.filter(
        (a) => a.is_active && a.trigger_event === eventName && matchesTriggerCondition(a, payload)
      );

      for (const auto of activeAutomations) {
        console.log(`🤖 Automation triggered: "${auto.name}" for event "${eventName}"`);
        await automationsService.executeAction(auto, payload);
      }
    } catch (err) {
      console.error('Error triggering automation:', err);
    }
  },

  executeAction: async (automation, payload) => {
    try {
      if (automation.action_type !== 'send_whatsapp') return { sent: false, reason: 'unsupported_action' };

      const phone = resolvePhone(payload);
      if (!phone) {
        console.warn('Automation skipped: no phone number in payload');
        return { sent: false, reason: 'no_phone' };
      }

      const enriched = {
        ...payload,
        phone,
        parentName: resolveParentName(payload),
        arrival: payload.arrival || automation.action_payload?.arrivalText || arrivalText(),
      };

      const parents = db.get('parents') || [];
      const parent =
        parents.find((p) => phonesMatch(p.phone, phone)) ||
        (enriched.parentId ? db.getOne('parents', enriched.parentId) : null);

      const templateName =
        automation.action_payload?.templateName ||
        automation.action_payload?.template_id ||
        null;

      const windowOpen = parent ? canSendFreeform(parent, 'whatsapp') : false;
      const varKeys = automation.action_payload?.templateVarKeys;

      if (templateName && (!windowOpen || automation.action_payload?.preferTemplate)) {
        const vars = templateVariableValues(enriched, varKeys);
        // An adult who registered themselves is both the greeting and the
        // participant, so the stock wording said their name twice: "שלום דלק
        // איל, קיבלנו את הפרטים ואת הצהרת הבריאות של דלק איל". Where a
        // self-registration variant exists, it is the one that fits.
        const selfTemplate = automation.action_payload?.templateNameSelf;
        const registeredSelf = sameHebrewName(enriched.parentName, enriched.name);
        // Only once Meta has approved it. Wired ahead of approval, the variant
        // would turn every self-registration confirmation into a failed send —
        // worse than the wording it fixes.
        if (selfTemplate && registeredSelf && templateIsApproved(selfTemplate)) {
          const selfVars = templateVariableValues(
            enriched,
            automation.action_payload?.templateVarKeysSelf || ['parentName']
          );
          console.log(`🤖 Sending automated WhatsApp template "${selfTemplate}" to ${phone}`);
          await whatsappService.sendTemplateMessage(phone, selfTemplate, selfVars, {
            parentId: parent?.id || enriched.parentId,
            language: automation.action_payload?.language,
            source: 'automation',
          });
          return { sent: true, via: 'template' };
        }
        console.log(`🤖 Sending automated WhatsApp template "${templateName}" to ${phone}`);
        await whatsappService.sendTemplateMessage(phone, templateName, vars, {
          parentId: parent?.id || enriched.parentId,
          language: automation.action_payload?.language,
          // Without this the row is filed as staff, and the bot goes quiet for
          // two hours because it thinks a person took over the thread.
          source: 'automation',
        });
        return { sent: true, via: 'template' };
      }

      if (!windowOpen) {
        console.warn(
          `🤖 Automation skipped for ${phone}: 24h window closed and no template configured`
        );
        return { sent: false, reason: 'window_closed' };
      }

      const message = fillMessageTemplate(automation.action_payload?.message || '', enriched);
      if (!message.trim()) {
        console.warn('Automation skipped: empty message');
        return { sent: false, reason: 'empty_message' };
      }

      console.log(`🤖 Sending automated WhatsApp message to ${phone}`);
      await whatsappService.sendTextMessage(phone, message, true);
      return { sent: true, via: 'freeform' };
    } catch (err) {
      console.error('Error executing automation action:', err);
      return { sent: false, reason: err.message };
    }
  },

  /** Morning job: same-day intro reminders. */
  runIntroReminders: async (date = israelDateStr()) => {
    const automations = (db.get('automations') || []).filter(
      (a) => a.is_active && a.trigger_event === 'intro_reminder_day_of'
    );
    if (!automations.length) {
      return { event: 'intro_reminder_day_of', date, candidates: 0, sent: 0, skipped: 0 };
    }

    const candidates = findIntroReminderCandidates(date);
    let sent = 0;
    let skipped = 0;

    for (const item of candidates) {
      for (const auto of automations) {
        const sendId = `as-reminder-${auto.id}-${item.student.id}-${date}`;
        if (alreadySent(sendId)) {
          skipped += 1;
          continue;
        }
        const result = await automationsService.executeAction(auto, item.payload);
        if (result?.sent) {
          markSent({
            id: sendId,
            event: 'intro_reminder_day_of',
            automationId: auto.id,
            studentId: item.student.id,
            date,
            phone: item.payload.phone,
          });
          sent += 1;
        } else {
          skipped += 1;
        }
      }
    }

    console.log(
      `🤖 Intro reminders (${date}): candidates=${candidates.length} sent=${sent} skipped=${skipped}`
    );
    return {
      event: 'intro_reminder_day_of',
      date,
      candidates: candidates.length,
      sent,
      skipped,
    };
  },

  /** Morning job: day-after follow-up for intro students marked arrived. */
  runIntroFollowups: async (classDate = yesterdayIsraelDateStr()) => {
    const automations = (db.get('automations') || []).filter(
      (a) => a.is_active && a.trigger_event === 'intro_followup_day_after'
    );
    if (!automations.length) {
      return { event: 'intro_followup_day_after', date: classDate, candidates: 0, sent: 0, skipped: 0 };
    }

    const candidates = findIntroFollowupCandidates(classDate);
    let sent = 0;
    let skipped = 0;

    for (const item of candidates) {
      for (const auto of automations) {
        const sendId = `as-followup-${auto.id}-${item.student.id}-${classDate}`;
        if (alreadySent(sendId)) {
          skipped += 1;
          continue;
        }
        const result = await automationsService.executeAction(auto, item.payload);
        if (result?.sent) {
          markSent({
            id: sendId,
            event: 'intro_followup_day_after',
            automationId: auto.id,
            studentId: item.student.id,
            date: classDate,
            phone: item.payload.phone,
          });
          sent += 1;
        } else {
          skipped += 1;
        }
      }
    }

    console.log(
      `🤖 Intro followups (class ${classDate}): candidates=${candidates.length} sent=${sent} skipped=${skipped}`
    );
    return {
      event: 'intro_followup_day_after',
      date: classDate,
      candidates: candidates.length,
      sent,
      skipped,
    };
  },

  runScheduled: async () => {
    const reminder = await automationsService.runIntroReminders();
    const followup = await automationsService.runIntroFollowups();
    const stalled = await automationsService.runStalledSignupNotice();
    return { reminder, followup, stalled };
  },

  /**
   * The promises the bot made — "תבדוק איתי מחר", and the day-after check on a
   * placement — come due here.
   *
   * Meta only allows free text inside 24 hours of the customer's last message,
   * and a follow-up is by definition a day later. So a customer who has written
   * since gets the message; anyone else becomes a note to the team, because a
   * silent failure is exactly the hole this was built to close. A template
   * would make the rest autonomous, and that is a decision for the owner.
   */
  runBotFollowUps: async ({ now = new Date() } = {}) => {
    const today = israelDateStr(new Date(now));
    const due = dueFollowUps(db, { now });
    if (!due.length) return { event: 'bot_followup', date: today, due: 0, sent: 0 };

    const settings = db.getSettings ? db.getSettings() : {};
    let sent = 0;
    const needStaff = [];

    for (const row of due) {
      const sendId = `bf-${row.id}`;
      if (alreadySent(sendId)) continue;

      const parent = (db.get('parents') || []).find((p) => String(p.id) === String(row.parent_id));
      const phone = row.phone || parent?.phone || '';
      if (!parent || !phone) {
        await closeFollowUp(row, 'cancelled');
        continue;
      }
      // A customer who asked us to stop, or who is mid-conversation with a
      // person, must not get an automatic nudge on top of that.
      if (isOptedOut(parent) || isBotPaused(parent)) {
        await closeFollowUp(row, 'cancelled');
        continue;
      }

      const firstName = parentFirstName(parent);
      const body = withBotMark(followUpMessage(row, { firstName }));

      // Short follow-ups are scheduled 23 hours after the customer wrote, so
      // this is normally still open and costs nothing. A long one — "let's talk
      // in September" — can only travel as an approved template.
      if (!canSendFreeform(parent, 'whatsapp')) {
        if (!templateIsApproved(FOLLOWUP_TEMPLATE_NAME)) {
          needStaff.push({ row, parent });
          continue;
        }
        try {
          const subject = row.reason === 'pending_signup'
            ? `ההרשמה של ${row.subject || 'המתאמן'} במתנ״ס`
            : (row.note || 'מה שדיברנו עליו');
          const result = await whatsappService.sendTemplateMessage(
            phone,
            FOLLOWUP_TEMPLATE_NAME,
            [firstName || 'שלום', subject],
            { parentId: parent.id, language: 'he', source: 'automation' }
          );
          if (result?.success) {
            sent += 1;
            markSent({ id: sendId, event: 'bot_followup', date: today, phone });
            await closeFollowUp(row, 'sent');
            recordBotAction(db, persistCore, {
              type: 'followup_sent',
              summary: `מעקב נשלח בתבנית: ${subject}`,
              details: { reason: row.reason, via: 'template' },
              parentId: parent.id, parentName: parent.name, phone,
            });
          } else {
            needStaff.push({ row, parent });
          }
        } catch (err) {
          console.error('bot follow-up template failed:', err.message);
          needStaff.push({ row, parent });
        }
        continue;
      }

      try {
        const result = await whatsappService.sendTextMessage(phone, body, true, {
          source: 'ai',
          parentId: parent.id,
        });
        if (result?.success) {
          sent += 1;
          markSent({ id: sendId, event: 'bot_followup', date: today, phone });
          await closeFollowUp(row, 'sent');
          recordBotAction(db, persistCore, {
            type: 'followup_sent',
            summary: `מעקב נשלח: ${row.note || 'מעקב'}`,
            details: { reason: row.reason, via: 'freeform' },
            parentId: parent.id, parentName: parent.name, phone,
          });
        }
      } catch (err) {
        console.error('bot follow-up send failed:', err.message);
      }
    }

    // Everyone the 24h window locked out, in one message rather than a stream.
    let staffNotified = 0;
    if (needStaff.length) {
      const { phones } = alertRecipients(db, 'handoff', settings);
      const lines = needStaff.slice(0, 15).map(({ row, parent }) => {
        const what = row.reason === 'pending_signup'
          ? `הרשמה של ${row.subject || 'מתאמן'}`
          : (row.note || 'מעקב');
        return `• ${parent.name || '—'} · ${parent.phone || ''} — ${what}`;
      });
      const body = [
        '⏰ מעקב שהבוט הבטיח ולא יכול לשלוח',
        ...lines,
        needStaff.length > lines.length ? `ועוד ${needStaff.length - lines.length}…` : '',
        '← חלון 24 השעות סגור, צריך פנייה מכם',
      ].filter(Boolean).join('\n');
      for (const staffPhone of phones) {
        try {
          const result = await whatsappService.sendTextMessage(staffPhone, body, false, {
            source: 'staff_notify',
            clip: false,
          });
          if (result?.success) staffNotified += 1;
        } catch (err) {
          console.error('bot follow-up staff notice failed:', err.message);
        }
      }
      // Closed either way: the team has it now, and a note that repeats every
      // morning is how a queue becomes noise nobody reads.
      for (const { row } of needStaff) await closeFollowUp(row, 'sent');
    }

    return {
      event: 'bot_followup',
      date: today,
      due: due.length,
      sent,
      window_closed: needStaff.length,
      staffNotified,
    };
  },

  /**
   * "ממתין להרשמה" is a soft hold that ends when the מתנ״ס confirms — and that
   * confirmation reaches us by phone, not by a webhook. A daily note to the
   * team is what keeps a child from sitting in that state forever.
   */
  runStalledSignupNotice: async ({ days = 5, today = israelDateStr() } = {}) => {
    const stalled = findStalledSignups({ days, today });
    if (!stalled.length) return { event: 'signup_stalled', date: today, candidates: 0, sent: 0 };

    const sendId = `as-signup-stalled-${today}`;
    if (alreadySent(sendId)) {
      return { event: 'signup_stalled', date: today, candidates: stalled.length, sent: 0, skipped: 1 };
    }

    const { phones: staffPhones } = alertRecipients(db, 'signup_stalled', db.getSettings ? db.getSettings() : {});
    if (!staffPhones.length) {
      return { event: 'signup_stalled', date: today, candidates: stalled.length, sent: 0, reason: 'no_staff_phones' };
    }

    const lines = stalled
      .slice(0, 15)
      .map((row) => `• ${row.student.name || '—'} · ${row.daysWaiting} ימים`);
    const body = [
      '⏳ ממתינים לאישור הרשמה',
      ...lines,
      stalled.length > lines.length ? `ועוד ${stalled.length - lines.length}…` : '',
      '← לבדוק מול המתנ״ס ולעדכן סטטוס',
    ].filter(Boolean).join('\n');

    let sent = 0;
    for (const phone of staffPhones) {
      try {
        const result = await whatsappService.sendTextMessage(phone, body, false, {
          source: 'staff_notify',
          clip: false,
        });
        if (result?.success) sent += 1;
      } catch (err) {
        console.error('Stalled signup notice failed:', err.message);
      }
    }
    if (sent) markSent({ id: sendId, automation_id: 'au-signup-stalled', student_id: null, date: today });
    return { event: 'signup_stalled', date: today, candidates: stalled.length, sent };
  },

  ensureDefaultIntroAutomations: () => {
    const existing = db.get('automations') || [];
    const byId = new Map(existing.map((a) => [a.id, a]));
    const defaults = [
      {
        id: 'au-intro-reminder',
        name: 'תזכורת אימון הכירות — ביום האימון',
        trigger_event: 'intro_reminder_day_of',
        trigger_condition: null,
        action_type: 'send_whatsapp',
        action_payload: {
          message:
            'שלום {{parentName}}, תזכורת לאימון ההיכרות של {{name}} היום בשעה {{time}}.\n' +
            'המדריך/ה: {{trainer}}.\n' +
            'הגעה: {{arrival}}.\n' +
            'נתראה על הקיר! 🧗',
          templateName: null,
          preferTemplate: false,
          templateVarKeys: ['name', 'time', 'trainer', 'arrival'],
          arrivalText: null,
        },
        is_active: true,
      },
      {
        id: 'au-intro-followup',
        name: 'בדיקה יום אחרי אימון הכירות',
        trigger_event: 'intro_followup_day_after',
        trigger_condition: null,
        action_type: 'send_whatsapp',
        action_payload: {
          message:
            'שלום {{parentName}}, מקווים שאימון ההיכרות של {{name}} היה כיף!\n' +
            'נשמח לשמוע איך היה, ואם תרצו להירשם לחוג — אנחנו כאן 🙂',
          templateName: null,
          preferTemplate: false,
          templateVarKeys: ['name'],
        },
        is_active: true,
      },
    ];

    let created = 0;
    for (const def of defaults) {
      if (byId.has(def.id)) continue;
      // Also skip if an automation with same trigger already exists (user-created).
      if (existing.some((a) => a.trigger_event === def.trigger_event)) continue;
      db.insert('automations', def);
      created += 1;
    }
    return created;
  },

  isScheduledEvent: (eventName) => SCHEDULED_EVENTS.has(eventName),
};

/** Once per Israel calendar day after `hour` (default 8). */
let lastScheduledAutomationsDate = null;
export async function runScheduledAutomationsIfDue(hour = 8) {
  try {
    const today = israelDateStr();
    if (lastScheduledAutomationsDate === today) return null;
    if (israelHour() < hour) return null;
    lastScheduledAutomationsDate = today;
    automationsService.ensureDefaultIntroAutomations();
    const result = await automationsService.runScheduled();
    console.log(`🤖 Scheduled automations (${today}):`, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error('Scheduled automations failed:', err.message);
    lastScheduledAutomationsDate = null;
    return null;
  }
}
