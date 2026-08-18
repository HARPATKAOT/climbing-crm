/**
 * מנוע החסימות של הדיוור — מי לא מקבל את ההודעה, ולמה.
 *
 * Runs before counting, before display and before sending, always on the
 * server. Every removal carries a reason the owner can see and — for the
 * reasons that are a judgement call — consciously override. Opt-out and a
 * broken number are never overridable: the first is the customer's word,
 * the second cannot succeed.
 */

import { normalizeWaPhone } from '../whatsappConnect.js';
import { resolveTemplateFieldValue } from './templateVarFields.js';
import { CHANNEL_PLACEHOLDER_NAMES } from '../db.js';

export const REASON_META = {
  opted_out: {
    label: 'ביקש/ה להסיר מדיוור שיווקי',
    overridable: false,
  },
  list_unsubscribed: {
    label: 'הסיר/ה את עצמו/ה מרשימת התפוצה',
    overridable: false,
  },
  invalid_phone: {
    label: 'מספר טלפון לא תקין',
    overridable: false,
  },
  template_recency: {
    label: 'קיבל/ה את התבנית הזו לאחרונה',
    overridable: true,
  },
  frequency_cap: {
    label: 'קיבל/ה הודעה שיווקית לאחרונה (תקרת תדירות)',
    overridable: true,
  },
  repeated_failures: {
    label: 'שליחות קודמות למספר נכשלו שוב ושוב',
    overridable: true,
  },
  missing_variables: {
    label: 'חסר נתון שהתבנית צריכה (יישלח עם ערך כללי)',
    overridable: true,
  },
  window_closed: {
    label: 'חלון 24 השעות סגור — הודעה חופשית לא תעבור',
    overridable: false,
  },
  trainee_phone: {
    label: 'טלפון של מתאמן — לפי מסנן «נמענים» הדיוור נשלח להורים',
    overridable: false,
  },
  already_registered: {
    label: 'כבר רשום/ה לחוג — הודעת פתיחת הרשמה אינה רלוונטית',
    overridable: true,
  },
};

export const DEFAULT_RECENCY_DAYS = 7;
export const DEFAULT_CAP_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 9-digit tail so 050…, 972… and stray formats land in one bucket. */
export function phoneBucket(phone) {
  const digits = normalizeWaPhone(phone);
  const tail = digits.slice(-9);
  return tail.length === 9 ? tail : digits;
}

