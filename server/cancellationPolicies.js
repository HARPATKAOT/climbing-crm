import crypto from 'crypto';

export const DEFAULT_CANCELLATION_RULES = Object.freeze([
  { id: 'seven_days', min_hours_before: 168, max_hours_before: null, refund_percent: 100, fixed_fee: 50 },
  { id: 'two_to_seven_days', min_hours_before: 48, max_hours_before: 168, refund_percent: 50, fixed_fee: 0 },
  { id: 'under_two_days', min_hours_before: 0, max_hours_before: 48, refund_percent: 0, fixed_fee: 0 },
]);

export const DEFAULT_CANCELLATION_TEXT = 'הפעילות מותנית במינימום משתתפים. במקרה של ביטול הפעילות על ידינו יוחזר מלוא הסכום.';

/**
 * חלון התחרטות: כמה שעות מרגע הרכישה מותר לבטל בלי עלות, בלי קשר לכמה זמן
 * נשאר עד הפעילות.
 *
 * בלעדיו מי שקנה יומיים לפני הטיול נפל מיד למדרגה של 50% — גם אם התחרט חמש
 * דקות אחרי שלחץ. החלון נספר מהרכישה ולא מהפעילות, ולכן הוא המדרגה היחידה
 * שאינה נמדדת לאחור מהתאריך.
 */
export const DEFAULT_COOLING_OFF_HOURS = 24;

/**
 * על מה המדיניות נמדדת.
 *
 * `activity_date` — כמה זמן נשאר עד הפעילות. נכון לאירוע שיש לו תאריך.
 * `usage` — כמה מהמוצר כבר נוצל. זה הבסיס לכרטיסייה ולמנוי, שאין להם תאריך
 *   שממנו סופרים אחורה: מה שקובע הוא כמה כניסות נותרו או כמה מהתקופה נשארה.
 */
export const POLICY_BASES = Object.freeze({ ACTIVITY_DATE: 'activity_date', USAGE: 'usage' });

export function normalizePolicyBasis(value) {
  const key = String(value || '').trim();
  return key === POLICY_BASES.USAGE ? POLICY_BASES.USAGE : POLICY_BASES.ACTIVITY_DATE;
}

/**
 * כללי מדיניות לפי ניצול. מבנה שטוח ולא מדרגות, כי אין כאן ציר זמן —
 * יש חלק שנוצל וחלק שלא.
 */
/**
 * שתי דרכים ליישב כרטיסייה שבוטלה באמצע.
 *
 * `pro_rata` — מחזירים את ערכו היחסי של החלק שלא נוצל. נכון להשכרה, שבה
 *   המחיר הוא על תקופה ולא על כמות.
 * `full_price` — הכניסות שנוצלו מחויבות במחיר כניסה בודדת, וההפרש חוזר. זה
 *   הנכון לכרטיסייה: ההנחה ניתנה על ההתחייבות לכמות, ומי שניצל חלק לא עמד
 *   בה — ולכן אינו זכאי להנחה על מה שכן צרך.
 */
export const USAGE_SETTLEMENTS = Object.freeze({ PRO_RATA: 'pro_rata', FULL_PRICE: 'full_price' });

export function normalizeUsageSettlement(value) {
  return String(value || '') === USAGE_SETTLEMENTS.FULL_PRICE
    ? USAGE_SETTLEMENTS.FULL_PRICE
    : USAGE_SETTLEMENTS.PRO_RATA;
}

export const DEFAULT_USAGE_RULE = Object.freeze({
  settlement: USAGE_SETTLEMENTS.PRO_RATA,
  unused_refund_percent: 100,
  full_unit_price: 0,
  fixed_fee: 0,
  min_used_units: 0,
  no_refund_after_percent: 100,
});

