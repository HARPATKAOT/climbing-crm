/**
 * תוכנית שליחה — מה באמת יקרה אם נלחץ «שלח» עכשיו.
 *
 * One server-side computation feeds the pre-send panel and the send route
 * alike: audience folded to unique phones, the suppression layer with its
 * reasons, marketing-compliance checks, an editable-rate cost estimate,
 * quiet-hours status, and real-recipient previews. The client never decides
 * any of this; it only displays and confirms.
 */

import { db } from '../db.js';
import { previewAudience } from './segments.js';
import {
  evaluateSuppression,
  REASON_META,
  DEFAULT_RECENCY_DAYS,
  DEFAULT_CAP_HOURS,
  isMarketingSend,
} from './broadcastSuppression.js';
import { resolveTemplateVariableValues } from './templateVarFields.js';
import { quietStatus, DEFAULT_QUIET_CONFIG } from './quietHours.js';
import {
  appendMailingPreferencesFooter,
  buildMailingPreferencesUrl,
} from '../mailingPreferences.js';
import { DEFAULT_BUSINESS_PROFILE } from '../businessProfile.js';

/**
 * תעריפי Meta לישראל, דולר להודעה שנמסרה, לפי קטגוריית תבנית.
 * Meta מעדכנת את המחירון רבעונית ואינה חושפת אותו ב-API — לכן זה תעריף
 * שמוגדר אצלנו וניתן לעדכון, והממשק מציג אותו כהערכה, לא כעובדה.
 * הודעה חופשית בתוך חלון 24 השעות היא שיחת שירות — בחינם.
 */
export const DEFAULT_RATES = {
  MARKETING: 0.0353,
  UTILITY: 0.0053,
  AUTHENTICATION: 0.0142,
  currency: 'USD',
};

export function getBroadcastDefaults() {
  const stored = db.getSettings()?.broadcastDefaults || {};
  // 0 שמור הוא כיבוי מפורש של הכלל, לא ערך חסר.
  const storedOr = (value, fallback) => (
    Number.isFinite(Number(value)) && value !== null && value !== '' && value !== undefined
      ? Math.max(0, Number(value))
      : fallback
  );
  return {
    recencyDays: storedOr(stored.recencyDays, DEFAULT_RECENCY_DAYS),
    capHours: storedOr(stored.capHours, DEFAULT_CAP_HOURS),
    rates: { ...DEFAULT_RATES, ...(stored.rates || {}) },
    quiet: { ...DEFAULT_QUIET_CONFIG, ...(stored.quiet || {}) },
  };
}

export function saveBroadcastDefaults(patch = {}) {
  const current = getBroadcastDefaults();
  // 0 נשמר כמו כל ערך — הוא כיבוי מפורש של הכלל; רק ערך חסר נשאר כשהיה.
  const numberOr = (value, fallback) => (
    value === undefined || value === null || value === ''
      ? fallback
      : Math.max(0, Number(value) || 0)
  );
  const next = {
    recencyDays: numberOr(patch.recencyDays, current.recencyDays),
    capHours: numberOr(patch.capHours, current.capHours),
    rates: { ...current.rates, ...(patch.rates || {}) },
    quiet: { ...current.quiet, ...(patch.quiet || {}) },
  };
  db.saveSettings({ broadcastDefaults: next });
  return next;
}

export function findLocalTemplate(templateId) {
  if (!templateId) return null;
  const templates = db.get('message_templates') || [];
  return templates.find(
    (t) => t.id === templateId || t.meta_name === templateId || t.name === templateId
  ) || null;
}

const OPT_OUT_WORDING = /הסר|הסרה|להסיר|הפסקת|העדפות\s*דיוור|unsubscribe|stop/i;

/** בדיקת עמידה בחוק לתבנית שיווקית: מנגנון הסרה (חוסם) וזיהוי שולח (אזהרה). */
export function marketingComplianceIssues(template, brandName = '') {
  const blockers = [];
  const warnings = [];
  const text = [template?.header, template?.body, template?.footer]
    .map((part) => String(part || '')).join('\n');
  const hasPreferencesVar = (Array.isArray(template?.variables) ? template.variables : [])
    .some((v) => v && typeof v === 'object' && v.field === 'mailing_preferences');
  const hasOptOut = hasPreferencesVar || OPT_OUT_WORDING.test(text)
    || (Array.isArray(template?.buttons) ? template.buttons : [])
      .some((b) => OPT_OUT_WORDING.test(String(b?.text || '')));
  if (!hasOptOut) {
    blockers.push('לתבנית השיווקית אין מנגנון הסרה — הוסיפו משתנה «קישור להעדפות דיוור» או נוסח הסרה מפורש');
  }
  const brand = String(brandName || DEFAULT_BUSINESS_PROFILE.display_name || '').trim();
  if (brand && !text.includes(brand)) {
    warnings.push(`שם העסק («${brand}») לא מופיע בתבנית — מומלץ שזיהוי השולח יהיה בגוף ההודעה`);
  }
  return { blockers, warnings };
}