/** Index outbound message rows by phone bucket, newest first. */
export function buildOutboundIndex(logs = []) {
  const index = new Map();
  for (const row of logs) {
    if (row?.direction !== 'outbound') continue;
    const bucket = phoneBucket(row.phone);
    if (!bucket) continue;
    if (!index.has(bucket)) index.set(bucket, []);
    index.get(bucket).push(row);
  }
  for (const rows of index.values()) {
    rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
  return index;
}

/** WhatsApp needs a full international number; Israeli mobiles are 9725… */
export function isSendablePhone(phone) {
  const digits = normalizeWaPhone(phone);
  if (!/^\d{11,15}$/.test(digits)) return false;
  if (digits.startsWith('972')) return /^9725\d{8}$/.test(digits);
  return true;
}

function isMissingNameValue(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  return CHANNEL_PLACEHOLDER_NAMES.includes(v);
}

/** A placeholder card name ("לקוח וואטסאפ") must not split into a "first name". */
function scrubPlaceholderName(entity) {
  if (!entity) return entity;
  const name = String(entity.name || '').trim();
  return CHANNEL_PLACEHOLDER_NAMES.includes(name) ? { ...entity, name: '' } : entity;
}

/** אילו משתני תבנית אין לנו עבור הנמען הזה (שם ריק או כרטיס-צל). */
export function missingTemplateVariables(template, rawParent, rawStudent) {
  const vars = Array.isArray(template?.variables) ? template.variables : [];
  const parent = scrubPlaceholderName(rawParent);
  const student = scrubPlaceholderName(rawStudent);
  const missing = [];
  vars.forEach((v, idx) => {
    const field = v && typeof v === 'object' ? v.field : null;
    // Free-text and the preferences link always resolve; names and phones may not.
    if (field === 'custom' || field === 'mailing_preferences') return;
    const effective = field || 'parent_name';
    const raw = resolveTemplateFieldValue(effective, parent, student);
    const nameLike = /name|first|last/.test(effective);
    if ((nameLike && isMissingNameValue(raw)) || (!nameLike && !String(raw || '').trim())) {
      missing.push({
        index: idx + 1,
        field: effective,
        label: (v && typeof v === 'object' && v.label) || effective,
      });
    }
  });
  return missing;
}

/** האם השליחה הזו שיווקית — תבנית שיווקית, או טקסט חופשי שאינו לרשימה תפעולית. */
export function isMarketingSend({ template, listKey } = {}) {
  if (template) return String(template.category || '').toUpperCase() === 'MARKETING';
  return String(listKey || '') !== 'operational';
}

/**
 * The engine. Pure — every data source is injected, so the same call runs in
 * the plan preview, in the send route and in tests.
 *
 * `overrides` are recipient ids (normalized phones) the owner consciously
 * unblocked in the panel; they only lift overridable reasons.
 */
export function evaluateSuppression({
  recipients = [],
  template = null,
  customMessage = '',
  listKey = '',
  recencyDays = DEFAULT_RECENCY_DAYS,
  capHours = DEFAULT_CAP_HOURS,
  logs = [],
  templates = [],
  overrides = [],
  now = Date.now(),
} = {}) {
  const outbound = buildOutboundIndex(logs);
  const overrideSet = new Set((overrides || []).map(String));
  const marketing = isMarketingSend({ template, listKey });
  const templateName = template ? (template.meta_name || template.name || '') : '';
  const recencyMs = Math.max(0, Number(recencyDays) || 0) * DAY_MS;
  const capMs = Math.max(0, Number(capHours) || 0) * HOUR_MS;

  const marketingTemplateNames = new Set(
    (templates || [])
      .filter((t) => String(t.category || '').toUpperCase() === 'MARKETING')
      .flatMap((t) => [t.meta_name, t.name].filter(Boolean))
  );

  const eligible = [];
  const suppressed = [];
  const summary = {};

  for (const recipient of recipients) {
    const reasons = [];
    const addReason = (code, detail = '') => {
      reasons.push({ code, detail, ...REASON_META[code] });
    };

    if (recipient.invalidPhone || !isSendablePhone(recipient.phone)) {
      addReason('invalid_phone', String(recipient.phone || 'ללא מספר'));
    }

    // הודעה חופשית (ללא תבנית) עוברת רק בחלון שירות פתוח.
    if (!template && customMessage && !recipient.windowOpen) {
      addReason('window_closed');
    }

    if (marketing && recipient.marketingOptOut) {
      addReason('opted_out');
    }
    if (recipient.listUnsubscribed) {
      addReason('list_unsubscribed');
    }
    // A family that is already registered was told to hurry and reserve a
    // place. Four of them wrote back confused, and the bot then had to answer
    // a question the message itself had created. Overridable, because plenty
    // of marketing is right for them — just not "registration is open".
    if (marketing && recipient.hasActiveRegistration) {
      addReason('already_registered');
    }

    const rows = outbound.get(phoneBucket(recipient.phone)) || [];

    if (templateName && recencyMs > 0) {
      const recent = rows.find((row) => {
        if ((row.template_id || row.template_name) !== templateName) return false;
        if (row.status === 'failed') return false;
        return now - new Date(row.created_at || 0).getTime() <= recencyMs;
      });
      if (recent) {
        addReason('template_recency',
          `נשלחה ב-${new Date(recent.created_at).toLocaleDateString('he-IL')}`);
      }
    }

    if (marketing && capMs > 0) {
      const recentMarketing = rows.find((row) => {
        if (row.status === 'failed') return false;
        const rowTemplate = row.template_id || row.template_name || '';
        const isMarketingRow = row.source === 'broadcast'
          || (rowTemplate && marketingTemplateNames.has(rowTemplate));
        if (!isMarketingRow) return false;
        return now - new Date(row.created_at || 0).getTime() <= capMs;
      });
      if (recentMarketing) {
        addReason('frequency_cap',
          `הודעה שיווקית ב-${new Date(recentMarketing.created_at).toLocaleString('he-IL')}`);
      }
    }

    // Three straight failures with no success since → the number bounces.
    let failStreak = 0;
    for (const row of rows) {
      if (row.status === 'failed') failStreak += 1;
      else break;
    }
    if (failStreak >= 3) {
      addReason('repeated_failures', `${failStreak} כישלונות רצופים`);
    }

    if (template && !customMessage) {
      const primaryParent = recipient._parent || null;
      const primaryStudent = recipient.students?.[0] || null;
      const missing = missingTemplateVariables(template, primaryParent
        || { name: recipient.name, phone: recipient.phone }, primaryStudent);
      if (missing.length) {
        addReason('missing_variables', missing.map((m) => m.label).join(', '));
      }
    }

    const allOverridable = reasons.length > 0 && reasons.every((r) => r.overridable);
    const overridden = allOverridable && overrideSet.has(String(recipient.id));

    if (!reasons.length || overridden) {
      eligible.push(overridden ? { ...recipient, overridden: true } : recipient);
      continue;
    }

    for (const r of reasons) summary[r.code] = (summary[r.code] || 0) + 1;
    suppressed.push({
      id: recipient.id,
      phone: recipient.phone,
      name: recipient.name,
      parentId: recipient.parentId,
      studentName: recipient.studentName || '',
      reasons,
      overridable: allOverridable,
    });
  }

  return { eligible, suppressed, summary, isMarketing: marketing };
}
