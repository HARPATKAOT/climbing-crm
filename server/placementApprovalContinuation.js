import { PLACEMENT_REQUEST_COLLECTION } from './placementEligibility.js';

const ONCE = 'פעם בשבוע';
const TWICE = 'פעמיים בשבוע';

function clean(value) {
  return String(value ?? '').trim();
}

function linkFrom(step) {
  return clean(step?.קישור);
}

/**
 * An approval identifies the group, but older requests did not save the
 * chosen frequency. A squad is one twice-weekly programme, so it is safe to
 * recover that choice from the canonical group. For a group sold in both
 * frequencies we leave the choice open and ask the customer instead.
 */
export function approvedGroupFrequency(group, requested = '') {
  const wanted = clean(requested);
  const hasOnce = Number(group?.priceWeek) > 0 && Boolean(clean(group?.signupLinkWeek));
  const hasTwice = Number(group?.priceTwice) > 0 && Boolean(clean(group?.signupLinkTwice));
  if (wanted === ONCE && hasOnce) return ONCE;
  if (wanted === TWICE && hasTwice) return TWICE;
  if (/נבחרת/u.test(`${group?.skillLevel || ''} ${group?.name || ''}`) && hasTwice) return TWICE;
  if (hasTwice && !hasOnce) return TWICE;
  if (hasOnce && !hasTwice) return ONCE;
  return '';
}

export function approvedPlacementMessage({ request = {}, group = {}, signup = {} } = {}) {
  const studentName = clean(request.student_name || signup.שובץ) || 'המתאמן/ת';
  const groupName = clean(group.name || request.group_name || signup.קבוצה) || 'הקבוצה';
  const pack = signup.חבילת_הרשמה || {};
  const registration = pack.שלב_2_הרשמה_לקבוצה || {};
  const equipment = pack.שלב_3_תשלום_ציוד || {};
  const registrationLink = linkFrom(registration);
  const equipmentLink = linkFrom(equipment);

  const parts = [`השיבוץ של ${studentName} ל${groupName} אושר ונשמר 🎉`];
  if (registrationLink) {
    parts.push(`🖋️ *הרשמה לקבוצה*\nלהשלמת ההרשמה במתנ״ס:\n${registrationLink}`);
  } else if (registration.מצב === 'צריך לבחור תדירות') {
    const choices = Array.isArray(registration.תדירויות_אפשריות)
      ? registration.תדירויות_אפשריות.join(' או ')
      : 'פעם או פעמיים בשבוע';
    parts.push(`כדי שאשלח את קישור ההרשמה הנכון: ${choices}?`);
  } else {
    parts.push('אין כרגע קישור הרשמה מוגדר לקבוצה הזו; הצוות ישלים את הרישום ויעדכן אתכם.');
  }
  if (equipmentLink) {
    parts.push('🛠️ *עדכון או רכישת ציוד*\nגם אם יש ציוד משנה קודמת, נכנסים לעדכן מה כבר קיים ורוכשים רק את החסר:\n'
      + equipmentLink);
  }
  return parts.join('\n\n');
}

async function saveContinuation(db, persist, request, patch) {
  const now = new Date().toISOString();
  const updated = db.update(PLACEMENT_REQUEST_COLLECTION, request.id, {
    ...patch,
    continuation_updated_at: now,
    updated_at: now,
  });
  if (updated && typeof persist === 'function') await persist(PLACEMENT_REQUEST_COLLECTION, updated);
  return updated || request;
}

/**
 * Finish the business transaction that begins when staff press "approve":
 * save the soft placement, create its follow-up, build the exact registration
 * pack and send one idempotent WhatsApp continuation.
 */
export async function continueApprovedPlacement({
  db,
  persist,
  request,
  group,
  settings = {},
  buildTools,
  sendReply,
} = {}) {
  if (!request?.id || request.status !== 'approved') {
    return { ok: false, status: 409, error: 'placement_not_approved' };
  }
  if (request.continuation_status === 'sent') {
    return { ok: true, duplicate: true, request };
  }
  const parent = db?.getOne?.('parents', request.parent_id);
  const student = db?.getOne?.('students', request.student_id);
  const selectedGroup = group || db?.getOne?.('groups', request.group_id);
  if (!parent?.phone || !student || !selectedGroup) {
    const error = !parent?.phone ? 'missing_parent_phone' : (!student ? 'student_not_found' : 'group_not_found');
    const failed = await saveContinuation(db, persist, request, {
      continuation_status: 'failed',
      continuation_error: error,
    });
    return { ok: false, status: 409, error, request: failed };
  }

  let working = await saveContinuation(db, persist, request, {
    continuation_status: 'processing',
    continuation_error: '',
  });
  const tools = buildTools({ settings, parent, phone: parent.phone });
  const frequency = approvedGroupFrequency(selectedGroup, request.frequency);
  const signup = await tools.startSignup({
    childName: student.name || request.student_name,
    studentId: student.id,
    groupId: selectedGroup.id,
    frequency,
  });
  if (!signup || signup.error || !signup.חבילת_הרשמה) {
    const error = clean(signup?.error) || 'approved_placement_not_saved';
    working = await saveContinuation(db, persist, working, {
      continuation_status: 'failed',
      continuation_error: error,
    });
    return { ok: false, status: 409, error, request: working, signup };
  }

  const message = approvedPlacementMessage({ request: working, group: selectedGroup, signup });
  const sent = await sendReply(parent.phone, message, {
    source: 'placement_approval',
    parent,
    replyKey: `placement-approval:${working.id}`,
  });
  if (!sent?.success) {
    const error = clean(sent?.error) || 'whatsapp_send_failed';
    working = await saveContinuation(db, persist, working, {
      continuation_status: 'failed',
      continuation_error: error,
    });
    return { ok: false, status: 502, error, request: working, signup, send: sent };
  }

  const completedAt = new Date().toISOString();
  working = await saveContinuation(db, persist, working, {
    continuation_status: 'sent',
    continuation_error: '',
    continued_at: completedAt,
    continuation_message_id: sent.messageId || '',
  });
  return {
    ok: true,
    duplicate: Boolean(sent.skipped),
    request: working,
    signup,
    send: sent,
    message,
  };
}
