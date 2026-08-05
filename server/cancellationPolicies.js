import crypto from 'crypto';

export const DEFAULT_CANCELLATION_RULES = Object.freeze([
  { id: 'seven_days', min_hours_before: 168, max_hours_before: null, refund_percent: 100, fixed_fee: 50 },
  { id: 'two_to_seven_days', min_hours_before: 48, max_hours_before: 168, refund_percent: 50, fixed_fee: 0 },
  { id: 'under_two_days', min_hours_before: 0, max_hours_before: 48, refund_percent: 0, fixed_fee: 0 },
]);

export const DEFAULT_CANCELLATION_TEXT = 'הפעילות מותנית במינימום משתתפים. במקרה של ביטול הפעילות על ידינו יוחזר מלוא הסכום.';

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
    rules: normalizeCancellationRules(version.rules),
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

export function suggestedRefund({
  snapshot,
  paidAmount,
  activityStartsAt,
  cancelledAt = new Date(),
  organizerCancelled = false,
  participantsCancelled = 1,
} = {}) {
  const paid = money(paidAmount);
  if (organizerCancelled) return { amount: paid, rule_id: 'organizer_cancelled', refund_percent: 100, fixed_fee: 0 };
  const starts = activityStartsAt instanceof Date ? activityStartsAt : new Date(activityStartsAt);
  const cancelled = cancelledAt instanceof Date ? cancelledAt : new Date(cancelledAt);
  if (!snapshot || Number.isNaN(starts.getTime()) || Number.isNaN(cancelled.getTime())) {
    return { amount: 0, rule_id: null, refund_percent: 0, fixed_fee: 0 };
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
    rules: normalizeCancellationRules(input.rules),
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
      rules: normalizeCancellationRules(input.rules || current?.rules),
      free_text: String(input.free_text ?? current?.free_text ?? ''),
      status: 'draft', published_at: null, created_by: actor || null,
      created_at: new Date().toISOString(),
    });
  } else {
    draft = db.update('cancellation_policy_versions', draft.id, {
      rules: normalizeCancellationRules(input.rules || draft.rules),
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