export function normalizeUsageRule(rule = {}) {
  const source = rule || {};
  // `??` תופס רק null/undefined, לא NaN — ולכן `Number(undefined) ?? 100`
  // החזיר NaN, שהתגלגל ל-0. „אין החזר מעל 0% ניצול” חסם כל החזר של כרטיסייה
  // שנגעו בה פעם אחת. אחוז חסר חייב ליפול לברירת המחדל, לא לאפס.
  const percent = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(100, Math.max(0, n));
  };
  return {
    settlement: normalizeUsageSettlement(source.settlement),
    // כמה מהחלק שלא נוצל מוחזר (ביישוב יחסי)
    unused_refund_percent: percent(source.unused_refund_percent, 100),
    // מחיר יחידה בודדת ללא הנחה (ביישוב לפי מחיר מלא) — למשל כניסה אחת לקיר
    full_unit_price: money(source.full_unit_price),
    // דמי ביטול קבועים, פעם אחת על הביטול כולו
    fixed_fee: money(source.fixed_fee),
    // התחייבות מינימלית: כמה יחידות (כניסות או חודשים) חייבות להיות מנוצלות
    // או משולמות לפני שמגיע החזר בכלל
    min_used_units: Math.max(0, Math.round(Number(source.min_used_units) || 0)),
    // מעל אחוז ניצול זה אין החזר בכלל
    no_refund_after_percent: percent(source.no_refund_after_percent, 100),
  };
}