/** גוף ההודעה כפי שיֵראה אצל נמען ספציפי (לתצוגה מקדימה ולשליחת בדיקה). */
export function renderMessageForRecipient({ template, customMessage, recipient, parent, student }) {
  if (!template) {
    const owner = parent || { id: recipient?.parentId, phone: recipient?.phone };
    return {
      header: '',
      body: appendMailingPreferencesFooter(String(customMessage || ''), owner),
      footer: '',
      buttons: [],
    };
  }
  const preferenceUrl = parent ? buildMailingPreferencesUrl(parent) : '';
  const overrides = Array.isArray(template.variables)
    ? template.variables.map((v) => (
      v && typeof v === 'object' && v.field === 'mailing_preferences' ? preferenceUrl : null
    ))
    : [];
  const values = resolveTemplateVariableValues(template, parent, student, overrides);
  let body = String(template.body || '');
  const keys = [...body.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1]);
  const uniqueKeys = [...new Set(keys)];
  uniqueKeys.forEach((key, idx) => {
    const value = values[idx] != null && String(values[idx]).length ? String(values[idx]) : 'לקוח';
    body = body.split(`{{${key}}}`).join(value);
  });
  return {
    header: template.header || '',
    body,
    footer: template.footer || '',
    buttons: Array.isArray(template.buttons) ? template.buttons : [],
  };
}

/**
 * The plan. `overrides` are phones the owner consciously unblocked;
 * they cannot lift opt-out, list-unsubscribe or a broken number.
 */
export function buildBroadcastPlan({
  filters = {},
  templateId = null,
  customMessage = '',
  listKey = '',
  overrides = [],
  recencyDays = null,
  capHours = null,
  sampleOffset = 0,
  sampleLimit = 12,
  now = Date.now(),
} = {}) {
  const defaults = getBroadcastDefaults();
  const template = findLocalTemplate(templateId);
  const effectiveList = listKey || filters.listKey || '';
  // 0 הוא כיבוי מפורש של הכלל; רק ערך חסר נופל לברירת המחדל.
  const days = recencyDays === null || recencyDays === undefined || recencyDays === ''
    ? defaults.recencyDays
    : Math.max(0, Number(recencyDays) || 0);
  const hours = capHours === null || capHours === undefined || capHours === ''
    ? defaults.capHours
    : Math.max(0, Number(capHours) || 0);

  const preview = previewAudience(filters);
  const parentById = new Map((db.get('parents') || []).map((p) => [p.id, p]));
  const recipients = preview.recipients.map((r) => ({
    ...r,
    _parent: parentById.get(r.parentId) || null,
  }));

  const evaluation = evaluateSuppression({
    recipients,
    template,
    customMessage: template ? '' : customMessage,
    listKey: effectiveList,
    recencyDays: days,
    capHours: hours,
    logs: db.get('whatsapp_logs') || [],
    templates: db.get('message_templates') || [],
    overrides,
    now,
  });

  // People the audience filters removed for opt-out / list unsubscription are
  // shown too — with the reason — instead of vanishing from the count.
  const summary = { ...evaluation.summary };
  const suppressed = [...evaluation.suppressed];
  for (const r of preview.removed || []) {
    const code = r.listUnsubscribed ? 'list_unsubscribed' : 'opted_out';
    summary[code] = (summary[code] || 0) + 1;
    suppressed.push({
      id: r.id,
      phone: r.phone,
      name: r.name,
      parentId: r.parentId,
      studentName: r.studentName || '',
      reasons: [{ code, detail: '', ...REASON_META[code] }],
      overridable: false,
    });
  }

  const marketing = isMarketingSend({ template, listKey: effectiveList });
  const brandName = DEFAULT_BUSINESS_PROFILE.display_name;
  const compliance = template && marketing
    ? marketingComplianceIssues(template, brandName)
    : { blockers: [], warnings: [] };

  // עלות: רק תבניות מחויבות; הודעה חופשית בחלון פתוח היא שיחת שירות חינמית.
  const category = String(template?.category || 'UTILITY').toUpperCase();
  const perMessage = template ? (Number(defaults.rates[category]) || 0) : 0;
  const cost = {
    currency: defaults.rates.currency || 'USD',
    category: template ? category : 'SERVICE',
    perMessage,
    total: Math.round(perMessage * evaluation.eligible.length * 100) / 100,
    note: template
      ? 'לפי תעריף Meta לישראל כפי שמוגדר בהגדרות הדיוור — הערכה, לא חשבונית'
      : 'הודעה חופשית בחלון 24 שעות היא שיחת שירות — ללא עלות',
  };

  const quiet = quietStatus(new Date(now), defaults.quiet);

  const sampleRows = evaluation.eligible.slice(sampleOffset, sampleOffset + sampleLimit);
  const samples = sampleRows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    parentId: r.parentId,
    studentName: r.studentName || '',
    overridden: !!r.overridden,
    rendered: renderMessageForRecipient({
      template,
      customMessage,
      recipient: r,
      parent: r._parent,
      student: r.students?.[0] || null,
    }),
  }));

  return {
    audience: {
      count: preview.count,
      childCount: preview.childCount,
      cardCount: preview.cardCount,
    },
    eligible: evaluation.eligible,
    eligibleCount: evaluation.eligible.length,
    eligibleChildCount: evaluation.eligible.reduce(
      (sum, r) => sum + (Array.isArray(r.students) ? r.students.length : 0), 0
    ),
    suppressed,
    suppressedCount: suppressed.length,
    summary,
    samples,
    sampleOffset,
    isMarketing: marketing,
    template: template
      ? { id: template.id, name: template.name, metaName: template.meta_name || '', category }
      : null,
    compliance,
    cost,
    quiet,
    settings: { recencyDays: days, capHours: hours },
  };
}