export function normalizeCoolingOffHours(value) {
  if (value === null || value === '' || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(720, Math.round(n * 100) / 100);
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function money(value) {
  return Math.max(0, Math.round((Number(value) || 0) * 100) / 100);
}

export function normalizeCancellationRules(rules) {
  const source = Array.isArray(rules) && rules.length ? rules : DEFAULT_CANCELLATION_RULES;
  return source.map((rule, index) => ({
    id: String(rule.id || `rule_${index + 1}`),
    min_hours_before: Math.max(0, Number(rule.min_hours_before) || 0),
    max_hours_before: rule.max_hours_before == null || rule.max_hours_before === ''
      ? null
      : Math.max(0, Number(rule.max_hours_before) || 0),
    refund_percent: Math.min(100, Math.max(0, Number(rule.refund_percent) || 0)),
    fixed_fee: money(rule.fixed_fee),
  })).sort((a, b) => b.min_hours_before - a.min_hours_before);
}

export function policySnapshot(policy, version) {
  if (!policy || !version) return null;
  return {
    policy_id: policy.id,
    policy_name: policy.name,
    version_id: version.id,
    version_number: version.version_number,
    basis: normalizePolicyBasis(version.basis),
    rules: normalizeCancellationRules(version.rules),
    usage_rule: normalizeUsageRule(version.usage_rule),
    cooling_off_hours: normalizeCoolingOffHours(version.cooling_off_hours),
    free_text: String(version.free_text || ''),
    published_at: version.published_at || null,
  };
}

export function currentPolicyVersion(db, policyId) {
  const policy = db.getOne('cancellation_policies', policyId);
  if (!policy || policy.status === 'archived') return null;
  const versions = (db.get('cancellation_policy_versions') || []).filter((row) => row.policy_id === policy.id);
  const version = versions.find((row) => row.id === policy.current_version_id)
    || [...versions].filter((row) => row.status === 'published')
      .sort((a, b) => Number(b.version_number) - Number(a.version_number))[0]
    || null;
  return version ? { policy, version, snapshot: policySnapshot(policy, version) } : null;
}

export function resolvePolicyFor(db, source = {}) {
  if (source.cancellation_policy_disabled === true || source.cancellationPolicyDisabled === true) return null;
  const explicit = source.cancellation_policy_id || source.cancellationPolicyId;
  if (explicit === null || explicit === 'none') return null;
  if (explicit) return currentPolicyVersion(db, explicit);
  const fallback = (db.get('cancellation_policies') || []).find((row) => row.is_default && row.status === 'published');
  return fallback ? currentPolicyVersion(db, fallback.id) : null;
}

/**
 * החזר לכרטיסייה או למנוי — לפי מה שנותר, לא לפי מה שיקרה מחר.
 *
 * `totalUnits` הוא מה שנקנה (כניסות, או חודשי מנוי) ו-`usedUnits` מה שכבר
 * נוצל. ההחזר הוא ערך החלק שלא נוצל, לפי האחוז שנקבע, פחות דמי ביטול —
 * ואפס כשהניצול עבר את הגבול או כשלא הושלמה ההתחייבות המינימלית.
 */
export function suggestedUsageRefund({
  snapshot,
  paidAmount,
  totalUnits,
  usedUnits = 0,
  purchasedAt = null,
  cancelledAt = new Date(),
  organizerCancelled = false,
} = {}) {
  const paid = money(paidAmount);
  if (organizerCancelled) {
    return { amount: paid, rule_id: 'organizer_cancelled', refund_percent: 100, fixed_fee: 0 };
  }
  const total = Math.max(0, Number(totalUnits) || 0);
  const used = Math.max(0, Number(usedUnits) || 0);
  const rule = normalizeUsageRule(snapshot?.usage_rule);

  // התחרטות: החזר מלא, אבל רק אם עוד לא נגעו במוצר. מי שכבר נכנס פעם אחת
  // צרך ממנו, וזה כבר לא ביטול אלא שימוש חלקי.
  const coolingOff = normalizeCoolingOffHours(snapshot?.cooling_off_hours);
  const bought = purchasedAt ? new Date(purchasedAt) : null;
  const cancelled = cancelledAt instanceof Date ? cancelledAt : new Date(cancelledAt);
  if (coolingOff > 0 && used === 0 && bought && !Number.isNaN(bought.getTime())) {
    const sincePurchase = (cancelled.getTime() - bought.getTime()) / 36e5;
    if (sincePurchase >= 0 && sincePurchase <= coolingOff) {
      return {
        amount: paid,
        rule_id: 'cooling_off',
        refund_percent: 100,
        fixed_fee: 0,
        cooling_off_hours: coolingOff,
      };
    }
  }

  if (!total) return { amount: 0, rule_id: 'no_units', refund_percent: 0, fixed_fee: 0 };

  const usedPercent = Math.min(100, (used / total) * 100);
  if (used < rule.min_used_units) {
    // התחייבות מינימלית שלא הושלמה — משלמים עליה, ולכן אין החזר על החלק הזה.
    const owed = Math.min(total, rule.min_used_units);
    const remaining = Math.max(0, total - owed);
    const value = paid * (remaining / total);
    const amount = money(Math.max(0, value * (rule.unused_refund_percent / 100) - rule.fixed_fee));
    return {
      amount,
      rule_id: 'below_min_commitment',
      refund_percent: rule.unused_refund_percent,
      fixed_fee: rule.fixed_fee,
      used_units: used,
      total_units: total,
      billed_units: owed,
    };
  }
  if (usedPercent > rule.no_refund_after_percent) {
    return {
      amount: 0,
      rule_id: 'used_too_much',
      refund_percent: 0,
      fixed_fee: 0,
      used_units: used,
      total_units: total,
      used_percent: Math.round(usedPercent * 100) / 100,
    };
  }

  if (rule.settlement === USAGE_SETTLEMENTS.FULL_PRICE && rule.full_unit_price > 0) {
    // מה שנוצל מחויב במחיר מלא, והיתרה חוזרת. אם המחיר המלא של מה שנוצל עולה
    // על מה ששולם — ההחזר הוא אפס ולא סכום שלילי: הלקוח לא נשאר חייב לנו.
    const owedForUsed = used * rule.full_unit_price;
    const amount = money(Math.max(0, paid - owedForUsed - rule.fixed_fee));
    return {
      amount,
      rule_id: 'used_at_full_price',
      refund_percent: 100,
      fixed_fee: rule.fixed_fee,
      used_units: used,
      total_units: total,
      full_unit_price: rule.full_unit_price,
      charged_for_used: money(owedForUsed),
      used_percent: Math.round(usedPercent * 100) / 100,
    };
  }

  const unusedValue = paid * (Math.max(0, total - used) / total);
  const amount = money(Math.max(0, unusedValue * (rule.unused_refund_percent / 100) - rule.fixed_fee));
  return {
    amount,
    rule_id: 'unused_portion',
    refund_percent: rule.unused_refund_percent,
    fixed_fee: rule.fixed_fee,
    used_units: used,
    total_units: total,
    used_percent: Math.round(usedPercent * 100) / 100,
  };
}

export function suggestedRefund({
  snapshot,
  paidAmount,
  activityStartsAt,
  purchasedAt = null,
  cancelledAt = new Date(),
  organizerCancelled = false,
  participantsCancelled = 1,
  totalUnits = 0,
  usedUnits = 0,
} = {}) {
  const paid = money(paidAmount);
  if (organizerCancelled) return { amount: paid, rule_id: 'organizer_cancelled', refund_percent: 100, fixed_fee: 0 };
  // מדיניות שנמדדת לפי ניצול אין לה תאריך לספור ממנו אחורה.
  if (snapshot && normalizePolicyBasis(snapshot.basis) === POLICY_BASES.USAGE) {
    return suggestedUsageRefund({
      snapshot, paidAmount, totalUnits, usedUnits, purchasedAt, cancelledAt, organizerCancelled,
    });
  }
  const starts = activityStartsAt instanceof Date ? activityStartsAt : new Date(activityStartsAt);
  const cancelled = cancelledAt instanceof Date ? cancelledAt : new Date(cancelledAt);
  if (!snapshot || Number.isNaN(starts.getTime()) || Number.isNaN(cancelled.getTime())) {
    return { amount: 0, rule_id: null, refund_percent: 0, fixed_fee: 0 };
  }

  // חלון ההתחרטות נבדק ראשון והוא מחזיר הכול — אבל רק כל עוד הפעילות עוד לא
  // התחילה. מי שקנה שש שעות לפני היציאה לא מקבל בזכותו יממה של ביטול חינם
  // אחרי שהאוטובוס יצא.
  const coolingOff = normalizeCoolingOffHours(snapshot.cooling_off_hours);
  const bought = purchasedAt ? new Date(purchasedAt) : null;
  if (coolingOff > 0 && bought && !Number.isNaN(bought.getTime())) {
    const sincePurchase = (cancelled.getTime() - bought.getTime()) / 36e5;
    if (sincePurchase >= 0 && sincePurchase <= coolingOff && cancelled.getTime() < starts.getTime()) {
      return {
        amount: paid,
        rule_id: 'cooling_off',
        refund_percent: 100,
        fixed_fee: 0,
        cooling_off_hours: coolingOff,
        hours_since_purchase: Math.round(sincePurchase * 100) / 100,
      };
    }
  }

  const hours = Math.max(0, (starts.getTime() - cancelled.getTime()) / 36e5);
  const rules = normalizeCancellationRules(snapshot.rules);
  const rule = rules.find((candidate) => (
    hours >= candidate.min_hours_before
    && (candidate.max_hours_before == null || hours < candidate.max_hours_before)
  )) || rules[rules.length - 1];
  const grossRefund = paid * (rule.refund_percent / 100);
  const fixedFee = money(rule.fixed_fee) * Math.max(1, Number(participantsCancelled) || 1);
  return {
    amount: money(Math.max(0, grossRefund - fixedFee)),
    rule_id: rule.id,
    refund_percent: rule.refund_percent,
    fixed_fee: fixedFee,
    hours_before: Math.round(hours * 100) / 100,
  };
}

async function durable(persist, table, row) {
  const result = await persist(table, row);
  if (result?.ok === false) throw Object.assign(new Error(result.error || `שמירת ${table} נכשלה`), { status: 503 });
}

export async function createPolicy(db, persist, input = {}, actor = '') {
  const now = new Date().toISOString();
  const policy = db.insert('cancellation_policies', {
    id: id('cp'),
    name: String(input.name || 'מדיניות ביטול').trim(),
    status: 'draft',
    is_default: false,
    current_version_id: null,
    created_by: actor || null,
    created_at: now,
    updated_at: now,
  });
  const version = db.insert('cancellation_policy_versions', {
    id: id('cpv'),
    policy_id: policy.id,
    version_number: 1,
    basis: normalizePolicyBasis(input.basis),
    rules: normalizeCancellationRules(input.rules),
    usage_rule: normalizeUsageRule(input.usage_rule),
    cooling_off_hours: normalizeCoolingOffHours(input.cooling_off_hours ?? DEFAULT_COOLING_OFF_HOURS),
    free_text: String(input.free_text ?? DEFAULT_CANCELLATION_TEXT),
    status: 'draft',
    published_at: null,
    created_by: actor || null,
    created_at: now,
  });
  await durable(persist, 'cancellation_policies', policy);
  await durable(persist, 'cancellation_policy_versions', version);
  return { policy, version };
}

export async function savePolicyDraft(db, persist, policyId, input = {}, actor = '') {
  const policy = db.getOne('cancellation_policies', policyId);
  if (!policy) throw Object.assign(new Error('המדיניות לא נמצאה'), { status: 404 });
  const versions = (db.get('cancellation_policy_versions') || []).filter((row) => row.policy_id === policy.id);
  let draft = versions.find((row) => row.status === 'draft');
  if (!draft) {
    const current = currentPolicyVersion(db, policy.id)?.version;
    draft = db.insert('cancellation_policy_versions', {
      id: id('cpv'), policy_id: policy.id,
      version_number: Math.max(0, ...versions.map((row) => Number(row.version_number) || 0)) + 1,
      basis: normalizePolicyBasis(input.basis ?? current?.basis),
      rules: normalizeCancellationRules(input.rules || current?.rules),
      usage_rule: normalizeUsageRule(input.usage_rule || current?.usage_rule),
      cooling_off_hours: normalizeCoolingOffHours(input.cooling_off_hours ?? current?.cooling_off_hours),
      free_text: String(input.free_text ?? current?.free_text ?? ''),
      status: 'draft', published_at: null, created_by: actor || null,
      created_at: new Date().toISOString(),
    });
  } else {
    draft = db.update('cancellation_policy_versions', draft.id, {
      basis: normalizePolicyBasis(input.basis ?? draft.basis),
      rules: normalizeCancellationRules(input.rules || draft.rules),
      usage_rule: normalizeUsageRule(input.usage_rule || draft.usage_rule),
      cooling_off_hours: normalizeCoolingOffHours(input.cooling_off_hours ?? draft.cooling_off_hours),
      free_text: String(input.free_text ?? draft.free_text ?? ''),
    }) || draft;
  }
  const updated = db.update('cancellation_policies', policy.id, {
    name: String(input.name ?? policy.name).trim() || policy.name,
    updated_at: new Date().toISOString(),
  }) || policy;
  await durable(persist, 'cancellation_policy_versions', draft);
  await durable(persist, 'cancellation_policies', updated);
  return { policy: updated, version: draft };
}

export async function publishPolicy(db, persist, policyId, input = {}, actor = '') {
  const saved = await savePolicyDraft(db, persist, policyId, input, actor);
  const now = new Date().toISOString();
  const version = db.update('cancellation_policy_versions', saved.version.id, {
    status: 'published', published_at: now,
  }) || saved.version;
  if (input.is_default === true) {
    for (const other of db.get('cancellation_policies') || []) {
      if (other.id === policyId || !other.is_default) continue;
      await durable(persist, 'cancellation_policies', db.update('cancellation_policies', other.id, { is_default: false, updated_at: now }) || other);
    }
  }
  const policy = db.update('cancellation_policies', policyId, {
    status: 'published', current_version_id: version.id,
    is_default: input.is_default === true || saved.policy.is_default === true,
    updated_at: now,
  }) || saved.policy;
  await durable(persist, 'cancellation_policy_versions', version);
  await durable(persist, 'cancellation_policies', policy);
  return { policy, version, snapshot: policySnapshot(policy, version) };
}

export async function recordPolicyAcceptance(db, persist, {
  policy,
  version,
  parentId = null,
  activityId = null,
  orderId = null,
  posSaleId = null,
  paymentId = null,
  acceptedVia = 'online',
  acceptedByStaff = null,
} = {}) {
  if (!policy || !version) return null;
  const acceptance = db.insert('cancellation_acceptances', {
    id: id('ca'), policy_id: policy.id, policy_version_id: version.id,
    parent_id: parentId, activity_id: activityId, order_id: orderId,
    pos_sale_id: posSaleId, accepted_via: acceptedVia,
    payment_id: paymentId,
    accepted_by_staff: acceptedByStaff, snapshot: policySnapshot(policy, version),
    accepted_at: new Date().toISOString(),
  });
  await durable(persist, 'cancellation_acceptances', acceptance);
  return acceptance;
}
